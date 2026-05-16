import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { latenessDeduction } from "@/lib/hr/attendance-utils"

const log = logger("hikvision-events")

const HikvisionEventSchema = z.object({
  dateTime: z.string(),
  AccessControllerEvent: z.object({
    employeeNoString: z.string().min(1).optional(),
    attendanceStatus: z.string().optional(),
    name: z.string().optional(),
    subEventType: z.number().optional(),
  }),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hikvision-events:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const secret = process.env.HIKVISION_WEBHOOK_SECRET
  const token = request.nextUrl.searchParams.get("token")
  if (!secret || token !== secret) {
    log.warn("Invalid or missing webhook token")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "System configuration error" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let raw: string | null = null
  try {
    const formData = await request.formData()
    raw = formData.get("event_log") as string | null
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 })
  }

  if (!raw) {
    return NextResponse.json({ error: "Missing event_log field" }, { status: 400 })
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "event_log is not valid JSON" }, { status: 400 })
  }

  const result = HikvisionEventSchema.safeParse(parsedJson)
  if (!result.success) {
    log.warn({ issues: result.error.issues }, "Invalid Hikvision event payload")
    return NextResponse.json({ error: "Invalid event payload" }, { status: 400 })
  }

  const { dateTime, AccessControllerEvent: event } = result.data
  const { employeeNoString, attendanceStatus } = event

  // Skip events with no employee ID (e.g. door-open access-control events)
  if (!employeeNoString) {
    return NextResponse.json({ success: true })
  }

  // Skip break events
  if (attendanceStatus === "breakIn" || attendanceStatus === "breakOut") {
    return NextResponse.json({ success: true })
  }

  // Resolve employee by matching the numeric suffix of employee_number (e.g. "038" matches "ACOB/2025/038")
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .like("employee_number", `%/${employeeNoString}`)
    .eq("employment_status", "active")
    .maybeSingle()

  if (!profile) {
    log.info({ employeeNoString }, "No active profile found for device employee ID — skipping")
    return NextResponse.json({ success: true })
  }

  const userId = profile.id

  // Strip timezone offset and use the local time as-is from the device
  // e.g. "2026-05-14T17:45:00+01:00" → date="2026-05-14", time="17:45:00"
  const localPart = dateTime.replace(/[+-]\d{2}:\d{2}$/, "")
  const [date, timeFull] = localPart.split("T")
  const time = timeFull ? timeFull.substring(0, 8) : "00:00:00"

  // Fetch today's record to decide clock-in vs clock-out
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id, clock_in, clock_out")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle()

  // First scan of the day → clock-in. Every scan after → update clock-out.
  const action: "in" | "out" = !existing?.clock_in ? "in" : "out"

  if (action === "in") {
    const status = latenessDeduction(time) > 0 ? "late" : "present"
    const { error } = await supabase
      .from("attendance_records")
      .upsert(
        { user_id: userId, date, clock_in: time, status, source: "hikvision" },
        { onConflict: "user_id,date", ignoreDuplicates: false }
      )

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to upsert clock-in")
      return NextResponse.json({ error: "Failed to record clock-in" }, { status: 500 })
    }
  } else {
    const clockIn = new Date(`${date}T${existing!.clock_in}Z`)
    const clockOut = new Date(`${date}T${time}Z`)
    const totalHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60))

    const { error } = await supabase
      .from("attendance_records")
      .update({ clock_out: time, total_hours: totalHours, source: "hikvision" })
      .eq("user_id", userId)
      .eq("date", date)

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to update clock-out")
      return NextResponse.json({ error: "Failed to record clock-out" }, { status: 500 })
    }
  }

  await writeAuditLog(
    supabase,
    {
      action: action === "in" ? "create" : "update",
      entityType: "attendance_record",
      entityId: userId,
      newValues: { date, [action === "in" ? "clock_in" : "clock_out"]: time, source: "hikvision" },
      context: { actorId: userId, source: "api", route: "/api/devices/hikvision/events" },
    },
    { failOpen: true }
  )

  log.info({ userId, date, action, employeeNoString }, "Hikvision attendance recorded")
  return NextResponse.json({ success: true })
}
