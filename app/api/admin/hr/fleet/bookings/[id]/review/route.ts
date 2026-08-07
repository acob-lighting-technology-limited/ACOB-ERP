import { NextRequest, NextResponse } from "next/server"
import { assertNoFleetOverlap, canManageFleet } from "@/lib/fleet-booking"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const ReviewFleetBookingSchema = z.object({
  action: z.enum(["approve", "reject"], {
    errorMap: () => ({ message: "action must be approve or reject" }),
  }),
  admin_note: z.string().optional(),
})

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`admin-hr-fleet-bookings-review:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const allowed = await canManageFleet(supabase, user.id)
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const bookingId = params.id
    const body = await request.json()
    const parsed = ReviewFleetBookingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const action = parsed.data.action
    const adminNote = String(parsed.data.admin_note || "").trim() || null

    // Turning down a booking must say why — the requester has to plan around it.
    if (action === "reject" && !adminNote) {
      return NextResponse.json({ error: "A reason is required when rejecting a booking" }, { status: 400 })
    }

    const { data: booking, error: bookingError } = await dataClient
      .from("fleet_bookings")
      .select("id, resource_id, start_at, end_at, status")
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) return NextResponse.json({ error: "Failed to load booking" }, { status: 500 })
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 })

    if (booking.status !== "pending") {
      return NextResponse.json({ error: "Only pending bookings can be reviewed" }, { status: 400 })
    }

    if (action === "approve") {
      await assertNoFleetOverlap({
        supabase: dataClient,
        resourceId: booking.resource_id,
        startAt: booking.start_at,
        endAt: booking.end_at,
        excludeBookingId: booking.id,
      })
    }

    const nextStatus = action === "approve" ? "approved" : "rejected"

    const { data, error } = await dataClient
      .from("fleet_bookings")
      .update({
        status: nextStatus,
        admin_note: adminNote,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .select("id, status, admin_note, reviewed_by, reviewed_at")
      .single()

    if (error) return NextResponse.json({ error: error.message || "Failed to review booking" }, { status: 500 })

    await writeAuditLog(
      supabase,
      {
        action: action === "approve" ? "approve" : "reject",
        entityType: "fleet_booking",
        entityId: bookingId,
        newValues: { status: nextStatus, admin_note: adminNote },
        context: { actorId: user.id, source: "api", route: `/api/admin/hr/fleet/bookings/${bookingId}/review` },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    const status = message.toLowerCase().includes("overlap") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
