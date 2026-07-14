import type { SupabaseClient } from "@supabase/supabase-js"
import { toLocalISODate } from "@/lib/hr/attendance-utils"

/**
 * Single source for the "what covers this day" context that attendance status
 * derivation needs — org holidays, approved leave, and exemption periods. Previously
 * each read endpoint (reports / admin records / employee-days) gathered and expanded
 * these independently, which risked drift. They all call this instead and feed the
 * result to deriveUnifiedAttendanceStatus.
 *
 * The expansion logic (inclusive date range → set of YYYY-MM-DD) is identical to what
 * those endpoints did inline, so behaviour is unchanged.
 */

export interface DayContext {
  isHoliday(date: string): boolean
  isOnLeave(userId: string, date: string): boolean
  /** Period-based exemption only — does NOT include the profile.attendance_exempt flag. */
  isExempt(userId: string, date: string): boolean
  /** Org-wide early-closure time (HH:MM) for the date, or null if not a closure day. */
  earlyCloseTime(date: string): string | null
}

function expandInto(target: Set<string>, startDate: string, endDate: string) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) target.add(toLocalISODate(d))
}

export async function loadDayContext(
  client: SupabaseClient,
  params: { userIds: string[]; start: string; end: string }
): Promise<DayContext> {
  const { userIds, start, end } = params

  const holidayDates = new Set<string>()
  const leaveByUser = new Map<string, Set<string>>()
  const exemptByUser = new Map<string, Set<string>>()
  const closureByDate = new Map<string, string>()

  // Org-wide early-closure days apply regardless of user set.
  const { data: closures } = await client
    .from("attendance_early_closures")
    .select("closure_date, close_time")
    .gte("closure_date", start)
    .lte("closure_date", end)
  for (const c of (closures ?? []) as Array<{ closure_date: string; close_time: string }>) {
    if (c.closure_date && c.close_time) closureByDate.set(c.closure_date, String(c.close_time).slice(0, 5))
  }

  if (userIds.length === 0) {
    // Still load holidays so callers with no users (rare) behave sanely.
    const { data: holidays } = await client
      .from("holiday_calendar")
      .select("holiday_date")
      .gte("holiday_date", start)
      .lte("holiday_date", end)
    for (const h of (holidays ?? []) as Array<{ holiday_date: string }>) holidayDates.add(h.holiday_date)
  } else {
    const [{ data: holidays }, { data: leaves }, { data: periods }] = await Promise.all([
      client.from("holiday_calendar").select("holiday_date").gte("holiday_date", start).lte("holiday_date", end),
      client
        .from("leave_requests")
        .select("user_id, start_date, end_date")
        .in("user_id", userIds)
        .eq("status", "approved")
        .lte("start_date", end)
        .gte("end_date", start),
      client
        .from("attendance_exempt_periods")
        .select("user_id, start_date, end_date")
        .in("user_id", userIds)
        .lte("start_date", end)
        .gte("end_date", start),
    ])

    for (const h of (holidays ?? []) as Array<{ holiday_date: string }>) holidayDates.add(h.holiday_date)

    for (const lr of (leaves ?? []) as Array<{ user_id: string; start_date: string; end_date: string }>) {
      if (!leaveByUser.has(lr.user_id)) leaveByUser.set(lr.user_id, new Set())
      expandInto(leaveByUser.get(lr.user_id)!, lr.start_date, lr.end_date)
    }

    for (const ep of (periods ?? []) as Array<{ user_id: string; start_date: string; end_date: string }>) {
      if (!exemptByUser.has(ep.user_id)) exemptByUser.set(ep.user_id, new Set())
      expandInto(exemptByUser.get(ep.user_id)!, ep.start_date, ep.end_date)
    }
  }

  return {
    isHoliday: (date) => holidayDates.has(date),
    isOnLeave: (userId, date) => leaveByUser.get(userId)?.has(date) ?? false,
    isExempt: (userId, date) => exemptByUser.get(userId)?.has(date) ?? false,
    earlyCloseTime: (date) => closureByDate.get(date) ?? null,
  }
}
