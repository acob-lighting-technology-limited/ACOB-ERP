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

/** Parses a "HH:MM" time string into minutes since midnight, or null if invalid. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
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
