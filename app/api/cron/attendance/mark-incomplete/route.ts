import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"

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
