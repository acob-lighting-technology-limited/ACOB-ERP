import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { isLate } from "@/lib/hr/attendance-utils"
import { DB_WRITABLE_STATUSES, isEarlyDeparture } from "@/lib/hr/attendance-status"
import { requireApiAdminScope } from "@/lib/admin/api-scope"

const log = logger("admin-hr-attendance-record-patch")

const PatchSchema = z.object({
  clock_in: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid time format")
    .optional(),
  clock_out: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid time format")
    .optional(),
  status: z.enum(DB_WRITABLE_STATUSES).optional(),
  waived: z.boolean().optional(),
  waiver_reason: z.string().max(200).optional().nullable(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(`admin-attendance-patch:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const auth = await requireApiAdminScope()
    if (!auth.ok) return auth.response
    const { supabase } = auth
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = PatchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { id } = await params
    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: record } = await dataClient
      .from("attendance_records")
      .select("id, clock_in, clock_out, date")
      .eq("id", id)
      .maybeSingle()

    if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 })

    const updates: Record<string, unknown> = { ...parsed.data }

    // Recalculate total_hours if both times are known after update
    const clockIn = parsed.data.clock_in ?? record.clock_in
    const clockOut = parsed.data.clock_out ?? record.clock_out
    if (clockIn && clockOut && clockOut <= clockIn) {
      return NextResponse.json({ error: "Clock out must be after clock in" }, { status: 400 })
    }
    if (parsed.data.waived !== true && !clockIn && !clockOut) {
      return NextResponse.json({ error: "Provide both clock in and clock out before saving" }, { status: 400 })
    }
    if ((clockIn && !clockOut) || (!clockIn && clockOut)) {
      return NextResponse.json({ error: "Clock in and clock out must be provided together" }, { status: 400 })
    }
    if (clockIn && clockOut) {
      const inMs = new Date(`${record.date}T${clockIn}Z`).getTime()
      const outMs = new Date(`${record.date}T${clockOut}Z`).getTime()
      updates.total_hours = Math.max(0, (outMs - inMs) / (1000 * 60 * 60))
    }
    if (parsed.data.waived === true) {
      updates.status = "waiver"
    } else if (parsed.data.clock_in !== undefined || parsed.data.clock_out !== undefined) {
      if (!clockIn && !clockOut) {
        updates.status = "absent"
      } else if (clockIn && !clockOut) {
        const today = new Date().toISOString().slice(0, 10)
        updates.status = record.date < today ? "half_day" : "incomplete"
      } else if (clockIn && clockOut && clockOut > clockIn) {
        updates.status = isEarlyDeparture(clockOut) ? "half_day" : isLate(clockIn) ? "late" : "present"
      } else {
        updates.status = "incomplete"
      }
    } else if (parsed.data.waived === false) {
      if (!clockIn && !clockOut) {
        updates.status = "absent"
      } else if (clockIn && !clockOut) {
        const today = new Date().toISOString().slice(0, 10)
        updates.status = record.date < today ? "half_day" : "incomplete"
      } else if (clockIn && clockOut && clockOut > clockIn) {
        updates.status = isEarlyDeparture(clockOut) ? "half_day" : isLate(clockIn) ? "late" : "present"
      } else {
        updates.status = "incomplete"
      }
    }

    const { data: updated, error } = await dataClient
      .from("attendance_records")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      log.error({ err: JSON.stringify(error) }, "Failed to update attendance record")
      return NextResponse.json({ error: "Failed to update record" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "attendance_record",
        entityId: id,
        newValues: updates,
        context: { actorId: user.id, source: "api", route: `/api/admin/hr/attendance/records/${id}` },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updated, message: "Record updated" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/admin/hr/attendance/records/[id]")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
