import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { assertBookingWindow, assertNoFleetOverlap, assertReason } from "@/lib/fleet-booking"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { rateLimit, getClientId } from "@/lib/rate-limit"

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const rl = await rateLimit(`fleet-bookings-update:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const supabase = await createClient()
    const validationClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: booking } = await supabase
      .from("fleet_bookings")
      .select("id, requester_id, status, start_at")
      .eq("id", id)
      .maybeSingle()

    if (!booking || booking.requester_id !== user.id) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    if (String(booking.status) !== "pending") {
      return NextResponse.json({ error: "Only pending bookings can be updated" }, { status: 400 })
    }

    const body = await request.json()
    const resourceId = String(body.resource_id || "").trim()
    const startAt = String(body.start_at || "").trim()
    const endAt = String(body.end_at || "").trim()
    const reason = assertReason(String(body.reason || ""))

    if (!resourceId || !startAt || !endAt) {
      return NextResponse.json({ error: "resource_id, start_at, and end_at are required" }, { status: 400 })
    }

    const { start, end } = assertBookingWindow(startAt, endAt)
    if (start.getTime() < Date.now()) {
      return NextResponse.json({ error: "Booking start time cannot be in the past" }, { status: 400 })
    }

    await assertNoFleetOverlap({
      supabase: validationClient,
      resourceId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      excludeBookingId: id,
    })

    const { data: updated, error: updateError } = await supabase
      .from("fleet_bookings")
      .update({
        resource_id: resourceId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message || "Failed to update booking" }, { status: 500 })
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const rl = await rateLimit(`fleet-bookings-delete:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const supabase = await createClient()
    const adminClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: booking } = await adminClient
      .from("fleet_bookings")
      .select("id, requester_id, status, start_at")
      .eq("id", id)
      .maybeSingle()

    if (!booking || booking.requester_id !== user.id) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    if (String(booking.status) !== "pending") {
      return NextResponse.json({ error: "Only pending bookings can be deleted" }, { status: 400 })
    }

    // Delete attachments first to prevent foreign key constraint failures
    await adminClient.from("fleet_booking_attachments").delete().eq("booking_id", id)

    const { error: deleteError } = await adminClient.from("fleet_bookings").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "fleet_booking",
        entityId: id,
        context: { actorId: user.id, source: "api", route: `/api/fleet/bookings/${id}` },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Booking deleted" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
