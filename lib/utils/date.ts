/**
 * Returns the local-time YYYY-MM-DD string for a date (defaults to now).
 * Use instead of date.toISOString().split("T")[0] which returns UTC and
 * shifts dates by -1 day in WAT (UTC+1).
 */
export function toLocalISODate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Returns the local-time YYYY-MM string for a date (defaults to now). */
export function toLocalYearMonth(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

// ─── WAT (West Africa Time, UTC+1, Africa/Lagos) formatters ─────────────────
//
// All user-facing date and time display must use these helpers so timestamps
// are consistently shown in WAT regardless of the server's system timezone or
// the user's browser locale.

const WAT = "Africa/Lagos" as const

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
