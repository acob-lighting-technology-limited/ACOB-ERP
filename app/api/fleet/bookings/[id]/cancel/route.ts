import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

export async function PATCH(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit("fleet-bookings-cancel", { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const bookingId = params.id

    const { data: booking, error: bookingError } = await supabase
      .from("fleet_bookings")
      .select("id, requester_id, status, start_at")
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) {
      return NextResponse.json({ error: "Failed to load booking" }, { status: 500 })
    }

    if (!booking || booking.requester_id !== user.id) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    if (String(booking.status) !== "pending") {
      return NextResponse.json({ error: "Only pending bookings can be cancelled" }, { status: 400 })
    }

    if (new Date(booking.start_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Only future bookings can be cancelled" }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from("fleet_bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id)

    if (updateError) {
      return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "fleet_booking",
        entityId: booking.id,
        newValues: { status: "cancelled" },
        context: { actorId: user.id, source: "api", route: `/api/fleet/bookings/${bookingId}/cancel` },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Booking cancelled" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
