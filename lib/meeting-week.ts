import { formatWATDate } from "@/lib/utils/date"

const DEFAULT_ANCHOR_DAY = 12

// Module-level cache: year → January day. Populated by initOfficeYearAnchors().
const anchorCache: Record<number, number> = {}

/** Call once on app load to populate per-year anchors from the API. */
export async function initOfficeYearAnchors(): Promise<void> {
  try {
    const res = await fetch("/api/reports/office-year-config")
    if (!res.ok) return
    const { data } = (await res.json()) as { data: { year: number; anchor_day: number }[] }
    for (const row of data) anchorCache[row.year] = row.anchor_day
  } catch {
    // Fail silently — hardcoded fallback will be used.
  }
}

export function getAnchorDay(year: number): number {
  return anchorCache[year] ?? DEFAULT_ANCHOR_DAY
}

function getOfficeYearStart(year: number): Date {
  return new Date(year, 0, getAnchorDay(year))
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function getWeeksInOfficeYear(year: number): number {
  const start = getOfficeYearStart(year)
  const nextStart = getOfficeYearStart(year + 1)
  const diffMs = nextStart.getTime() - start.getTime()
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000))
}

export function getOfficeWeekFromDate(date: Date): { week: number; year: number } {
  const input = new Date(date)
  let year = input.getFullYear()
  let yearStart = getOfficeYearStart(year)

  if (input < yearStart) {
    year -= 1
    yearStart = getOfficeYearStart(year)
  }

  const diffMs = input.getTime() - yearStart.getTime()
  const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1

  return { week, year }
}

export function getCurrentOfficeWeek(date: Date = new Date()): { week: number; year: number } {
  return getOfficeWeekFromDate(date)
}

export function getOfficeWeekMonday(week: number, year: number): Date {
  const yearStart = getOfficeYearStart(year)
  return addDays(yearStart, (week - 1) * 7)
}

export function formatOfficeDateWithOrdinal(date: Date): string {
  const day = date.getDate()
  const suffix = [1, 21, 31].includes(day) ? "st" : [2, 22].includes(day) ? "nd" : [3, 23].includes(day) ? "rd" : "th"
  const month = formatWATDate(date, { month: "long" })
  return `${day}${suffix} ${month}, ${date.getFullYear()}`
}
