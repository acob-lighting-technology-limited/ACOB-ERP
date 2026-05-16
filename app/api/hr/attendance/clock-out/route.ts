import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { toLocalISODate } from "@/lib/utils/date"
import { latenessDeduction } from "@/lib/hr/attendance-utils"

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

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Use a single timestamp so date and time are from the same instant in UTC
    const now = new Date()
    const today = toLocalISODate(now)
    const clockOutTime = now.toISOString().split("T")[1].split(".")[0] // HH:MM:SS UTC

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
    const breakDuration = record.break_duration || 0
    const workHours = totalHours - breakDuration / 60

    const status = latenessDeduction(record.clock_in) > 0 ? "late" : "present"

    // Update attendance record
    const { data: updatedRecord, error } = await supabase
      .from("attendance_records")
      .update({
        clock_out: clockOutTime,
        total_hours: workHours,
        status,
        source: "manual",
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
