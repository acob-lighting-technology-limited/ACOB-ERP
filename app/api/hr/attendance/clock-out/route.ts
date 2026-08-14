import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { toLocalISODate, toLocalTimeString } from "@/lib/utils/date"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { applyLunchBreak } from "@/lib/hr/attendance-ssot"

const log = logger("hr-attendance-clock-out")

export async function PATCH(_request: NextRequest) {
  const rl = await rateLimit(`hr-attendance-clock-out:${getClientId(_request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const policy = await loadAttendancePolicy(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Use one timestamp and store the local WAT workday/time.
    const now = new Date()
    const today = toLocalISODate(now)
    const clockOutTime = toLocalTimeString(now)

    const { data: record } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
      .single()

    if (!record) {
      return NextResponse.json({ error: "No clock-in record found for today" }, { status: 404 })
    }

    if (record.clock_out) {
      return NextResponse.json({ error: "You have already clocked out today" }, { status: 400 })
    }

    // Calculate total hours
    const clockIn = new Date(`${today}T${record.clock_in}`)
    const clockOut = new Date(`${today}T${clockOutTime}`)
    const totalHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60)
    const { breakMinutes: breakDuration, workedHours: workHours } = applyLunchBreak(totalHours)

    const status = deriveUnifiedAttendanceStatus(
      {
        record: { clock_in: record.clock_in, clock_out: clockOutTime, waived: false },
        recordDate: today,
      },
      policy
    )

    // Update attendance record
    const { data: updatedRecord, error } = await supabase
      .from("attendance_records")
      .update({
        clock_out: clockOutTime,
        total_hours: workHours,
        break_duration: breakDuration,
        status,
        source: "manual",
        clock_out_source: "manual",
      })
      .eq("id", record.id)
      .select()
      .single()

    if (error) {
      log.error({ err: String(error) }, "Error clocking out:")
      return NextResponse.json({ error: "Failed to clock out" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "attendance_record",
        entityId: record.id,
        newValues: { clock_out: clockOutTime, total_hours: workHours, status },
        context: { actorId: user.id, source: "api", route: "/api/hr/attendance/clock-out" },
      },
      { failOpen: true }
    )

    await recordAttendanceEvent(supabase, {
      userId: user.id,
      eventDate: today,
      eventType: "self_clock_out",
      attendanceRecordId: record.id,
      fromStatus: record.status,
      toStatus: status,
      source: "self",
      actorId: user.id,
      metadata: { clock_out: clockOutTime, total_hours: workHours },
    })

    return NextResponse.json({
      data: updatedRecord,
      message: "Clocked out successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/attendance/clock-out:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(_request: NextRequest) {
  const rl = await rateLimit(`hr-attendance-clock-out:${getClientId(_request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(_request)
}
