import { toLocalISODate, toLocalYearMonth } from "@/lib/utils/date"
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
export { toLocalISODate, toLocalYearMonth }

/** Earliest month digital attendance tracking began — the floor for "all time" ranges and period pickers. */
export const ATTENDANCE_TRACKING_START = "2026-04-01"

/** Returns true if the clock-in time is after the 8:20am grace period. */
export function isLate(clockIn: string | null | undefined): boolean {
  if (!clockIn) return false
  const [h, m] = clockIn.split(":").map(Number)
  if (isNaN(h) || isNaN(m)) return false
  return h * 60 + m > 8 * 60 + 20
}

/**
 * Total hours missed during the standard work window (8:00am–5:00pm).
 * Returns late arrival hours + early departure hours as a decimal.
 */
export function missedHours(clockIn: string | null | undefined, clockOut: string | null | undefined): number {
  if (!clockIn || !clockOut) return 0
  const [ih, im] = clockIn.split(":").map(Number)
  const [oh, om] = clockOut.split(":").map(Number)
  if (isNaN(ih) || isNaN(im) || isNaN(oh) || isNaN(om)) return 0
  const inMin = ih * 60 + im
  const outMin = oh * 60 + om
  const workMinutes = Math.max(0, Math.min(outMin, 17 * 60) - Math.max(inMin, 8 * 60))
  return Math.max(0, 9 - workMinutes / 60)
}

/** Returns the number of hourly late steps starting from the grace cutoff. */
export function getLateSteps(clockIn: string, policy: AttendancePolicy): number {
  const [sh, sm] = policy.startTime.split(":").map(Number)
  const [ch, cm] = clockIn.split(":").map(Number)
  const [lh, lm] = policy.lateCutoff.split(":").map(Number)
  if (isNaN(sh) || isNaN(sm) || isNaN(ch) || isNaN(cm) || isNaN(lh) || isNaN(lm)) return 0
  const startMin = sh * 60 + sm
  const clockInMin = ch * 60 + cm
  const cutoffMin = lh * 60 + lm
  if (clockInMin <= cutoffMin) return 0
  const penaltyStartMin = startMin + 60 // e.g. 09:00 AM (1 hour after 08:00 AM)
  if (clockInMin <= penaltyStartMin) return 1
  return 1 + Math.ceil((clockInMin - penaltyStartMin) / 60)
}

/** Parses a "HH:MM" time string into minutes since midnight, or null if invalid. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/** Hours worked past the policy end time (0 if clocked out at/before end time). */
export function overtimeHoursFor(
  clockOut: string | null | undefined,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): number {
  const outMin = timeToMinutes(clockOut)
  const endMin = timeToMinutes(policy.endTime)
  if (outMin === null || endMin === null || outMin <= endMin) return 0
  return (outMin - endMin) / 60
}

/** Returns the number of hourly early-departure steps, measured against endTime. */
export function getEarlyOutSteps(clockOut: string, endTime: string): number {
  const [eh, em] = endTime.split(":").map(Number)
  const [ch, cm] = clockOut.split(":").map(Number)
  if (isNaN(eh) || isNaN(em) || isNaN(ch) || isNaN(cm)) return 0
  const endMin = eh * 60 + em
  const clockOutMin = ch * 60 + cm
  if (clockOutMin >= endMin) return 0
  return Math.ceil((endMin - clockOutMin) / 60)
}

/** Loads the active attendance policy from system_settings or returns the default. */
export async function loadAttendancePolicy(supabase: any): Promise<AttendancePolicy> {
  try {
    const { data } = await supabase.from("system_settings").select("value").eq("key", "attendance_policy").maybeSingle()
    return { ...DEFAULT_ATTENDANCE_POLICY, ...(data?.value ?? {}) }
  } catch {
    return DEFAULT_ATTENDANCE_POLICY
  }
}

/**
 * Haversine distance between two GPS coordinates in metres.
 * Used by the remote clock-in route to check site proximity.
 */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000 // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Returns all Mon–Fri dates (YYYY-MM-DD) within the given month (YYYY-MM). */
export function getWorkdaysInMonth(yearMonth: string): string[] {
  const [year, month] = yearMonth.split("-").map(Number)
  const days: string[] = []
  const date = new Date(year, month - 1, 1)
  while (date.getMonth() === month - 1) {
    const dow = date.getDay()
    if (dow !== 0 && dow !== 6) {
      days.push(toLocalISODate(date))
    }
    date.setDate(date.getDate() + 1)
  }
  return days
}

