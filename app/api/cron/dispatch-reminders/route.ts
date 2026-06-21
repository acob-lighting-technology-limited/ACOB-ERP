import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

const log = logger("cron-dispatch-reminders")

// WAT is UTC+1. All send_time values are stored in WAT.
const WAT_OFFSET_HOURS = 1

/** Constant-time string comparison to guard against timing attacks. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const

/**
 * Advance next_run_at to the same weekday + time (WAT) in the following week.
 * send_time is stored as a Postgres `time` e.g. "07:00:00" and is WAT local.
 */
function computeNextRecurringRunAt(sendDay: string, sendTime: string): string {
  const targetDayIndex = DAY_NAMES.indexOf(sendDay.toLowerCase() as (typeof DAY_NAMES)[number])
  if (targetDayIndex === -1) throw new Error(`Unknown send_day: ${sendDay}`)

  const [hStr, mStr] = sendTime.split(":")
  const hoursWat = Number(hStr)
  const minutes = Number(mStr)
  const hoursUtc = hoursWat - WAT_OFFSET_HOURS

  const nowUtc = new Date()
  const currentDayIndexUtc = nowUtc.getUTCDay()

  // Always push at least 1 day ahead to avoid re-firing immediately.
  let daysUntil = targetDayIndex - currentDayIndexUtc
  if (daysUntil <= 0) daysUntil += 7

  const nextRun = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + daysUntil, hoursUtc, minutes, 0, 0)
  )
  return nextRun.toISOString()
}

// ── Local types ────────────────────────────────────────────────────────────────

type ReminderType = "meeting" | "knowledge_sharing" | "admin_broadcast"
type ScheduleType = "one_time" | "recurring"

type ReminderScheduleRow = {
  id: string
  schedule_type: ScheduleType
  reminder_type: ReminderType
  recipients: string[]
  is_active: boolean
  send_day: string | null
  send_time: string
  meeting_config: Record<string, unknown>
  next_run_at: string
}

type KssRosterRow = {
  id: string
  meeting_week: number
  meeting_year: number
  department: string
  presenter_id: string | null
  full_name: string | null
}

// ── Office week helper (mirrors edge function logic) ──────────────────────────

const DEFAULT_ANCHOR_DAY = 12

