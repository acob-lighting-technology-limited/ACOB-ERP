"use server"

import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse, after } from "next/server"
import { z } from "zod"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { isLate } from "@/lib/hr/attendance-utils"

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

type ParsedEvent = z.infer<typeof HikvisionEventSchema>

async function processHikvisionEvent(event: ParsedEvent) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    log.error({}, "Missing Supabase env vars — cannot process Hikvision event")
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { dateTime, AccessControllerEvent: ace } = event
  const { employeeNoString, attendanceStatus } = ace

  // Skip events with no employee ID
  if (!employeeNoString) return

  // Skip break events
  if (attendanceStatus === "breakIn" || attendanceStatus === "breakOut") return

  // Resolve employee
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .like("employee_number", `%/${employeeNoString}`)
    .eq("employment_status", "active")
    .maybeSingle()

  if (!profile) {
    log.info({ employeeNoString }, "No active profile found for device employee ID — skipping")
    return
  }

  const userId = profile.id

  // Strip timezone offset — use local time from the device as-is
  const localPart = dateTime.replace(/[+-]\d{2}:\d{2}$/, "")
  const [date, timeFull] = localPart.split("T")
  const time = timeFull ? timeFull.substring(0, 8) : "00:00:00"

  // Fetch today's record
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id, clock_in, clock_out")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle()

  // ── Determine action ────────────────────────────────────────────────────────
  const normalised = (attendanceStatus ?? "").toLowerCase().trim()
  let action: "in" | "out" | "skip"

  if (normalised === "checkin") {
    action = existing?.clock_in ? "skip" : "in"
  } else if (normalised === "checkout") {
    action = "out"
  } else {
    action = !existing?.clock_in ? "in" : "out"
  }

  // ── 30-second deduplication window ─────────────────────────────────────────
  // Because we now respond before processing, the DB race condition is gone —
  // events are processed one-at-a-time in the background. The 30-second window
  // remains as a guard against genuine device retries (e.g. user scans twice).
  if (action === "in" && existing?.clock_in) {
    const existingIn = new Date(`${date}T${existing.clock_in}Z`).getTime()
    const incomingTs = new Date(`${date}T${time}Z`).getTime()
    if (Math.abs(incomingTs - existingIn) <= 30_000) {
      log.info({ userId, date, time }, "Hikvision clock-in deduped — within 30 s of existing clock_in")
      return
    }
  }

  if (action === "out") {
    const incomingTs = new Date(`${date}T${time}Z`).getTime()

    // Clock-out within 5 minutes of clock-in → reject (accidental tap or double-fire)
    if (existing?.clock_in) {
      const clockInTs = new Date(`${date}T${existing.clock_in}Z`).getTime()
      if (incomingTs - clockInTs < 5 * 60_000) {
        log.info({ userId, date, time }, "Hikvision clock-out ignored — within 5-minute grace window of clock_in")
        return
      }
    }

    // Device retry: new clock-out within 30 s of an existing clock-out
    if (existing?.clock_out) {
      const existingOut = new Date(`${date}T${existing.clock_out}Z`).getTime()
      if (Math.abs(incomingTs - existingOut) <= 30_000) {
        log.info({ userId, date, time }, "Hikvision clock-out deduped — within 30 s of existing clock_out")
        return
      }
    }
  }

  if (action === "skip") {
    log.info({ userId, date, attendanceStatus }, "Hikvision checkIn skipped — clock_in already recorded")
    return
  }

  // ── Write attendance record ─────────────────────────────────────────────────
  if (action === "in") {
    const status = isLate(time) ? "late" : "present"
    const { error } = await supabase
      .from("attendance_records")
      .upsert(
        { user_id: userId, date, clock_in: time, status, source: "hikvision" },
        { onConflict: "user_id,date", ignoreDuplicates: false }
      )

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to upsert clock-in")
    }
  } else {
    if (!existing?.clock_in) {
      log.warn({ userId, date, time }, "Hikvision clock-out received but no clock-in on record — skipping")
      return
    }

    const clockIn = new Date(`${date}T${existing.clock_in}Z`)
    const clockOut = new Date(`${date}T${time}Z`)
    const totalHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60))

    const { error } = await supabase
      .from("attendance_records")
      .update({ clock_out: time, total_hours: totalHours, source: "hikvision" })
      .eq("user_id", userId)
      .eq("date", date)

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to update clock-out")
    }
  }

  log.info({ userId, date, action, employeeNoString }, "Hikvision attendance recorded")
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hikvision-events:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = process.env.HIKVISION_WEBHOOK_SECRET
  const authHeader = request.headers.get("authorization")
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  const queryToken = request.nextUrl.searchParams.get("token")
  const token = bearerToken ?? queryToken
  if (!secret || token !== secret) {
    log.warn("Invalid or missing webhook token")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── Parse & validate body (must happen before responding) ──────────────────
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

  // ── Respond immediately so the device never retries ─────────────────────────
  // All DB work runs in the background via after(). The device gets its 200 OK
  // in milliseconds regardless of how long Supabase takes.
  after(async () => {
    await processHikvisionEvent(result.data)
  })

  return NextResponse.json({ success: true })
}
