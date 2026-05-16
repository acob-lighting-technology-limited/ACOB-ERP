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
