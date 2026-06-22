import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { toLocalISODate, toLocalTimeString } from "@/lib/utils/date"

const log = logger("hr-attendance-clock-in")

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`clock-in:${getClientId(request)}`, { limit: 5, windowSec: 300 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Use one timestamp and store the local WAT workday/time.
    const now = new Date()
    const today = toLocalISODate(now)
    const clockInTime = toLocalTimeString(now)

    const { data: existingRecord } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
      .single()

    if (existingRecord) {
      return NextResponse.json({ error: "You have already clocked in today" }, { status: 400 })
    }

    // Clock-in alone is incomplete; final presence/late is set when clock-out is captured.
    const status = "incomplete"
    const { data: record, error } = await supabase
      .from("attendance_records")
      .insert({
        user_id: user.id,
        date: today,
        clock_in: clockInTime,
        status,
        source: "manual",
        clock_in_source: "manual",
      })
      .select()
      .single()

    if (error) {
      log.error({ err: String(error) }, "Error clocking in:")
      return NextResponse.json({ error: "Failed to clock in" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "attendance_record",
        entityId: record.id,
        newValues: { date: today, clock_in: record.clock_in, status },
        context: { actorId: user.id, source: "api", route: "/api/hr/attendance/clock-in" },
      },
      { failOpen: true }
    )

    await recordAttendanceEvent(supabase, {
      userId: user.id,
      eventDate: today,
      eventType: "self_clock_in",
      attendanceRecordId: record.id,
      toStatus: status,
      source: "self",
      actorId: user.id,
      metadata: { clock_in: record.clock_in },
    })

    return NextResponse.json({
      data: record,
      message: "Clocked in successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/attendance/clock-in:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
