import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { applyLunchBreak } from "@/lib/hr/attendance-ssot"

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

  // Load attendance policy configuration
  const { data: settingRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "attendance_policy")
    .maybeSingle()
  const policy = (settingRow?.value as AttendancePolicy) || DEFAULT_ATTENDANCE_POLICY

  const { dateTime, AccessControllerEvent: ace } = event
  const { employeeNoString, attendanceStatus } = ace

  // Skip events with no employee ID
  if (!employeeNoString) return

  // Skip break events
  if (attendanceStatus === "breakIn" || attendanceStatus === "breakOut") return

  // Resolve employee by the compact device key enrolled on the Hikvision unit.
  // device_key is derived from employee_number: full-time = numeric suffix (e.g. "063"),
  // contract/part-time = CODE + suffix (e.g. "SIWES001"). Uppercased so casing on the
  // device (e.g. "siwes001") still matches. This is unique per person, unlike the old
  // suffix match which collided across namespaced ID series.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("device_key", employeeNoString.toUpperCase())
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

  // ── After-midnight exit rollback ─────────────────────────────────────────────
  // A swipe in the small hours from someone who has no record yet for the new day
  // but still has an *open* record from the previous day is their (very late) exit,
  // not a fresh clock-in. Left unhandled, the device's exit punch opens a phantom
  // clock-in for the new day and leaves the previous day stuck on "incomplete".
  // We roll it back and use it to close out the previous day instead.
  const AFTER_MIDNIGHT_ROLLBACK_CUTOFF = "04:00:00"
  if (!existing?.clock_in && time < AFTER_MIDNIGHT_ROLLBACK_CUTOFF) {
    const prevDateObj = new Date(`${date}T00:00:00Z`)
    prevDateObj.setUTCDate(prevDateObj.getUTCDate() - 1)
    // eslint-disable-next-line no-restricted-syntax
    const prevDate = prevDateObj.toISOString().slice(0, 10)

    const { data: prev } = await supabase
      .from("attendance_records")
      .select("id, clock_in, clock_out")
      .eq("user_id", userId)
      .eq("date", prevDate)
      .maybeSingle()

    if (prev?.clock_in && !prev.clock_out) {
      // The exit crossed midnight; the schema stores clock_out as a same-day time,
      // so cap it at end of the previous day (23:59:59) rather than the new-day time.
      const cappedOut = "23:59:59"
      const clockInTs = new Date(`${prevDate}T${prev.clock_in}Z`).getTime()
      const cappedOutTs = new Date(`${prevDate}T${cappedOut}Z`).getTime()
      const rawHours = Math.max(0, (cappedOutTs - clockInTs) / (1000 * 60 * 60))
      const { breakMinutes: breakDuration, workedHours: totalHours } = applyLunchBreak(rawHours)

      const status = deriveUnifiedAttendanceStatus(
        {
          record: { clock_in: prev.clock_in, clock_out: cappedOut, status: null, waived: false },
          recordDate: prevDate,
        },
        policy
      )

      const { error } = await supabase
        .from("attendance_records")
        .update({
          clock_out: cappedOut,
          total_hours: totalHours,
          break_duration: breakDuration,
          status,
          source: "hikvision",
          clock_out_source: "hikvision",
        })
        .eq("id", prev.id)

      if (error) {
        log.error(
          { err: String(error), userId, prevDate },
          "Failed to close out prior-day record from after-midnight exit"
        )
        return
      }

      await writeAuditLog(
        supabase,
        {
          action: "update",
          entityType: "attendance_record",
          entityId: prev.id,
          newValues: { clock_out: cappedOut, total_hours: totalHours, status, source: "hikvision" },
          context: { actorId: userId, source: "system", route: "/api/devices/hikvision/events" },
        },
        { failOpen: true }
      )

      await recordAttendanceEvent(supabase, {
        userId,
        eventDate: prevDate,
        eventType: "device_punch_out",
        attendanceRecordId: prev.id,
        source: "hikvision",
        actorId: null,
        metadata: {
          clock_out: cappedOut,
          actual_exit_time: time,
          total_hours: totalHours,
          employee_no: employeeNoString,
          after_midnight_rollback: true,
        },
      })

      log.info(
        { userId, prevDate, time, employeeNoString },
        "Hikvision after-midnight exit rolled back to close prior day"
      )
      return
    }
  }

  // ── Determine action ────────────────────────────────────────────────────────
  const normalised = (attendanceStatus ?? "").toLowerCase().trim()
  let action: "in" | "out"

  if (normalised === "checkin") {
    action = !existing?.clock_in ? "in" : "out"
  } else if (normalised === "checkout") {
    action = "out"
  } else {
    action = !existing?.clock_in ? "in" : "out"
  }

  if (action === "out") {
    const incomingTs = new Date(`${date}T${time}Z`).getTime()

    // Clock-out within 3 minutes of clock-in → reject (accidental tap right after entry)
    if (existing?.clock_in) {
      const clockInTs = new Date(`${date}T${existing.clock_in}Z`).getTime()
      if (incomingTs - clockInTs < 3 * 60_000) {
        log.info({ userId, date, time }, "Hikvision clock-out ignored — within 3-minute grace window of clock_in")
        return
      }
    }
  }

  // ── Write attendance record ─────────────────────────────────────────────────
  if (action === "in") {
    const status = deriveUnifiedAttendanceStatus(
      {
        record: { clock_in: time, clock_out: null, status: null, waived: false },
        recordDate: date,
      },
      policy
    )
    const { data: upserted, error } = await supabase
      .from("attendance_records")
      .upsert(
        { user_id: userId, date, clock_in: time, status, source: "hikvision", clock_in_source: "hikvision" },
        { onConflict: "user_id,date", ignoreDuplicates: false }
      )
      .select("id")
      .single()

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to upsert clock-in")
      return
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "attendance_record",
        entityId: upserted.id,
        newValues: { clock_in: time, status, source: "hikvision" },
        context: { actorId: userId, source: "system", route: "/api/devices/hikvision/events" },
      },
      { failOpen: true }
    )

    await recordAttendanceEvent(supabase, {
      userId,
      eventDate: date,
      eventType: "device_punch_in",
      attendanceRecordId: upserted.id,
      toStatus: status,
      source: "hikvision",
      actorId: null,
      metadata: { clock_in: time, employee_no: employeeNoString },
    })
  } else {
    if (!existing?.clock_in) {
      log.warn({ userId, date, time }, "Hikvision clock-out received but no clock-in on record — skipping")
      return
    }

    const clockIn = new Date(`${date}T${existing.clock_in}Z`)
    const clockOut = new Date(`${date}T${time}Z`)
    const rawHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60))
    const { breakMinutes: breakDuration, workedHours: totalHours } = applyLunchBreak(rawHours)

    const status = deriveUnifiedAttendanceStatus(
      {
        record: { clock_in: existing.clock_in, clock_out: time, status: null, waived: false },
        recordDate: date,
      },
      policy
    )

    const { error } = await supabase
      .from("attendance_records")
      .update({
        clock_out: time,
        total_hours: totalHours,
        break_duration: breakDuration,
        status,
        source: "hikvision",
        clock_out_source: "hikvision",
      })
      .eq("user_id", userId)
      .eq("date", date)

    if (error) {
      log.error({ err: String(error), userId, date }, "Failed to update clock-out")
      return
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "attendance_record",
        entityId: existing.id,
        newValues: { clock_out: time, total_hours: totalHours, status, source: "hikvision" },
        context: { actorId: userId, source: "system", route: "/api/devices/hikvision/events" },
      },
      { failOpen: true }
    )

    await recordAttendanceEvent(supabase, {
      userId,
      eventDate: date,
      eventType: "device_punch_out",
      attendanceRecordId: existing.id,
      source: "hikvision",
      actorId: null,
      metadata: { clock_out: time, total_hours: totalHours, employee_no: employeeNoString },
    })
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

  // ── Process the event before responding ─────────────────────────────────────
  // The DB write MUST complete before we return. Deferring it to after() caused
  // the device to receive 200 while the record was silently never written.
  // Hikvision tolerates the ~1-2s wait for Supabase to finish.
  try {
    await processHikvisionEvent(result.data)
  } catch (err) {
    log.error({ err: String(err) }, "Failed to process Hikvision event")
    // Still return 200 so the device doesn't spam retries; the error is logged.
  }

  return NextResponse.json({ success: true })
}