/**
 * Fractional day credit for attendance rate calculation.
 * Early / Early Closure: 1.0 (full day; office closed early counts as a full day).
 * Covered (waiver/exempted/on_leave/holiday/OOS/AWP/LWP): 1.0.
 * Present/Late/Incomplete/Left Early: step-based deduction out of totalCredits.
 * Absent: 0.0.
 *
 * `options.earlyCloseTime` measures early-departure against an org-wide early-closure
 * time instead of the policy end time. `options.earlyOutApproved` (or the LEWP status)
 * forgives the early-departure hours — never the late-arrival hours.
 */
export function dayCredit(
  status: string,
  clockIn?: string | null,
  clockOut?: string | null,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY,
  options?: { earlyCloseTime?: string | null; earlyOutApproved?: boolean }
): number {
  if (
    status === "waiver" ||
    status === "exempted" ||
    status === "on_leave" ||
    status === "holiday" ||
    status === "out_of_station" ||
    status === "absent_with_permission" ||
    status === "lateness_with_permission" ||
    status === "early_closure"
  ) {
    return 1.0
  }
  if (status === "half_day") return dayCredit("present", clockIn, clockOut, policy, options)
  if (status === "early") return 1.0

  if (
    status === "present" ||
    status === "late" ||
    status === "incomplete" ||
    status === "early_departure" ||
    status === "early_departure_with_permission"
  ) {
    const totalCredits = policy.totalCredits ?? 10
    const effectiveEnd = options?.earlyCloseTime || policy.endTime
    // LEWP always forgives the early-out; an explicit flag does too.
    const forgiveEarlyOut = Boolean(options?.earlyOutApproved) || status === "early_departure_with_permission"
    let credits = totalCredits

    if (clockIn && clockOut) {
      if (clockOut < policy.lateCutoff) {
        return 0.0
      }
      const lateSteps = getLateSteps(clockIn, policy)
      const earlyOutSteps = forgiveEarlyOut ? 0 : getEarlyOutSteps(clockOut, effectiveEnd)

      const totalDeduction = Math.min(totalCredits - 1, lateSteps + earlyOutSteps)
      credits -= totalDeduction
    } else {
      // Incomplete: missing one punch
      if (clockIn) {
        const lateSteps = getLateSteps(clockIn, policy)
        credits -= lateSteps
      } else if (clockOut) {
        const earlyOutSteps = forgiveEarlyOut ? 0 : getEarlyOutSteps(clockOut, effectiveEnd)
        credits -= earlyOutSteps
      }
      credits -= policy.incompletePenalty
    }

    return Math.max(0.0, Math.min(1.0, credits / totalCredits))
  }
  return 0.0
}

/** Returns all Mon–Fri dates (YYYY-MM-DD) between start and end, inclusive. */
export function getWorkdaysInRange(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number)
  const [ey, em, ed] = end.split("-").map(Number)
  const date = new Date(sy, sm - 1, sd)
  const endDate = new Date(ey, em - 1, ed)
  const days: string[] = []
  while (date <= endDate) {
    const dow = date.getDay()
    if (dow !== 0 && dow !== 6) {
      days.push(toLocalISODate(date))
    }
    date.setDate(date.getDate() + 1)
  }
  return days
}

/** Returns first and last date of a YYYY-MM month as YYYY-MM-DD strings. */
export function monthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number)
  const start = toLocalISODate(new Date(year, month - 1, 1))
  const end = toLocalISODate(new Date(year, month, 0))
  return { start, end }
}

export type Quarter = "Q1" | "Q2" | "Q3" | "Q4"

/** Returns first and last date of a calendar quarter as YYYY-MM-DD strings. */
export function quarterBounds(year: number, quarter: Quarter): { start: string; end: string } {
  const monthStart = quarter === "Q1" ? 1 : quarter === "Q2" ? 4 : quarter === "Q3" ? 7 : 10
  const start = `${year}-${String(monthStart).padStart(2, "0")}-01`
  const monthEnd = monthStart + 2
  const end = toLocalISODate(new Date(Date.UTC(year, monthEnd, 0)))
  return { start, end }
}
