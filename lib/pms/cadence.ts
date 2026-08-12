/**
 * Review-cycle cadence helpers.
 *
 * `review_cycles.review_type` is free text (the cycle editor writes "quarterly",
 * "mid_year", "annual", "probation", "ad_hoc"; older rows use other spellings),
 * so every cadence comparison in PMS goes through here rather than doing its own
 * string matching. Quarterly is the cadence PMS actually scores on — half-year
 * and annual cycles overlap the same dates, so without an explicit cadence check
 * they leak into quarterly views.
 */

export type PmsCadence = "all" | "quarterly" | "biannual" | "annual"

export type CadenceCycle = {
  id: string
  review_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

const HALF_YEAR_MARKERS = ["biannual", "semiannual", "midyear", "halfyear", "h1", "h2"]

function normalize(reviewType: string | null | undefined) {
  return (reviewType || "").toLowerCase().replace(/[\s_-]/g, "")
}

/** Does a cycle's review_type belong to the chosen cadence? */
export function matchesCadence(cadence: string, reviewType: string | null | undefined): boolean {
  if (cadence === "all") return true
  const value = normalize(reviewType)
  const isHalfYear = HALF_YEAR_MARKERS.some((marker) => value.includes(marker))
  if (cadence === "quarterly") return value.includes("quarter")
  if (cadence === "biannual") return isHalfYear
  // Annual must not swallow "Bi-Annual" / "Mid-Year".
  if (cadence === "annual") return !isHalfYear && (value.includes("annual") || value.includes("fullyear"))
  return true
}

export function isQuarterlyCycle(reviewType: string | null | undefined): boolean {
  return matchesCadence("quarterly", reviewType)
}

/**
 * Cycles of the given cadence, newest first. Falls back to the full list when
 * nothing matches, so a database with unlabelled review_types still renders
 * something instead of an empty picker.
 */
export function cyclesForCadence<T extends CadenceCycle>(cycles: T[], cadence: PmsCadence = "quarterly"): T[] {
  const matching = cycles.filter((cycle) => matchesCadence(cadence, cycle.review_type))
  return matching.length > 0 ? matching : cycles
}

/**
 * The cycle a page should land on: the one of this cadence whose window contains
 * today, else the most recent one of that cadence. Picking by "newest start_date"
 * alone means every metric is computed over a window that has already closed once
 * the latest cycle ends.
 */
export function pickCurrentCycle<T extends CadenceCycle>(
  cycles: T[],
  today: string,
  cadence: PmsCadence = "quarterly"
): T | null {
  const candidates = cyclesForCadence(cycles, cadence)
  const containingToday = candidates.find(
    (cycle) => cycle.start_date && cycle.end_date && cycle.start_date <= today && cycle.end_date >= today
  )
  if (containingToday) return containingToday
  const byStartDesc = [...candidates].sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
  return byStartDesc[0] ?? null
}
