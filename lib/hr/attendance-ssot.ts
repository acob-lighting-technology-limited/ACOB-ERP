import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { timeToMinutes } from "@/lib/hr/attendance-utils"

/**
 * SINGLE SOURCE OF TRUTH for attendance penalty maths.
 *
 * Every consumer — payroll deductions, HR reports, the staff dashboard, the
 * leaderboard and PMS performance scoring — must derive its numbers from
 * `computeAttendanceDay()`. Nothing may re-implement bracket logic locally.
 *
 * Companion single sources (already in place, unchanged by this module):
 *   - `attendance-day-context.ts`  → what *covers* a day (holiday / leave / exemption)
 *   - `attendance-status.ts`       → which *status* a day carries
 *   - this file                    → what that day *costs*, in hours
 *
 * ── The penalty model ────────────────────────────────────────────────────────
 * Shift is 08:00–17:00 (9h gross) less a 30-minute lunch ⇒ 8.5h net expected.
 *
 * Late arrival — 08:00–08:20 is grace (0). Thereafter one hour is lost per
 * hour-bracket entered:
 *     08:21–09:00 → -1     09:01–10:00 → -2     10:01–11:00 → -3
 *     11:01–12:00 → -4     …                    16:01–17:00 → -9
 *
 * Early departure — mirrored back from 17:00, with NO grace period:
 *     16:01–17:00 → -1     15:01–16:00 → -2     14:01–15:00 → -3
 *     13:01–14:00 → -4     …                    08:00–09:00 → -9
 *
 * Late and early penalties add together, capped at the 8.5h net day. The worst
 * bracket (-9, i.e. -8.5 once lunch is removed) lands exactly on a full day's
 * loss, so extreme lateness degrades into "absent" naturally rather than
 * needing a separate cutoff rule.
 *
 * Covered days (approved leave, holidays, exemptions, org-wide early closure or
 * late resumption, AWP/LWP/OOS) cost 0 hours and never reach the bracket maths.
 */

/** Gross scheduled shift length under the default policy, 08:00–17:00. */
export const GROSS_DAY_HOURS = 9
/** Unpaid lunch break in minutes under the default policy. */
export const LUNCH_MINUTES = 30
/**
 * Net expected hours per full working day under the DEFAULT policy.
 *
 * Prefer `netDayHoursFor(policy)` anywhere the active policy is available — this
 * constant only matches while management leaves the shift times and lunch at
 * their defaults. It exists for display surfaces that have no policy to hand.
 */
export const NET_DAY_HOURS = GROSS_DAY_HOURS - LUNCH_MINUTES / 60

/** Gross shift length in hours for a policy, from its start and end times. */
export function grossDayHoursFor(policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY): number {
  const startMin = timeToMinutes(policy.startTime)
  const endMin = timeToMinutes(policy.endTime)
  if (startMin === null || endMin === null || endMin <= startMin) return GROSS_DAY_HOURS
  return (endMin - startMin) / 60
}

/**
 * Net expected hours for a full working day under a policy — the shift length
 * less the unpaid lunch break. This is the ceiling on what a single day can cost.
 */
export function netDayHoursFor(policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY): number {
  const lunch = policy.lunchMinutes ?? LUNCH_MINUTES
  return Math.max(0, grossDayHoursFor(policy) - lunch / 60)
}

/**
 * Statuses where the day is covered and costs the employee nothing.
 * Kept as a plain string set so this module stays free of import cycles with
 * `attendance-status.ts`.
 */
const COVERED_STATUSES = new Set([
  "waiver",
  "exempted",
  "on_leave",
  "holiday",
  "out_of_station",
  "absent_with_permission",
  "absence_with_permission",
  "awp",
  "lateness_with_permission",
  "lwp",
  "early_closure",
  "late_resumption",
  "leave_without_pay",
  "lwop",
  "early",
])

