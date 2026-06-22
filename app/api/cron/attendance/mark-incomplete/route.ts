import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"
import { recordAttendanceEvents } from "@/lib/hr/attendance-events"

const log = logger("cron-attendance-mark-incomplete")

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`
  if (!safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Yesterday in local time
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const date = toLocalISODate(yesterday)

  const { data, error } = await supabase
    .from("attendance_records")
    .update({ status: "incomplete" })
    .eq("date", date)
    .is("clock_out", null)
    .not(
      "status",
      "in",
      '("absent","absent_with_permission","out_of_station","lateness_with_permission","waiver","exempted")'
    )
    .select("id, user_id, date")

  if (error) {
    log.error({ err: String(error), date }, "Failed to mark incomplete records")
    return NextResponse.json({ error: "Failed to update records" }, { status: 500 })
  }

  const rows = (data ?? []) as Array<{ id: string; user_id: string; date: string }>
  const count = rows.length

  // Provenance: the automated status flip joins each affected day's timeline.
  await recordAttendanceEvents(
    supabase,
    rows.map((row) => ({
      userId: row.user_id,
      eventDate: row.date,
      eventType: "marked_incomplete" as const,
      attendanceRecordId: row.id,
      toStatus: "incomplete",
      source: "cron" as const,
      actorId: null,
    }))
  )

  log.info({ date, count }, "Marked attendance records as incomplete")
  return NextResponse.json({ date, marked: count })
}
