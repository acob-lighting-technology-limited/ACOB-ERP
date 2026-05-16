import { toLocalISODate, toLocalYearMonth } from "@/lib/utils/date"
export { toLocalISODate, toLocalYearMonth }

/**
 * Lateness deduction rules:
 * - Grace period: up to 8:20am → ₦0
 * - Each hour bracket from 8:00am after grace → +₦1,000
 * - 8:21–8:59 = ₦1,000 | 9:00–9:59 = ₦2,000 | 10:00–10:59 = ₦3,000 …
 */
export function latenessDeduction(clockIn: string | null | undefined): number {
  if (!clockIn) return 0
  const [h, m] = clockIn.split(":").map(Number)
  if (isNaN(h) || isNaN(m)) return 0
  const totalMinutes = h * 60 + m
  const graceEnd = 8 * 60 + 20 // 8:20am
  const dayStart = 8 * 60 // 8:00am
  if (totalMinutes <= graceEnd) return 0
  const minutesSinceStart = totalMinutes - dayStart
  return (Math.floor(minutesSinceStart / 60) + 1) * 1000
}

/** Flat deduction applied to a fully absent day (no clock-in at all). */
export const ABSENT_DEDUCTION = 10_000

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`
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

/** Returns first and last date of a YYYY-MM month as YYYY-MM-DD strings. */
export function monthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number)
  const start = toLocalISODate(new Date(year, month - 1, 1))
  const end = toLocalISODate(new Date(year, month, 0))
  return { start, end }
}
