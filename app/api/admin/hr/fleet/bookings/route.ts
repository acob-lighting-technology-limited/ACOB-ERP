import { NextRequest, NextResponse } from "next/server"
import { canManageFleet } from "@/lib/fleet-booking"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { resolveApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"

const log = logger("admin-fleet-bookings")

type FleetAttachmentRow = {
  booking_id: string
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const allowed = await canManageFleet(supabase, user.id)
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Resolve admin scope for department-level filtering
    const scope = await resolveApiAdminScope()
    const scopedDepts = scope ? getScopedDepartments(scope) : null

    const statusParam = request.nextUrl.searchParams.get("status")

    let query = dataClient
      .from("fleet_bookings")
      .select(
        `
        id,
        resource_id,
        requester_id,
        start_at,
        end_at,
        reason,
        status,
        admin_note,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at,
        resource:fleet_resources(id, name, resource_type),
        requester:profiles!fleet_bookings_requester_id_fkey(id, full_name, company_email, department),
        reviewer:profiles!fleet_bookings_reviewed_by_fkey(id, full_name, department, designation)
      `
      )
      .order("start_at", { ascending: false })

    if (statusParam) {
      query = query.eq("status", statusParam)
    }

    const { data: rawBookings, error } = await query
    if (error) return NextResponse.json({ error: error.message || "Failed to load bookings" }, { status: 500 })

    // Apply department scope filter for leads
    let bookings = rawBookings ?? []
    if (scopedDepts !== null && scopedDepts.length > 0) {
      bookings = bookings.filter((b) => {
        // Supabase returns nested relations as arrays; requester may be array or object shape
        const raw = b.requester as unknown
        const dept = Array.isArray(raw)
          ? (raw[0] as { department?: string | null } | undefined)?.department || ""
          : (raw as { department?: string | null } | null)?.department || ""
        return scopedDepts.includes(dept)
      })
    } else if (scopedDepts !== null && scopedDepts.length === 0) {
      // lead with no managed departments — return nothing
      log.warn({ userId: user.id }, "Lead has no managed departments, returning empty fleet bookings")
      return NextResponse.json({ data: [] })
    }

    const bookingIds = bookings.map((row) => row.id)
    let attachmentRows: FleetAttachmentRow[] = []
    if (bookingIds.length > 0) {
      const { data: attachments } = await dataClient
        .from("fleet_booking_attachments")
        .select("id, booking_id, file_name, mime_type, file_size, file_path, created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: true })
      attachmentRows = attachments || []
    }

    const attachmentCounts = new Map<string, number>()
    for (const attachment of attachmentRows) {
      attachmentCounts.set(attachment.booking_id, (attachmentCounts.get(attachment.booking_id) || 0) + 1)
    }

    const data = bookings.map((booking) => ({
      ...booking,
      attachment_count: attachmentCounts.get(booking.id) || 0,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
