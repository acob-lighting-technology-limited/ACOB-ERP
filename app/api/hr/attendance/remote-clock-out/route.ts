import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { toLocalISODate, toLocalTimeString, toLocalYearMonth } from "@/lib/utils/date"
import { distanceMetres, loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { applyLunchBreak } from "@/lib/hr/attendance-ssot"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { matchSelfieToReference } from "@/lib/azure/face"
import { getOneDriveService } from "@/lib/onedrive"

const log = logger("hr-attendance-remote-clock-out")
export const dynamic = "force-dynamic"

type SiteRow = {
  id: string
  latitude: number
  longitude: number
  radius_metres: number
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`remote-clock-out:${getClientId(request)}`, { limit: 5, windowSec: 300 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()
    const policy = await loadAttendancePolicy(supabase)
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
      return NextResponse.json({ error: "Remote check-in is not enabled for your account." }, { status: 403 })
    }
    if (!profile.face_reference_url) {
      return NextResponse.json({ error: "No reference photo on file. Contact HR." }, { status: 403 })
    }

    // ── Fetch today's record (must have clock_in, no clock_out yet) ──────────
    const today = toLocalISODate()
    const { data: record } = await dataClient
      .from("attendance_records")
      .select("id, clock_in, clock_out, source")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle()

    if (!record) {
      return NextResponse.json({ error: "No clock-in found for today. Clock in first." }, { status: 409 })
    }
    if (record.clock_out) {
      return NextResponse.json({ error: "You have already clocked out today." }, { status: 409 })
    }
    if (record.source !== "remote_web") {
      return NextResponse.json(
        { error: "Today's clock-in was not a remote check-in. Use the standard clock-out instead." },
        { status: 409 }
      )
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
      log.error({ err: String(faceErr) }, "Face API error on clock-out")
      faceVerified = false
      faceMatchConfidence = 0
    }

    // ── GPS site matching ────────────────────────────────────────────────────
    const { data: sites } = await dataClient
      .from("attendance_sites")
      .select("id, latitude, longitude, radius_metres")
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

    // ── Upload clock-out selfie to OneDrive ──────────────────────────────────
    let selfieOutUrl: string | null = null
    const now = new Date()
    const [yyyy, mm] = toLocalYearMonth(now).split("-")
    const clockOutTime = toLocalTimeString(now)

    try {
      const od = getOneDriveService()
      const filePath = `/attendance/selfies/${yyyy}/${mm}/${user.id}-${today}-out.jpg`
      const result = await od.uploadFile(filePath, selfieBuffer, "image/jpeg")
      selfieOutUrl = (result as { webUrl?: string }).webUrl ?? null
    } catch (odErr) {
      log.warn({ err: String(odErr) }, "OneDrive upload failed for clock-out selfie — continuing without URL")
    }

    // ── Calculate total_hours & status ───────────────────────────────────────
    const inMs = new Date(`${today}T${record.clock_in}`).getTime()
    const outMs = new Date(`${today}T${clockOutTime}`).getTime()
    const rawHours = Math.max(0, (outMs - inMs) / (1000 * 60 * 60))
    const { breakMinutes: break_duration, workedHours: total_hours } = applyLunchBreak(rawHours, policy)
    const status = deriveUnifiedAttendanceStatus(
      {
        record: { clock_in: record.clock_in, clock_out: clockOutTime, waived: false },
        recordDate: today,
      },
      policy
    )

    const updateData: Record<string, unknown> = {
      clock_out: clockOutTime,
      total_hours,
      break_duration,
      status,
      clock_out_source: "remote_web",
      selfie_out_url: selfieOutUrl,
      // Merge face confidence — take the lower of the two (more conservative)
      face_match_confidence: faceMatchConfidence,
      face_verified: faceVerified,
    }
    if (matchedSiteId) updateData.site_id = matchedSiteId
    updateData.location_verified = locationVerified

    const { data: updated, error: updateError } = await dataClient
      .from("attendance_records")
      .update(updateData)
      .eq("id", record.id)
      .select()
      .single()

    if (updateError) {
      log.error({ err: String(updateError) }, "Failed to update record on remote clock-out")
      return NextResponse.json({ error: "Failed to record clock-out" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "attendance_record",
        entityId: record.id,
        newValues: { ...updateData, selfie_out_url: selfieOutUrl ? "[uploaded]" : null },
        context: { actorId: user.id, source: "api", route: "/api/hr/attendance/remote-clock-out" },
      },
      { failOpen: true }
    )

    await recordAttendanceEvent(dataClient, {
      userId: user.id,
      eventDate: today,
      eventType: "remote_clock_out",
      attendanceRecordId: record.id,
      toStatus: status,
      source: "remote_web",
      actorId: user.id,
      metadata: {
        clock_out: clockOutTime,
        total_hours,
        location_verified: locationVerified,
        face_verified: faceVerified,
      },
    })

    return NextResponse.json({
      data: updated,
      message: "Clocked out successfully",
      face_verified: faceVerified,
      location_verified: locationVerified,
      review_required: !faceVerified || !locationVerified,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/attendance/remote-clock-out")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
