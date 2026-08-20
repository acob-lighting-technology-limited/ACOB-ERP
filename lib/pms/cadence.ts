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
  name?: string | null
  review_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

const HALF_YEAR_MARKERS = ["biannual", "semiannual", "midyear", "halfyear", "h1", "h2", "half1", "half2", "mid-year"]
const QUARTERLY_MARKERS = ["quarter", "quarterly", "q1", "q2", "q3", "q4"]

function normalize(text: string | null | undefined) {
  return (text || "").toLowerCase().replace(/[\s_-]/g, "")
}

/** Does a cycle's review_type or name belong to the chosen cadence? */
export function matchesCadence(cadence: string, reviewType: string | null | undefined, name?: string | null): boolean {
  if (cadence === "all") return true
  const value = normalize(`${reviewType || ""} ${name || ""}`)
  const isHalfYear = HALF_YEAR_MARKERS.some((marker) => value.includes(marker))
  const isQuarterly = QUARTERLY_MARKERS.some((marker) => value.includes(marker)) && !isHalfYear

  if (cadence === "quarterly") return isQuarterly
  if (cadence === "biannual") return isHalfYear
  // Annual must not swallow "Bi-Annual" / "Mid-Year" / "Quarterly".
  if (cadence === "annual")
    return !isHalfYear && !isQuarterly && (value.includes("annual") || value.includes("fullyear"))
  return true
}

export function isQuarterlyCycle(reviewType: string | null | undefined, name?: string | null): boolean {
  return matchesCadence("quarterly", reviewType, name)
}

export function isBiannualCycle(reviewType: string | null | undefined, name?: string | null): boolean {
  return matchesCadence("biannual", reviewType, name)
}

export function isAnnualCycle(reviewType: string | null | undefined, name?: string | null): boolean {
  return matchesCadence("annual", reviewType, name)
}

export function getCadenceType(reviewType: string | null | undefined, name?: string | null): PmsCadence {
  if (isBiannualCycle(reviewType, name)) return "biannual"
  if (isAnnualCycle(reviewType, name)) return "annual"
  if (isQuarterlyCycle(reviewType, name)) return "quarterly"
  return "all"
}

/**
 * Given any cycle (quarterly, biannual, or annual), finds the underlying quarterly
 * cycles that fall within its date window.
 */
export function getCoveredQuarterlyCycles<T extends CadenceCycle>(parentCycle: T, allCycles: T[]): T[] {
  if (isQuarterlyCycle(parentCycle.review_type, parentCycle.name)) {
    return [parentCycle]
  }

  const quarterlyCycles = allCycles.filter((c) => isQuarterlyCycle(c.review_type, c.name))
  if (!parentCycle.start_date || !parentCycle.end_date) return []

  const pStart = parentCycle.start_date
  const pEnd = parentCycle.end_date

  return quarterlyCycles.filter((q) => q.start_date && q.end_date && q.start_date >= pStart && q.end_date <= pEnd)
}

/**
 * Computes the arithmetic average of available numeric quarterly scores,
 * returning null if no scores are present.
 */
export function rollupQuarterlyScores(scores: Array<number | null | undefined>): number | null {
  const valid = scores.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  if (valid.length === 0) return null
  return Math.round((valid.reduce((sum, v) => sum + v, 0) / valid.length) * 100) / 100
}

/**
 * Cycles of the given cadence, newest first. Falls back to the full list when
 * nothing matches, so a database with unlabelled review_types still renders
 * something instead of an empty picker.
 */
export function cyclesForCadence<T extends CadenceCycle>(cycles: T[], cadence: PmsCadence = "quarterly"): T[] {
  const matching = cycles.filter((cycle) => matchesCadence(cadence, cycle.review_type, cycle.name))
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