export interface AttendanceDayInput {
  /** Derived day status, from `deriveUnifiedAttendanceStatus`. */
  status: string
  clockIn?: string | null
  clockOut?: string | null
  policy?: AttendancePolicy
  /** Org-wide early-closure time (HH:MM); early departure is measured against it. */
  earlyCloseTime?: string | null
  /** Org-wide late-resumption time (HH:MM); late arrival is measured from it, no grace. */
  lateResumptionTime?: string | null
  /** LEWP / explicit approval — forgives the early-departure hours only, never lateness. */
  earlyOutApproved?: boolean
}

export interface AttendanceDayResult {
  status: string
  /** Hours deducted for this day (0 … NET_DAY_HOURS). The number payroll charges for. */
  hoursLost: number
  /** Hours credited for this day (NET_DAY_HOURS − hoursLost). */
  hoursWorked: number
  /** True when the day cost a full day's hours. */
  isAbsent: boolean
  /** True when the day was protected and no bracket maths ran. */
  covered: boolean
  /** Hours worked past the policy end time. */
  overtimeHours: number
  lateBracket: number
  earlyBracket: number
  /** Human-readable reasoning, so HR can explain any figure to an employee. */
  breakdown: string
}

/**
 * Late-arrival bracket for a clock-in time. 0 when within grace.
 *
 * On a late-resumption day there is no grace: brackets are measured in whole
 * hours from the announced resumption time.
 */
export function lateBracketFor(
  clockIn: string | null | undefined,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY,
  lateResumptionTime?: string | null
): number {
  const inMin = timeToMinutes(clockIn)
  if (inMin === null) return 0

  const resumptionMin = timeToMinutes(lateResumptionTime)
  if (resumptionMin !== null) {
    if (inMin <= resumptionMin) return 0
    return Math.ceil((inMin - resumptionMin) / 60)
  }

  const graceEnd = timeToMinutes(policy.lateCutoff)
  const startMin = timeToMinutes(policy.startTime)
  if (graceEnd === null || startMin === null) return 0

  if (inMin <= graceEnd) return 0
  // The first bracket runs from the end of grace to one hour after shift start
  // (08:21–09:00). Every hour beyond that adds one more.
  const firstBracketEnd = startMin + 60
  if (inMin <= firstBracketEnd) return 1
  return Math.ceil((inMin - firstBracketEnd) / 60) + 1
}

/**
 * Early-departure bracket for a clock-out time, measured back from `endTime`.
 * No grace period. Brackets are the windows X:01–(X+1):00, so a clock-out
 * landing exactly on the hour belongs to the bracket below it.
 *
 * Clamped to the number of hours in the shift: leaving at the very start of the
 * day sits fractionally outside the last window, and must not spill into a
 * tenth bracket that the shift has no room for.
 */
export function earlyBracketFor(
  clockOut: string | null | undefined,
  endTime: string,
  startTime: string = DEFAULT_ATTENDANCE_POLICY.startTime
): number {
  const outMin = timeToMinutes(clockOut)
  const endMin = timeToMinutes(endTime)
  if (outMin === null || endMin === null) return 0
  if (outMin >= endMin) return 0

  const startMin = timeToMinutes(startTime)
  const maxBracket = startMin !== null && endMin > startMin ? Math.ceil((endMin - startMin) / 60) : Infinity
  return Math.min(maxBracket, Math.floor((endMin - outMin) / 60) + 1)
}

/** Hours worked past the policy end time (0 if clocked out at or before it). */
export function overtimeHoursFor(
  clockOut: string | null | undefined,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): number {
  const outMin = timeToMinutes(clockOut)
  const endMin = timeToMinutes(policy.endTime)
  if (outMin === null || endMin === null || outMin <= endMin) return 0
  return (outMin - endMin) / 60
}

/**
 * The one calculation. Resolves a single employee-day into the hours it cost.
 */
