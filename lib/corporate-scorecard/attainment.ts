/**
 * Corporate Scorecard attainment — the standard balanced-scorecard rules
 * agreed for this system:
 *
 *   1. Only CORE ownership scores a department. SUPPORT is visible and
 *      taggable but never counted — a department should not be marked down
 *      for a target it merely contributes to.
 *   2. A KPI's attainment is actual ÷ target, not task completion. Tasks are
 *      the evidence trail; the number is the result.
 *   3. Over-achievement is shown in full (a KPI can read 200%) but capped at
 *      100 when it feeds a rollup, so one exceptional result cannot mask
 *      several missed targets.
 *   4. Rollups are equal-weighted averages: KPI → objective → perspective →
 *      company, unless a caller deliberately overrides that.
 *
 * Every function here is pure — no I/O — so the numbers the department page,
 * the register, and the MD rollup show can never disagree about how a
 * percentage was reached.
 */

export type MeasureType = "count" | "percentage" | "currency" | "milestone"
export type Direction = "at_least" | "at_most"
export type RagStatus = "green" | "amber" | "red"

export const RAG_GREEN_THRESHOLD = 95
export const RAG_AMBER_THRESHOLD = 80

export type AttainmentInput = {
  measureType: MeasureType
  direction: Direction
  targetValue: number | null
  actualValue: number | null
  milestonesCompleted: number | null
  milestonesTotal: number | null
}

export type Attainment = {
  /** The true figure, uncapped — a KPI can read 200%. Null when there's nothing to compute from yet. */
  rawPct: number | null
  /** rawPct capped at 100, for use in any rollup average. */
  cappedPct: number | null
}

/**
 * One KPI's attainment for one department.
 *
 * Milestone KPIs ("developed / approved / implemented") are milestones
 * completed over milestones total — a target_value would mean nothing there.
 * Everything else is actual ÷ target, inverted for an "at_most" KPI (a lower
 * actual is the win — e.g. "% decrease in operational cost").
 */
export function computeAttainment(input: AttainmentInput): Attainment {
  const empty: Attainment = { rawPct: null, cappedPct: null }

  if (input.measureType === "milestone") {
    const total = input.milestonesTotal
    const completed = input.milestonesCompleted
    if (!total || total <= 0 || completed == null) return empty
    const raw = (completed / total) * 100
    return { rawPct: round(raw), cappedPct: round(Math.min(100, raw)) }
  }

  const target = input.targetValue
  const actual = input.actualValue
  if (target == null || target <= 0 || actual == null) return empty

  let raw: number
  if (input.direction === "at_most") {
    // Hitting zero against a "reduce to at most X" target is a full win, not
    // an undefined division — there is nothing left to reduce.
    raw = actual <= 0 ? 100 : (target / actual) * 100
  } else {
    raw = (actual / target) * 100
  }

  return { rawPct: round(raw), cappedPct: round(Math.min(100, raw)) }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** ≥95 green · 80–94 amber · <80 red. Null (no data yet) is reported separately by callers. */
export function ragStatus(cappedPct: number): RagStatus {
  if (cappedPct >= RAG_GREEN_THRESHOLD) return "green"
  if (cappedPct >= RAG_AMBER_THRESHOLD) return "amber"
  return "red"
}

/**
 * Equal-weighted average of whatever capped percentages are present. Missing
 * data is skipped rather than treated as zero — a KPI nobody has recorded an
 * actual for yet is "no data", not "failed".
 */
export function averageCappedPct(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  if (present.length === 0) return null
  return round(present.reduce((sum, v) => sum + v, 0) / present.length)
}

export type KpiRollupRow = {
  perspective: string
  strategicObjective: string
  cappedPct: number | null
}

export type PerspectiveRollup = {
  perspective: string
  objectives: Array<{ strategicObjective: string; attainmentPct: number | null; kpiCount: number }>
  attainmentPct: number | null
}

/**
 * KPI → objective → perspective, each an equal-weighted average of the level
 * below. A perspective with zero recorded actuals reads null throughout
 * rather than as a 0%, which would read as "failing" instead of "not started".
 */
export function rollupByPerspective(rows: KpiRollupRow[]): PerspectiveRollup[] {
  const byPerspective = new Map<string, Map<string, number[]>>()

  for (const row of rows) {
    if (!byPerspective.has(row.perspective)) byPerspective.set(row.perspective, new Map())
    const objectives = byPerspective.get(row.perspective)!
    // Set unconditionally, even with no data yet, so the objective still
    // appears in the rollup rather than silently disappearing.
    if (!objectives.has(row.strategicObjective)) objectives.set(row.strategicObjective, [])
    if (row.cappedPct != null) objectives.get(row.strategicObjective)!.push(row.cappedPct)
  }

  const result: PerspectiveRollup[] = []
  for (const [perspective, objectives] of byPerspective) {
    const objectiveRows = Array.from(objectives.entries()).map(([strategicObjective, values]) => ({
      strategicObjective,
      attainmentPct: averageCappedPct(values),
      kpiCount: values.length,
    }))
    result.push({
      perspective,
      objectives: objectiveRows,
      attainmentPct: averageCappedPct(objectiveRows.map((o) => o.attainmentPct)),
    })
  }

  return result
}

/** Company-wide figure: equal-weighted average of the four perspectives. */
export function companyAttainment(perspectives: PerspectiveRollup[]): number | null {
  return averageCappedPct(perspectives.map((p) => p.attainmentPct))
}
