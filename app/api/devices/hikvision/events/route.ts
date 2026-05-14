import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"

const log = logger("hikvision-events")

const HikvisionEventSchema = z.object({
  dateTime: z.string(),
  AccessControllerEvent: z.object({
    employeeNoString: z.string().min(1),
    attendanceStatus: z.string(),
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

  // Skip break events
  if (attendanceStatus === "breakIn" || attendanceStatus === "breakOut") {
    return NextResponse.json({ success: true })
  }

  // Resolve employee from hikvision_employee_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("hikvision_employee_id", employeeNoString)
    .eq("employment_status", "active")
    .maybeSingle()

  if (!profile) {
    log.info({ employeeNoString }, "No active profile found for device employee ID — skipping")
    return NextResponse.json({ success: true })
  }

  const userId = profile.id

  // Parse timestamp from device — device sends ISO 8601 with offset
  const eventDate = new Date(dateTime)
  const date = eventDate.toISOString().split("T")[0]
  const time = eventDate.toISOString().split("T")[1].split(".")[0]

  // Determine action: explicit status or toggle logic
  let action: "in" | "out" | "skip"

  if (attendanceStatus === "checkIn") {
    action = "in"
  } else if (attendanceStatus === "checkOut") {
    action = "out"
  } else {
    // Toggle logic for "undefined" or unknown status
    const { data: existing } = await supabase
      .from("attendance_records")
      .select("id, clock_in, clock_out")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle()

    if (!existing || !existing.clock_in) {
      action = "in"
    } else if (!existing.clock_out) {
      action = "out"
    } else {
      action = "skip"
    }
  }

  if (action === "skip") {
    return NextResponse.json({ success: true })
  }

  if (action === "in") {
    const { error } = await supabase.from("attendance_records").upsert(
      {
        user_id: userId,
        date,
        clock_in: time,
        status: "present",
        source: "hikvision",
      },
      {
        onConflict: "user_id,date",
        ignoreDuplicates: false,
      }
    )

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to upsert clock-in")
      return NextResponse.json({ error: "Failed to record clock-in" }, { status: 500 })
    }
  } else {
    // Fetch current record for total_hours calculation
    const { data: existing } = await supabase
      .from("attendance_records")
      .select("id, clock_in")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle()

    if (!existing?.clock_in) {
      // No clock-in to pair with — create a clock-out only record
      const { error } = await supabase
        .from("attendance_records")
        .upsert({ user_id: userId, date, clock_out: time, source: "hikvision" }, { onConflict: "user_id,date" })
      if (error) log.error({ err: String(error) }, "Failed to upsert clock-out (no prior clock-in)")
      return NextResponse.json({ success: true })
    }

    const clockIn = new Date(`${date}T${existing.clock_in}Z`)
    const clockOut = new Date(`${date}T${time}Z`)
    const totalHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60))

    const { error } = await supabase
      .from("attendance_records")
      .update({ clock_out: time, total_hours: totalHours, source: "hikvision" })
      .eq("user_id", userId)
      .eq("date", date)
      .is("clock_out", null)

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
