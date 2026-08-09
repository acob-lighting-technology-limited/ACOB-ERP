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

/**
 * Day of the office week (1 = start day, 5 = Friday when the year starts on a
 * Monday) on which reporting rolls forward to the next week.
 */
const REPORTING_ROLLOVER_DAY = 5

/** 1-based position of `date` within its office week. */
export function getOfficeWeekDay(date: Date = new Date()): number {
  const { week, year } = getOfficeWeekFromDate(date)
  const weekStart = getOfficeWeekMonday(week, year)
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((startOfDay.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000))
  return diffDays + 1
}

/**
 * The office week people are currently *reporting on*, which is not always the
 * week they are living in.
 *
 * A week's general meeting is the Monday of that week, and reports are filed
 * ahead of it — in practice from the Friday before. So from the rollover day
 * onward the working week is the next one; before it, the current week's
 * meeting has already happened and that week is still the subject.
 *
 * Use this for anything that should follow the reporting cycle (which week a
 * page opens on, which week a new report is filed against) rather than
 * getCurrentOfficeWeek, so the view and the submission can never disagree.
 *
 * Counted as a position within the office week rather than a fixed weekday, so
 * it still means "the last three days" if a year ever starts on another day.
 */
export function getReportingOfficeWeek(date: Date = new Date()): { week: number; year: number } {
  if (getOfficeWeekDay(date) < REPORTING_ROLLOVER_DAY) {
    return getOfficeWeekFromDate(date)
  }
  const nextWeek = addDays(date, 7)
  return getOfficeWeekFromDate(nextWeek)
}

export function getOfficeWeekMonday(week: number, year: number): Date {
  const yearStart = getOfficeYearStart(year)
  return addDays(yearStart, (week - 1) * 7)
}

export function formatOfficeDateWithOrdinal(date: Date): string {
  const day = date.getDate()
  const suffix = [1, 21, 31].includes(day) ? "st" : [2, 22].includes(day) ? "nd" : [3, 23].includes(day) ? "rd" : "th"
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Africa/Lagos" }).format(date)
  return `${day}${suffix} ${month}, ${date.getFullYear()}`
}