export function computeAttendanceDay(input: AttendanceDayInput): AttendanceDayResult {
  const policy = input.policy ?? DEFAULT_ATTENDANCE_POLICY
  const status = String(input.status || "").toLowerCase()
  const { clockIn, clockOut } = input
  const netDay = netDayHoursFor(policy)

  const build = (
    hoursLost: number,
    breakdown: string,
    extra?: { covered?: boolean; lateBracket?: number; earlyBracket?: number }
  ): AttendanceDayResult => {
    const lost = Math.max(0, Math.min(netDay, hoursLost))
    return {
      status,
      hoursLost: lost,
      hoursWorked: Math.max(0, netDay - lost),
      isAbsent: lost >= netDay,
      covered: extra?.covered ?? false,
      overtimeHours: overtimeHoursFor(clockOut, policy),
      lateBracket: extra?.lateBracket ?? 0,
      earlyBracket: extra?.earlyBracket ?? 0,
      breakdown,
    }
  }

  // 1. Covered days never reach the bracket maths.
  if (COVERED_STATUSES.has(status)) {
    return build(0, "Covered day — no hours lost", { covered: true })
  }

  // 2. No punches at all.
  if (status === "absent" || (!clockIn && !clockOut)) {
    return build(netDay, `Absent — full day (${netDay}h) lost`)
  }

  const effectiveEnd = input.earlyCloseTime || policy.endTime
  const forgiveEarlyOut = Boolean(input.earlyOutApproved) || status === "early_departure_with_permission"

  const lateBracket = lateBracketFor(clockIn, policy, input.lateResumptionTime)
  const earlyBracket = forgiveEarlyOut ? 0 : earlyBracketFor(clockOut, effectiveEnd, policy.startTime)

  // 3. One punch missing — charge the side we know, plus the incomplete penalty,
  //    since the other half of the day is unverifiable.
  if (!clockIn || !clockOut) {
    const knownSide = clockIn ? lateBracket : earlyBracket
    const penalty = policy.incompletePenalty ?? 1
    const parts = [
      clockIn ? `late bracket ${lateBracket} = -${lateBracket}` : `early bracket ${earlyBracket} = -${earlyBracket}`,
      `missing punch = -${penalty}`,
    ]
    return build(knownSide + penalty, `Incomplete: ${parts.join(", ")}`, {
      lateBracket: clockIn ? lateBracket : 0,
      earlyBracket: clockIn ? 0 : earlyBracket,
    })
  }

  // 4. Both punches present — late and early penalties stack.
  const parts: string[] = []
  if (lateBracket > 0) parts.push(`late bracket ${lateBracket} = -${lateBracket}`)
  if (earlyBracket > 0) parts.push(`early bracket ${earlyBracket} = -${earlyBracket}`)
  if (forgiveEarlyOut && earlyBracketFor(clockOut, effectiveEnd, policy.startTime) > 0)
    parts.push("early departure approved = -0")

  const breakdown = parts.length > 0 ? parts.join(", ") : "On time — no hours lost"
  return build(lateBracket + earlyBracket, breakdown, { lateBracket, earlyBracket })
}

/**
 * Splits a raw clocked span into the unpaid lunch break and the hours actually
 * credited. Every write path that stores `total_hours` / `break_duration` must
 * use this — the rule was previously copy-pasted across five routes and omitted
 * entirely from remote clock-out, which quietly credited remote staff an extra
 * hour a day.
 *
 * Both the break length and the qualifying day length come from the policy, so
 * management can change them in settings without a deploy.
 */
export function applyLunchBreak(
  rawHours: number,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): { breakMinutes: number; workedHours: number } {
  const qualifying = policy.lunchQualifyingHours ?? 5
  const lunch = policy.lunchMinutes ?? LUNCH_MINUTES
  const breakMinutes = rawHours >= qualifying ? lunch : 0
  return { breakMinutes, workedHours: Math.max(0, rawHours - breakMinutes / 60) }
}

/**
 * Derived percentage view of a day or period, for surfaces that need a 0–100
 * score (PMS weighting, dashboard rates). Always derived from `hoursLost` so it
 * can never drift from the hours figure payroll uses.
 */
export function attendanceRateFrom(
  hoursLost: number,
  days = 1,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): number {
  const expected = netDayHoursFor(policy) * Math.max(1, days)
  const worked = Math.max(0, expected - hoursLost)
  return Math.round((worked / expected) * 10000) / 100
}
