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

export function isQuarterlyCycle(reviewType: string | null | undefined, name?: string | null): boolean {
  const t = (reviewType || "").trim().toLowerCase()
  if (t === "quarterly" || t === "quarter") return true
  if (t === "biannual" || t === "annual" || t === "mid_year") return false
  const n = (name || "").trim().toLowerCase()
  return /^q[1-4]\b/i.test(n) || n.includes("quarter")
}

export function isBiannualCycle(reviewType: string | null | undefined, name?: string | null): boolean {
  const t = (reviewType || "").trim().toLowerCase()
  if (t === "biannual" || t === "mid_year" || t === "half_year" || t === "semiannual") return true
  if (t === "quarterly" || t === "annual") return false
  const n = (name || "").trim().toLowerCase()
  return /^h[1-2]\b/i.test(n) || n.includes("half") || n.includes("biannual") || n.includes("mid-year")
}

export function isAnnualCycle(reviewType: string | null | undefined, name?: string | null): boolean {
  const t = (reviewType || "").trim().toLowerCase()
  if (t === "annual" || t === "year" || t === "full_year") return true
  if (t === "quarterly" || t === "biannual" || t === "mid_year") return false
  const n = (name || "").trim().toLowerCase()
  return (n.includes("annual") && !n.includes("biannual")) || /^fy\b/i.test(n) || n.includes("full year")
}

/** Does a cycle's review_type or name belong to the chosen cadence? */
export function matchesCadence(cadence: string, reviewType: string | null | undefined, name?: string | null): boolean {
  if (cadence === "all") return true
  if (cadence === "quarterly") return isQuarterlyCycle(reviewType, name)
  if (cadence === "biannual") return isBiannualCycle(reviewType, name)
  if (cadence === "annual") return isAnnualCycle(reviewType, name)
  return true
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

/** The cadence PMS is scored on, and the default every PMS route opens with. */
export const DEFAULT_PMS_CADENCE: PmsCadence = "quarterly"

/** Value used by the cycle pickers to mean "every cycle in the current cadence". */
export const ALL_CYCLES_VALUE = "__all__"

/** Options for cycle frequency/type filter. Defaults to Quarterly. */
export const CADENCE_OPTIONS: { value: PmsCadence; label: string }[] = [
  { value: "quarterly", label: "Quarterly" },
  { value: "biannual", label: "Biannual" },
  { value: "annual", label: "Annual" },
  { value: "all", label: "All" },
]

/** Cycle labels drop the boilerplate "Performance Review" so the picker stays readable. */
export function formatCycleLabel(name: string | null | undefined): string {
  if (!name) return "-"
  const cleaned = name.replace(/[-–—:]?\s*performance\s+review\s*[-–—:]?/gi, "").trim()
  return cleaned || name
}

/**
 * Two review_cycles rows can describe the same window (a seeded set landing on
 * top of hand-created cycles). Identical labels in a picker are unusable, so a
 * status suffix is appended whenever a name is not unique.
 */
export function cycleOptionLabel<T extends CadenceCycle & { status?: string | null }>(cycle: T, all: T[]): string {
  const base = formatCycleLabel(cycle.name)
  const duplicated = all.filter((other) => formatCycleLabel(other.name) === base).length > 1
  if (!duplicated) return base
  const status = (cycle.status || "").trim()
  return status ? `${base} (${status})` : base
}

/** Human-readable period label matching the active cadence. */
export function cadencePeriodLabel(cadence: PmsCadence): string {
  switch (cadence) {
    case "quarterly":
      return "Quarter"
    case "biannual":
      return "Half"
    case "annual":
      return "Year"
    default:
      return "Cycle"
  }
}
