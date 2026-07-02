import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { resolvePendingAppealOnManualStatus } from "@/lib/hr/attendance-appeals"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import {
  DB_WRITABLE_STATUSES,
  deriveUnifiedAttendanceStatus,
  isPermissionAttendanceStatus,
} from "@/lib/hr/attendance-status"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { loadAttendancePolicy } from "@/lib/hr/attendance-utils"

const log = logger("admin-hr-attendance-record-patch")

const PatchSchema = z.object({
  clock_in: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid time format")
    .optional()
    .nullable(),
  clock_out: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid time format")
    .optional()
    .nullable(),
  status: z.enum(DB_WRITABLE_STATUSES).optional(),
  waived: z.boolean().optional(),
  manual_comment: z.string().trim().min(3, "Manual attendance changes require a comment").max(500),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(`admin-attendance-patch:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const auth = await requireApiAdminScope()
    if (!auth.ok) return auth.response
    const { supabase } = auth
    const policy = await loadAttendancePolicy(supabase)
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
      .select("id, user_id, clock_in, clock_out, date, status, waived, manual_comment")
      .eq("id", id)
      .maybeSingle()

    if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 })

    const updates: Record<string, unknown> = {
      ...parsed.data,
      source: "manual",
      manual_comment: parsed.data.manual_comment,
    }

    // Any manually-changed punch is attributed to "manual" so the source label can show Mixed.
    // Only set the source when a non-null time is provided; setting clock_in_source on a null
    // punch would leave a dangling source value on a cleared clock-in.
    if (parsed.data.clock_in != null) updates.clock_in_source = "manual"
    if (parsed.data.clock_out != null) updates.clock_out_source = "manual"

    // Recalculate total_hours if both times are known after update
    const clockIn = parsed.data.clock_in !== undefined ? parsed.data.clock_in : record.clock_in
    const clockOut = parsed.data.clock_out !== undefined ? parsed.data.clock_out : record.clock_out
    const explicitStatus = parsed.data.status
    const nextStatus =
      explicitStatus ??
      (parsed.data.waived === true
        ? "waiver"
        : deriveUnifiedAttendanceStatus({
            record: { clock_in: clockIn, clock_out: clockOut, waived: false, status: record.status },
            recordDate: record.date,
          }, policy))
    const isCoveredWithoutTimes =
      nextStatus === "waiver" || nextStatus === "absent_with_permission" || nextStatus === "out_of_station"
    const isLWP = nextStatus === "lateness_with_permission"

    if (clockIn && clockOut && clockOut <= clockIn) {
      return NextResponse.json({ error: "Clock out must be after clock in" }, { status: 400 })
    }
    if (!isCoveredWithoutTimes && !isLWP && !clockIn && !clockOut) {
      return NextResponse.json({ error: "Provide both clock in and clock out before saving" }, { status: 400 })
    }
    if (!isCoveredWithoutTimes && !isLWP && ((clockIn && !clockOut) || (!clockIn && clockOut))) {
      return NextResponse.json({ error: "Clock in and clock out must be provided together" }, { status: 400 })
    }
    if (isLWP && !clockIn && !clockOut) {
      return NextResponse.json(
        { error: "LWP requires at least one clock punch (clock in or clock out)" },
        { status: 400 }
      )
    }
    if (nextStatus === "waiver" && !parsed.data.manual_comment.trim()) {
      return NextResponse.json({ error: "Waiver requires a reason or comment" }, { status: 400 })
    }

    if (clockIn && clockOut) {
      const inMs = new Date(`${record.date}T${clockIn}Z`).getTime()
      const outMs = new Date(`${record.date}T${clockOut}Z`).getTime()
      updates.total_hours = Math.max(0, (outMs - inMs) / (1000 * 60 * 60))
    } else {
      updates.total_hours = null
    }

    updates.status = nextStatus
    updates.waived = nextStatus === "waiver" ? true : Boolean(parsed.data.waived ?? false)
    if (isCoveredWithoutTimes && !clockIn && !clockOut) {
      updates.clock_in = null
      updates.clock_out = null
      updates.clock_in_source = null
      updates.clock_out_source = null
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
        oldValues: record,
        newValues: { ...updates, user_id: record.user_id },
        context: { actorId: user.id, source: "api", route: `/api/admin/hr/attendance/records/${id}` },
      },
      { failOpen: true }
    )

    // Provenance + appeal auto-resolution (replaces the old DB trigger).
    await recordAttendanceEvent(dataClient, {
      userId: record.user_id,
      eventDate: record.date,
      eventType: "manual_update",
      attendanceRecordId: id,
      fromStatus: record.status,
      toStatus: nextStatus,
      source: "manual",
      comment: parsed.data.manual_comment,
      actorId: user.id,
      metadata: { clock_in: clockIn ?? null, clock_out: clockOut ?? null },
    })
    await resolvePendingAppealOnManualStatus(dataClient, {
      userId: record.user_id,
      date: record.date,
      status: nextStatus,
      attendanceRecordId: id,
      comment: parsed.data.manual_comment,
      actorId: user.id,
    })

    return NextResponse.json({ data: updated, message: "Record updated" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/admin/hr/attendance/records/[id]")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