function getOfficeWeekFromDate(date: Date, anchorDay = DEFAULT_ANCHOR_DAY): { week: number; year: number } {
  const input = new Date(date)
  let year = input.getFullYear()
  let yearStart = new Date(year, 0, anchorDay)

  if (input < yearStart) {
    year -= 1
    yearStart = new Date(year, 0, anchorDay)
  }

  const diffMs = input.getTime() - yearStart.getTime()
  const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1
  return { week, year }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // 1. Auth — only Vercel's cron runner (bearing CRON_SECRET) may call this.
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`
  if (!safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    log.error({}, "Missing Supabase configuration")
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const now = new Date()

  // 2. Fetch all active schedules that are due (next_run_at <= NOW).
  const { data: dueSchedules, error: fetchError } = await supabase
    .from("reminder_schedules")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", now.toISOString())

  if (fetchError) {
    log.error({ err: String(fetchError.message) }, "Failed to fetch due reminder schedules")
    return NextResponse.json({ error: "DB fetch failed" }, { status: 500 })
  }

  const rows = (dueSchedules ?? []) as ReminderScheduleRow[]
  log.info({ count: rows.length, at: now.toISOString() }, "Dispatching due reminder schedules")

  if (rows.length === 0) {
    return NextResponse.json({ dispatched: 0, skipped: 0 })
  }

  // 3. Resolve the current office week once (used for recurring meeting KSS enrichment).
  const currentOfficeWeek = getOfficeWeekFromDate(now)

  // 4. Try to load the KSS roster entry for the current week (best-effort).
  let kssRow: KssRosterRow | null = null
  try {
    const { data: kssData } = await supabase
      .from("kss_weekly_roster")
      .select("id, meeting_week, meeting_year, department, presenter_id, profiles!inner(full_name)")
      .eq("meeting_week", currentOfficeWeek.week)
      .eq("meeting_year", currentOfficeWeek.year)
      .maybeSingle()

    if (kssData) {
      // PostgREST join shape: profiles is an object with full_name
      const profilesField = (kssData as Record<string, unknown>)["profiles"] as { full_name?: string | null } | null
      kssRow = {
        id: (kssData as Record<string, unknown>)["id"] as string,
        meeting_week: (kssData as Record<string, unknown>)["meeting_week"] as number,
        meeting_year: (kssData as Record<string, unknown>)["meeting_year"] as number,
        department: (kssData as Record<string, unknown>)["department"] as string,
        presenter_id: (kssData as Record<string, unknown>)["presenter_id"] as string | null,
        full_name: profilesField?.full_name ?? null,
      }
    }
  } catch (kssErr) {
    log.warn(
      { err: String(kssErr), week: currentOfficeWeek.week, year: currentOfficeWeek.year },
      "KSS roster lookup failed — sending without enrichment"
    )
  }

  // 5. Process each due schedule.
  let dispatched = 0
  let skipped = 0

  for (const schedule of rows) {
    try {
      // 5a. Build the payload for the edge function from the saved meeting_config.
      const baseConfig = schedule.meeting_config ?? {}

      const targetFunction =
        schedule.reminder_type === "admin_broadcast" ? "send-communications-mail" : "send-meeting-reminder"

      // For recurring meeting reminders, enrich with live KSS roster data.
      let enrichedConfig: Record<string, unknown> = { ...baseConfig, recipients: schedule.recipients }

      if (schedule.reminder_type === "meeting" && schedule.schedule_type === "recurring") {
        if (kssRow) {
          enrichedConfig = {
            ...enrichedConfig,
            knowledgeSharingDepartment: kssRow.department,
            knowledgeSharingPresenter: kssRow.full_name
              ? { id: kssRow.presenter_id ?? undefined, full_name: kssRow.full_name, department: kssRow.department }
              : undefined,
            kssRosterStatus: "found",
            // Clear the stale week/year from when the schedule was originally created;
            // the edge function will resolve it from the current office week.
            meetingWeek: undefined,
            meetingYear: undefined,
            meetingDate: undefined,
          }
        } else {
          enrichedConfig = {
            ...enrichedConfig,
            kssRosterStatus: "missing",
          }
        }
      }

      // 5b. Call the Supabase edge function.
      const edgeFnUrl = `${supabaseUrl}/functions/v1/${targetFunction}`
      const edgeRes = await fetch(edgeFnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify(enrichedConfig),
      })

      if (!edgeRes.ok) {
        const errBody = await edgeRes.text().catch(() => "(unreadable)")
        log.error({ scheduleId: schedule.id, status: edgeRes.status, body: errBody }, "Edge function returned non-2xx")
        skipped++
        continue
      }

      log.info({ scheduleId: schedule.id, type: schedule.reminder_type }, "Reminder dispatched successfully")
      dispatched++

      // 5c. Advance or deactivate the schedule.
      if (schedule.schedule_type === "recurring" && schedule.send_day) {
        const nextRunAt = computeNextRecurringRunAt(schedule.send_day, schedule.send_time)
        const { error: updateErr } = await supabase
          .from("reminder_schedules")
          .update({ next_run_at: nextRunAt, updated_at: new Date().toISOString() })
          .eq("id", schedule.id)

        if (updateErr) {
          log.error({ scheduleId: schedule.id, err: String(updateErr.message) }, "Failed to advance next_run_at")
        } else {
          log.info({ scheduleId: schedule.id, nextRunAt }, "next_run_at advanced")
        }
      } else {
        // One-time schedule — deactivate after firing.
        const { error: deactivateErr } = await supabase
          .from("reminder_schedules")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", schedule.id)

        if (deactivateErr) {
          log.error(
            { scheduleId: schedule.id, err: String(deactivateErr.message) },
            "Failed to deactivate one-time schedule"
          )
        } else {
          log.info({ scheduleId: schedule.id }, "One-time schedule deactivated")
        }
      }
    } catch (dispatchErr) {
      log.error({ scheduleId: schedule.id, err: String(dispatchErr) }, "Unexpected error dispatching schedule")
      skipped++
    }
  }

  log.info({ dispatched, skipped, total: rows.length }, "Dispatch cycle complete")
  return NextResponse.json({ dispatched, skipped, total: rows.length })
}
