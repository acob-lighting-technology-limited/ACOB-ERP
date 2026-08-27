/**
 * Working-day math for leave, shared by the request dialog and the API.
 *
 * Leave is deducted in working days: weekends never count, and neither does a
 * public holiday on `holiday_calendar`. Keeping this module pure — no Supabase
 * import, no timezone lookups — lets the client preview and the server agree on
 * the numbers without a round trip, and lets the retroactive recalculation
 * reuse exactly the same rules the request was booked under.
 *
 * Every date in and out is a `YYYY-MM-DD` string. Dates are parsed as UTC
 * midnight purely so day arithmetic never drifts across a DST boundary; no
 * value here is ever displayed as a timestamp.
 */

export type LeaveSegmentInput = { start_date: string; end_date: string }

/** Dates (YYYY-MM-DD) that are company holidays and therefore not deducted. */
export type HolidaySet = ReadonlySet<string>

export const NO_HOLIDAYS: HolidaySet = new Set<string>()

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Upper bound on any scan, so a bad date pair can never spin forever. */
const MAX_SCAN_DAYS = 2000

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function toIso(date: Date): string {
  // Formatted from UTC parts on purpose: these are calendar dates being walked,
  // never a timestamp being displayed, so no timezone conversion belongs here.
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Calendar-date arithmetic on ISO strings, free of timezone drift. */
export function addIsoDays(iso: string, days: number): string {
  return toIso(new Date(parseIso(iso).getTime() + days * MS_PER_DAY))
}

const shiftIso = addIsoDays

function isValidIso(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function isWeekend(iso: string): boolean {
  const day = parseIso(iso).getUTCDay()
  return day === 0 || day === 6
}

export function isHoliday(iso: string, holidays: HolidaySet = NO_HOLIDAYS): boolean {
  return holidays.has(iso)
}

/** A day that consumes leave balance: Mon–Fri and not a public holiday. */
export function isWorkingDay(iso: string, holidays: HolidaySet = NO_HOLIDAYS): boolean {
  return !isWeekend(iso) && !isHoliday(iso, holidays)
}

/** Every date from start to end inclusive. Returns [] for an inverted range. */
export function eachIsoDate(startIso: string, endIso: string): string[] {
  if (!isValidIso(startIso) || !isValidIso(endIso) || endIso < startIso) return []
  const dates: string[] = []
  let cursor = startIso
  let guard = 0
  while (cursor <= endIso && guard < MAX_SCAN_DAYS) {
    dates.push(cursor)
    cursor = shiftIso(cursor, 1)
    guard += 1
  }
  return dates
}

/** Working days between two dates inclusive — this is what gets deducted. */
export function countLeaveDays(startIso: string, endIso: string, holidays: HolidaySet = NO_HOLIDAYS): number {
  let count = 0
  for (const iso of eachIsoDate(startIso, endIso)) {
    if (isWorkingDay(iso, holidays)) count += 1
  }
  return count
}

export type LeaveRangeBreakdown = {
  /** Days actually deducted from the balance. */
  workingDays: number
  /** Calendar days in the range, deducted or not. */
  calendarDays: number
  /** Saturdays and Sundays that fell inside the range. */
  weekendDays: number
  /** Public holidays inside the range, excluding any that fell on a weekend. */
  holidayDates: string[]
}

/**
 * Full accounting of a range, so the UI can explain *why* five selected days
 * only cost four ("1 public holiday — Workers Day").
 */
export function describeLeaveRange(
  startIso: string,
  endIso: string,
  holidays: HolidaySet = NO_HOLIDAYS
): LeaveRangeBreakdown {
  const dates = eachIsoDate(startIso, endIso)
  let workingDays = 0
  let weekendDays = 0
  const holidayDates: string[] = []

  for (const iso of dates) {
    if (isWeekend(iso)) {
      weekendDays += 1
      continue
    }
    if (isHoliday(iso, holidays)) {
      holidayDates.push(iso)
      continue
    }
    workingDays += 1
  }

  return { workingDays, calendarDays: dates.length, weekendDays, holidayDates }
}

/**
 * Walks backwards to the last working day on or before `iso`, so a range the
 * employee dragged onto a Saturday reports the Friday as its real end date.
 * Never walks past `floorIso` (the range's own start); returns null if the
 * whole range turned out to contain no working day at all.
 */
export function lastWorkingDayOnOrBefore(
  iso: string,
  holidays: HolidaySet = NO_HOLIDAYS,
  floorIso?: string
): string | null {
  if (!isValidIso(iso)) return null
  const floor = isValidIso(floorIso) ? floorIso : shiftIso(iso, -MAX_SCAN_DAYS)
  let cursor = iso
  let guard = 0
  while (cursor >= floor && guard < MAX_SCAN_DAYS) {
    if (isWorkingDay(cursor, holidays)) return cursor
    cursor = shiftIso(cursor, -1)
    guard += 1
  }
  return null
}

/** First working day on or after `iso` — used to snap a range start forward. */
export function firstWorkingDayOnOrAfter(iso: string, holidays: HolidaySet = NO_HOLIDAYS): string {
  if (!isValidIso(iso)) return iso
  let cursor = iso
  let guard = 0
  while (!isWorkingDay(cursor, holidays) && guard < MAX_SCAN_DAYS) {
    cursor = shiftIso(cursor, 1)
    guard += 1
  }
  return cursor
}

/** The day the employee is expected back: first working day strictly after `iso`. */
export function nextWorkingDayAfter(iso: string, holidays: HolidaySet = NO_HOLIDAYS): string {
  if (!isValidIso(iso)) return iso
  return firstWorkingDayOnOrAfter(shiftIso(iso, 1), holidays)
}

/**
 * Trims a selected range down to the working days it actually covers, so a
 * Mon–Sun selection is stored as Mon–Fri. Returns null when the selection
 * contains no working day (e.g. a bare weekend, or a single holiday).
 */
export function trimRangeToWorkingDays(
  startIso: string,
  endIso: string,
  holidays: HolidaySet = NO_HOLIDAYS
): { start_date: string; end_date: string } | null {
  if (!isValidIso(startIso) || !isValidIso(endIso) || endIso < startIso) return null
  const start = firstWorkingDayOnOrAfter(startIso, holidays)
  if (start > endIso) return null
  const end = lastWorkingDayOnOrBefore(endIso, holidays, start)
  if (!end) return null
  return { start_date: start, end_date: end }
}

export function segmentsWorkingDays(segments: LeaveSegmentInput[], holidays: HolidaySet = NO_HOLIDAYS): number {
  return segments.reduce((sum, segment) => sum + countLeaveDays(segment.start_date, segment.end_date, holidays), 0)
}

/** Combined breakdown across every segment of one request. */
export function describeSegments(
  segments: LeaveSegmentInput[],
  holidays: HolidaySet = NO_HOLIDAYS
): LeaveRangeBreakdown {
  return segments.reduce<LeaveRangeBreakdown>(
    (total, segment) => {
      const part = describeLeaveRange(segment.start_date, segment.end_date, holidays)
      return {
        workingDays: total.workingDays + part.workingDays,
        calendarDays: total.calendarDays + part.calendarDays,
        weekendDays: total.weekendDays + part.weekendDays,
        holidayDates: [...total.holidayDates, ...part.holidayDates],
      }
    },
    { workingDays: 0, calendarDays: 0, weekendDays: 0, holidayDates: [] }
  )
}

/**
 * End and resume dates across all segments. The end date is the last day of the
 * final segment; the resume date is the next working day after it, which is why
 * leave ending on a Friday always reports the following Monday.
 */
export function segmentsDateRange(
  segments: LeaveSegmentInput[],
  holidays: HolidaySet = NO_HOLIDAYS
): { startDate: string; endDate: string; resumeDate: string } {
  if (!segments.length) return { startDate: "", endDate: "", resumeDate: "" }
  const sorted = [...segments].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const startDate = sorted[0].start_date
  const endDate = sorted.reduce((latest, segment) => (segment.end_date > latest ? segment.end_date : latest), sorted[0].end_date)
  return { startDate, endDate, resumeDate: nextWorkingDayAfter(endDate, holidays) }
}
