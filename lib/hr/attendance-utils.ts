import { toLocalISODate, toLocalYearMonth } from "@/lib/utils/date"
export { toLocalISODate, toLocalYearMonth }

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
 * Present/Late: proportional to hours worked in the 8am–5pm window.
 * Half-day: 0.5 fixed (no clock_out to compute exact hours).
 * Covered (waiver/exempted/on_leave/holiday): 1.0.
 * Absent/Incomplete: 0.0.
 */
export function dayCredit(status: string, clockIn?: string | null, clockOut?: string | null): number {
  if (status === "waiver" || status === "exempted" || status === "on_leave" || status === "holiday") return 1.0
  if (status === "half_day") return 0.5
  if (status === "present" || status === "late") {
    const missed = missedHours(clockIn, clockOut)
    return Math.max(0, Math.min(1.0, (9 - missed) / 9))
  }
  return 0.0
}

/** Returns first and last date of a YYYY-MM month as YYYY-MM-DD strings. */
export function monthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number)
  const start = toLocalISODate(new Date(year, month - 1, 1))
  const end = toLocalISODate(new Date(year, month, 0))
  return { start, end }
}
