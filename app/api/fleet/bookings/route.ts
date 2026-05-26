import { NextRequest, NextResponse } from "next/server"
import {
  assertBookingWindow,
  assertNoFleetOverlap,
  assertReason,
  FLEET_ALLOWED_MIME_TYPES,
  FLEET_BLOCKING_STATUSES,
  FLEET_MAX_FILE_SIZE,
  sanitizeFileName,
} from "@/lib/fleet-booking"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getPaginationRange, paginatedResponse, PaginationSchema } from "@/lib/pagination"
import { checkIdempotency, getIdempotencyKey, storeIdempotencyKey } from "@/lib/idempotency"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type FleetBookingAttachmentRow = {
  id: string
  booking_id: string
  file_name?: string | null
  mime_type?: string | null
  file_size?: number | null
  file_path?: string | null
  created_at?: string | null
}

type FleetBookingRow = {
  id: string
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const paginationParsed = PaginationSchema.safeParse(Object.fromEntries(searchParams))
    if (!paginationParsed.success) {
      return NextResponse.json(
        { error: paginationParsed.error.issues[0]?.message ?? "Invalid pagination params" },
        { status: 400 }
      )
    }
    const pagination = paginationParsed.data
    const { from, to } = getPaginationRange(pagination)

    const supabase = await createClient()
    const validationClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const {
      data: bookings,
      error,
      count,
    } = await supabase
      .from("fleet_bookings")
      .select(
        "id, resource_id, requester_id, start_at, end_at, reason, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at, resource:fleet_resources(id, name, resource_type, is_active), reviewer:profiles!fleet_bookings_reviewed_by_fkey(id, full_name)",
        { count: "exact" }
      )
      .eq("requester_id", user.id)
      .order("start_at", { ascending: true })
      .range(from, to)

    if (error) {
      return NextResponse.json({ error: error.message || "Failed to load bookings" }, { status: 500 })
    }

    const bookingIds = ((bookings || []) as FleetBookingRow[]).map((row) => row.id)
    let attachmentRows: FleetBookingAttachmentRow[] = []
    if (bookingIds.length > 0) {
      const { data: attachments } = await supabase
        .from("fleet_booking_attachments")
        .select("id, booking_id, file_name, mime_type, file_size, file_path, created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: true })
      attachmentRows = attachments || []
    }

    const attachmentsByBooking = new Map<string, FleetBookingAttachmentRow[]>()
    for (const attachment of attachmentRows) {
      const rows = attachmentsByBooking.get(attachment.booking_id) || []
      rows.push(attachment)
      attachmentsByBooking.set(attachment.booking_id, rows)
    }

    const data = ((bookings || []) as FleetBookingRow[]).map((booking) => ({
      ...booking,
      attachments: attachmentsByBooking.get(booking.id) || [],
    }))

    const nowIso = new Date().toISOString()
    const { data: resourceSchedule } = await validationClient
      .from("fleet_bookings")
      .select("id, resource_id, start_at, end_at, status")
      .in("status", [...FLEET_BLOCKING_STATUSES])
      .gte("end_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(500)

    return NextResponse.json({
      ...paginatedResponse(data, count || 0, pagination),
      resource_schedule: resourceSchedule || [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`fleet-bookings:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const uploadedPaths: string[] = []
  try {
    const supabase = await createClient()
    const validationClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const idempotencyKey = getIdempotencyKey(request)
    if (idempotencyKey) {
      const { isDuplicate, cachedResponse } = await checkIdempotency(validationClient, idempotencyKey)
      if (isDuplicate) {
        return NextResponse.json(cachedResponse, { status: 200 })
      }
    }

    const formData = await request.formData()
    const resourceId = String(formData.get("resource_id") || "").trim()
    const startAt = String(formData.get("start_at") || "").trim()
    const endAt = String(formData.get("end_at") || "").trim()
    const reason = assertReason(String(formData.get("reason") || ""))
    const attachments = formData.getAll("attachments").filter((entry) => entry instanceof File) as File[]

    if (!resourceId || !startAt || !endAt) {
      return NextResponse.json({ error: "resource_id, start_at, and end_at are required" }, { status: 400 })
    }

    const { start, end } = assertBookingWindow(startAt, endAt)
    if (start.getTime() < Date.now()) {
      return NextResponse.json({ error: "Booking start time cannot be in the past" }, { status: 400 })
    }

    const { data: resource, error: resourceError } = await validationClient
      .from("fleet_resources")
      .select("id, is_active")
      .eq("id", resourceId)
      .maybeSingle()

    if (resourceError) {
      return NextResponse.json({ error: "Failed to validate resource" }, { status: 500 })
    }

    if (!resource || !resource.is_active) {
      return NextResponse.json({ error: "Selected resource is unavailable" }, { status: 400 })
    }

    await assertNoFleetOverlap({
      supabase: validationClient,
      resourceId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    })

    for (let i = 0; i < attachments.length; i += 1) {
      const file = attachments[i]
      if (!FLEET_ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: `Unsupported file type for ${file.name}. Only PDF and images are allowed.` },
          { status: 400 }
        )
      }
      if (file.size > FLEET_MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `${file.name} exceeds max size of ${Math.round(FLEET_MAX_FILE_SIZE / (1024 * 1024))}MB.` },
          { status: 400 }
        )
      }

      const fileName = sanitizeFileName(file.name || `attachment-${i + 1}`)
      const filePath = `${user.id}/${Date.now()}-${i + 1}-${fileName}`

      const { error: uploadError } = await supabase.storage
        .from("fleet_booking_documents")
        .upload(filePath, file, { contentType: file.type, upsert: false })

      if (uploadError) {
        throw new Error(`Failed to upload attachment ${file.name}`)
      }

      uploadedPaths.push(filePath)
    }

    const { data: booking, error: bookingError } = await supabase
      .from("fleet_bookings")
      .insert({
        resource_id: resourceId,
        requester_id: user.id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        reason,
        status: "pending",
      })
      .select(
        "id, resource_id, requester_id, start_at, end_at, reason, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at"
      )
      .single()

    if (bookingError || !booking) {
      throw new Error(bookingError?.message || "Failed to create booking")
    }

    if (uploadedPaths.length > 0) {
      const attachmentRows = uploadedPaths.map((filePath, index) => {
        const file = attachments[index]
        return {
          booking_id: booking.id,
          file_name: file.name,
          file_path: filePath,
          mime_type: file.type,
          file_size: file.size,
          uploaded_by: user.id,
        }
      })

      const { error: attachmentError } = await supabase.from("fleet_booking_attachments").insert(attachmentRows)

      if (attachmentError) {
        await validationClient.from("fleet_bookings").delete().eq("id", booking.id)
        throw new Error("Failed to save attachment metadata")
      }
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "fleet_booking",
        entityId: booking.id,
        newValues: {
          resource_id: booking.resource_id,
          start_at: booking.start_at,
          end_at: booking.end_at,
          status: booking.status,
        },
        context: { actorId: user.id, source: "api", route: "/api/fleet/bookings" },
      },
      { failOpen: true }
    )

    const responsePayload = { data: booking }
    if (idempotencyKey) {
      await storeIdempotencyKey(validationClient, idempotencyKey, responsePayload)
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        const supabase = await createClient()
        await supabase.storage.from("fleet_booking_documents").remove(uploadedPaths)
      } catch {
        // ignore cleanup errors
      }
    }

    const message = error instanceof Error ? error.message : "Internal server error"
    const status = message.toLowerCase().includes("overlap") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
