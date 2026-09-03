// ─── WAT (West Africa Time, UTC+1, Africa/Lagos) formatters ─────────────────
//
// All user-facing date and time display must use these helpers so timestamps
// are consistently shown in WAT regardless of the server's system timezone or
// the user's browser locale.

const WAT = "Africa/Lagos" as const

function getWATDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WAT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ""
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  }
}

function getWATTimeParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WAT,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "00"
  return {
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  }
}

/**
 * Returns the WAT YYYY-MM-DD string for a date (defaults to now).
 * Use instead of date.toISOString().split("T")[0] which returns UTC.
 */
export function toLocalISODate(date: Date = new Date()): string {
  const { year, month, day } = getWATDateParts(date)
  return `${year}-${month}-${day}`
}

/** Returns the WAT YYYY-MM string for a date (defaults to now). */
export function toLocalYearMonth(date: Date = new Date()): string {
  const { year, month } = getWATDateParts(date)
  return `${year}-${month}`
}

/** Returns the WAT HH:mm:ss string for a date (defaults to now). */
export function toLocalTimeString(date: Date = new Date()): string {
  const { hour, minute, second } = getWATTimeParts(date)
  return `${hour}:${minute}:${second}`
}

/** Returns the WAT YYYY-MM-DDTHH:mm value expected by datetime-local inputs. */
export function toLocalDateTimeInput(date: Date = new Date()): string {
  const { year, month, day } = getWATDateParts(date)
  const { hour, minute } = getWATTimeParts(date)
  return `${year}-${month}-${day}T${hour}:${minute}`
}

/**
 * Format a timestamp as a date string in WAT.
 * Default: "25 May 2026"  (day: "numeric", month: "short", year: "numeric")
 * Pass custom options to override (timeZone is always forced to WAT).
 */
export function formatWATDate(date: string | Date, options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
    timeZone: WAT,
  }
  return new Date(date).toLocaleDateString("en-GB", opts)
}

/**
 * Format a stored birthday string (MM-DD, or DD-MM) as "16 June" — day and
 * month only, no year. Returns null when the value is empty or malformed.
 */
export function formatBirthdayLabel(value: string | null | undefined): string | null {
  if (!value) return null

  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})$/)
  if (!match) return null

  const first = Number(match[1])
  const second = Number(match[2])
  const month = first > 12 ? second : first
  const day = first > 12 ? first : second
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  return new Date(Date.UTC(2000, month - 1, day, 12)).toLocaleDateString("en-GB", {
    month: "long",
    day: "numeric",
    timeZone: WAT,
  })
}

/**
 * Display a person's date of birth. Shows the full date ("16 June 2002") when a
 * year is known via `date_of_birth`; otherwise falls back to the day/month from
 * the HR `birthday` field ("16 June") with the year left blank until the person
 * supplies it. Returns null when nothing is known.
 */
export function formatDateOfBirth(
  dateOfBirth: string | null | undefined,
  birthday?: string | null | undefined
): string | null {
  if (dateOfBirth) return formatWATDate(dateOfBirth)
  return formatBirthdayLabel(birthday)
}

/**
 * Format a timestamp as a date+time string in WAT.
 * Default: "25 May 2026, 09:30 AM"
 */
export function formatWATDateTime(
  date: string | Date,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}
): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
    timeZone: WAT,
  }
  return new Date(date).toLocaleString("en-GB", opts)
}

/**
 * Format a timestamp as a time-only string in WAT.
 * Default: "09:30 AM"
 */
export function formatWATTime(date: string | Date, options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
    timeZone: WAT,
  }
  return new Date(date).toLocaleTimeString("en-US", opts)
}

/**
 * Format a timestamp as a short relative label — today/yesterday/date — in WAT.
 * Uses "9:30 AM" for today, "Yesterday" for yesterday, "25 May" for older dates.
 */
export function formatWATRelative(date: string | Date): string {
  const d = new Date(date)
  const nowWAT = new Date(new Date().toLocaleString("en-US", { timeZone: WAT }))
  const dWAT = new Date(d.toLocaleString("en-US", { timeZone: WAT }))

  const todayStart = new Date(nowWAT)
  todayStart.setHours(0, 0, 0, 0)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setDate(todayStart.getDate() - 1)

  if (dWAT >= todayStart) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: WAT })
  }
  if (dWAT >= yesterdayStart) {
    return "Yesterday"
  }
  // Within this year: "25 May"
  if (dWAT.getFullYear() === nowWAT.getFullYear()) {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: WAT })
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: WAT })
}

/**
 * Format a timestamp as "HH:mm, DD MMM YYYY" in WAT (e.g., "08:58, 20 Aug 2026").
 */
export function formatWATTimeDate(date: string | Date | null | undefined): string {
  if (!date) return "-"
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return "-"
  const time = d.toLocaleTimeString("en-GB", { timeZone: WAT, hour: "2-digit", minute: "2-digit", hour12: false })
  const dateStr = d.toLocaleDateString("en-GB", { timeZone: WAT, day: "numeric", month: "short", year: "numeric" })
  return `${time}, ${dateStr}`
}

/**
 * Format a start and end timestamp as a concise date-time range in WAT.
 * Examples:
 * - Same day: "31 Aug 2026, 11:30 – 14:00"
 * - Same year, different day: "31 Aug, 11:30 – 02 Sep 2026, 14:00"
 * - Different years: "31 Dec 2026, 11:30 – 02 Jan 2027, 14:00"
 */
export function formatWATDateTimeRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): string {
  if (!start) return end ? formatWATDateTime(end) : "-"
  if (!end) return formatWATDateTime(start)

  const startDate = new Date(start)
  const endDate = new Date(end)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} - ${end}`
  }

  const startParts = getWATDateParts(startDate)
  const endParts = getWATDateParts(endDate)
  const startTime = startDate.toLocaleTimeString("en-GB", {
    timeZone: WAT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const endTime = endDate.toLocaleTimeString("en-GB", {
    timeZone: WAT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

  // Same calendar day in WAT
  if (startParts.year === endParts.year && startParts.month === endParts.month && startParts.day === endParts.day) {
    const dateLabel = formatWATDate(startDate, { day: "numeric", month: "short", year: "numeric" })
    return `${dateLabel}, ${startTime} – ${endTime}`
  }

  // Same year
  if (startParts.year === endParts.year) {
    const startDateLabel = formatWATDate(startDate, { day: "numeric", month: "short" })
    const endDateLabel = formatWATDate(endDate, { day: "numeric", month: "short", year: "numeric" })
    return `${startDateLabel}, ${startTime} – ${endDateLabel}, ${endTime}`
  }

  // Cross year
  const fullStart = formatWATDateTime(startDate, { day: "numeric", month: "short", year: "numeric" })
  const fullEnd = formatWATDateTime(endDate, { day: "numeric", month: "short", year: "numeric" })
  return `${fullStart} – ${fullEnd}`
}
