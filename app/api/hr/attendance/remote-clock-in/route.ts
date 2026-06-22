import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { toLocalISODate, toLocalTimeString, toLocalYearMonth } from "@/lib/utils/date"
import { isLate, distanceMetres } from "@/lib/hr/attendance-utils"
import { matchSelfieToReference } from "@/lib/azure/face"
import { getOneDriveService } from "@/lib/onedrive"

const log = logger("hr-attendance-remote-clock-in")
export const dynamic = "force-dynamic"

type SiteRow = {
  id: string
  latitude: number
  longitude: number
  radius_metres: number
  name: string
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`remote-clock-in:${getClientId(request)}`, { limit: 5, windowSec: 300 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // ── Parse multipart form ─────────────────────────────────────────────────
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
    }

    const selfieFile = formData.get("selfie")
    const latRaw = String(formData.get("latitude") ?? "")
    const lngRaw = String(formData.get("longitude") ?? "")

    if (!selfieFile || !(selfieFile instanceof File)) {
      return NextResponse.json({ error: "Selfie is required" }, { status: 400 })
    }
    const lat = parseFloat(latRaw)
    const lng = parseFloat(lngRaw)
    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: "Valid latitude and longitude are required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // ── Check eligibility ────────────────────────────────────────────────────
    const { data: profile } = await dataClient
      .from("profiles")
      .select("remote_checkin_enabled, face_reference_url")
      .eq("id", user.id)
      .maybeSingle()

    if (!profile?.remote_checkin_enabled) {
      return NextResponse.json(
        { error: "Remote check-in is not enabled for your account. Contact HR." },
        { status: 403 }
      )
    }
    if (!profile.face_reference_url) {
      return NextResponse.json(
        {
          error:
            "No reference photo on file. Please ask HR to upload your reference photo before using remote check-in.",
        },
        { status: 403 }
      )
    }

    // ── Check for existing record today ────────────────────────────────────
    const today = toLocalISODate()
    const { data: existing } = await dataClient
      .from("attendance_records")
      .select("id")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: "You have already clocked in today" }, { status: 409 })
    }

    // ── Azure Face verification ──────────────────────────────────────────────
    const selfieBuffer = Buffer.from(await selfieFile.arrayBuffer())
    let faceMatchConfidence = 0
    let faceVerified = false

    try {
      const faceResult = await matchSelfieToReference(selfieBuffer, profile.face_reference_url)
      if (!faceResult) {
        return NextResponse.json(
          { error: "No face detected in your selfie. Please retake in good lighting, facing the camera directly." },
          { status: 422 }
        )
      }
      faceMatchConfidence = Math.round(faceResult.confidence * 100) / 100
      if (faceMatchConfidence < 0.6) {
        return NextResponse.json(
          {
            error: "We couldn't verify your identity. Please retake in better lighting, facing the camera directly.",
            confidence: faceMatchConfidence,
          },
          { status: 422 }
        )
      }
      faceVerified = faceMatchConfidence >= 0.8
    } catch (faceErr) {
      log.error({ err: String(faceErr) }, "Face API error on clock-in")
      // Fail open: allow check-in but mark unverified
      faceVerified = false
      faceMatchConfidence = 0
    }

    // ── GPS site matching ────────────────────────────────────────────────────
    const { data: sites } = await dataClient
      .from("attendance_sites")
      .select("id, latitude, longitude, radius_metres, name")
      .eq("is_active", true)
      .returns<SiteRow[]>()

    let matchedSiteId: string | null = null
    let locationVerified = false
    for (const site of sites ?? []) {
      const dist = distanceMetres(lat, lng, Number(site.latitude), Number(site.longitude))
      if (dist <= site.radius_metres) {
        matchedSiteId = site.id
        locationVerified = true
        break
      }
    }

    // ── Upload selfie to OneDrive ────────────────────────────────────────────
    let selfieUrl: string | null = null
    const now = new Date()
    const [yyyy, mm] = toLocalYearMonth(now).split("-")
    const clockInTime = toLocalTimeString(now)

    try {
      const od = getOneDriveService()
      const filePath = `/attendance/selfies/${yyyy}/${mm}/${user.id}-${today}-in.jpg`
      const result = await od.uploadFile(filePath, selfieBuffer, "image/jpeg")
      selfieUrl = (result as { webUrl?: string }).webUrl ?? null
    } catch (odErr) {
      log.warn({ err: String(odErr) }, "OneDrive upload failed for clock-in selfie — continuing without URL")
    }

    // ── Insert attendance record ─────────────────────────────────────────────
    const insert: Record<string, unknown> = {
      user_id: user.id,
      date: today,
      clock_in: clockInTime,
      status: "incomplete",
      source: "remote_web",
      clock_in_source: "remote_web",
      latitude: lat,
      longitude: lng,
      location_verified: locationVerified,
      face_match_confidence: faceMatchConfidence,
      face_verified: faceVerified,
    }
    if (matchedSiteId) insert.site_id = matchedSiteId
    if (selfieUrl) insert.selfie_url = selfieUrl

    const { data: record, error: insertError } = await dataClient
      .from("attendance_records")
      .insert(insert)
      .select()
      .single()

    if (insertError) {
      log.error({ err: String(insertError) }, "Failed to insert remote clock-in record")
      return NextResponse.json({ error: "Failed to record clock-in" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "attendance_record",
        entityId: record.id,
        newValues: { ...insert, selfie_url: selfieUrl ? "[uploaded]" : null },
        context: { actorId: user.id, source: "api", route: "/api/hr/attendance/remote-clock-in" },
      },
      { failOpen: true }
    )

    await recordAttendanceEvent(dataClient, {
      userId: user.id,
      eventDate: today,
      eventType: "remote_clock_in",
      attendanceRecordId: record.id,
      toStatus: "incomplete",
      source: "remote_web",
      actorId: user.id,
      metadata: { clock_in: clockInTime, location_verified: locationVerified, face_verified: faceVerified },
    })

    return NextResponse.json({
      data: record,
      message: "Clocked in successfully",
      face_verified: faceVerified,
      location_verified: locationVerified,
      review_required: !faceVerified || !locationVerified,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/attendance/remote-clock-in")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
