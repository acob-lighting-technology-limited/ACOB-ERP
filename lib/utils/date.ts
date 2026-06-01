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
