import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

const log = logger("cron-attendance-mark-incomplete")

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

  // Yesterday in UTC
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const date = yesterday.toISOString().split("T")[0]

  const { data, error } = await supabase
    .from("attendance_records")
    .update({ status: "incomplete" })
    .eq("date", date)
    .is("clock_out", null)
    .neq("status", "absent")
    .select("id")

  if (error) {
    log.error({ err: String(error), date }, "Failed to mark incomplete records")
    return NextResponse.json({ error: "Failed to update records" }, { status: 500 })
  }

  const count = data?.length ?? 0
  log.info({ date, count }, "Marked attendance records as incomplete")
  return NextResponse.json({ date, marked: count })
}
