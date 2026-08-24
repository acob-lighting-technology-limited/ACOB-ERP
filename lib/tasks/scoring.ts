/**
 * Weighted task scoring — the single definition of how task work becomes a score.
 *
 * Every task carries a compulsory weight (1-10) and, once approved, a rating
 * (1-5) from its rater. A task is therefore worth `weight` points and earns
 * `weight * rating/5` of them:
 *
 *   weight 5, rating 4/5  →  4 of a possible 5
 *
 * The employee's KPI percentage — 70% of the half-year appraisal — is the sum
 * of what they earned over the sum of what was available. Weight is relative,
 * not a percentage, so a project's weights are deliberately not constrained to
 * total 100: adding a task never forces a rebalance of the existing ones.
 *
 * Both PMS scoring and the project dashboards read from here so a project's
 * quality figure and an employee's KPI can never disagree about the same task.
 */

export const TASK_WEIGHT_MIN = 1
export const TASK_WEIGHT_MAX = 5
export const TASK_WEIGHT_DEFAULT = 3

export const TASK_RATING_MIN = 1
export const TASK_RATING_MAX = 5

/** Neutral for scoring: the work moved elsewhere or was called off, so it is
 *  neither credit nor failure for this employee. */
const EXCLUDED_STATUSES = new Set(["reassigned", "cancelled"])

/** Plain names for the weight scale, so a lead is not guessing what "3" means. */
export const TASK_WEIGHT_LABELS: Record<number, string> = {
  1: "minor",
  2: "small",
  3: "normal",
  4: "significant",
  5: "critical",
}

export const TASK_RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Below expectation",
  3: "Met expectation",
  4: "Exceeded expectation",
  5: "Outstanding",
}

export type ScorableTask = {
  status?: string | null
  weight?: number | null
  rating?: number | null
  is_archived?: boolean | null
}

export type CycleAnchoredTask = {
  task_end_date?: string | null
  due_date?: string | null
  created_at?: string | null
}

/**
 * The date that decides which review cycle a task belongs to.
 *
 * Its deadline — task_end_date, falling back to due_date, and to the creation
 * date only when a task carries no deadline at all. Anchoring on the completion
 * date instead would let late work quietly migrate into the next cycle and
 * leave the cycle it was actually owed in looking better than it was.
 */
export function taskCycleAnchor(task: CycleAnchoredTask): string | null {
  const anchor = task.task_end_date || task.due_date || task.created_at
  return anchor ? anchor.slice(0, 10) : null
}

export function isTaskInCycle(task: CycleAnchoredTask, cycleStart: string, cycleEnd: string): boolean {
  const day = taskCycleAnchor(task)
  if (!day) return false
  return day >= cycleStart && day <= cycleEnd
}

export function clampWeight(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return TASK_WEIGHT_DEFAULT
  return Math.min(TASK_WEIGHT_MAX, Math.max(TASK_WEIGHT_MIN, n))
}

export function isValidRating(value: unknown): boolean {
  const n = Number(value)
  return Number.isInteger(n) && n >= TASK_RATING_MIN && n <= TASK_RATING_MAX
}

/**
 * Does this task belong in the KPI calculation at all?
 *
 * Reassigned and cancelled work drops out entirely. Work that was submitted but
 * not yet rated also drops out — holding it back is deliberate, so a slow rater
 * cannot cost the employee a zero on work they already delivered. Everything
 * else stays in at full weight, including failed and unfinished work, because
 * excluding it would mean not doing a task raised your score.
 */
export function isTaskScorable(task: ScorableTask): boolean {
  if (task.is_archived) return false
  const status = String(task.status || "").toLowerCase()
  if (EXCLUDED_STATUSES.has(status)) return false
  if (isAwaitingRating(task)) return false
  return true
}

/**
 * Delivered but not yet judged.
 *
 * Submitted work obviously qualifies. So does a completed task with no rating:
 * a rating is mandatory to complete one now, so any such row predates that rule
 * — scoring it zero would punish an employee for work they actually finished.
 */
export function isAwaitingRating(task: ScorableTask): boolean {
  const status = String(task.status || "").toLowerCase()
  if (task.rating != null) return false
  return status === "submitted_for_review" || status === "completed"
}

/** Points earned by one task: weight * rating/5. Unrated work earns nothing. */
export function taskEarnedPoints(task: ScorableTask): number {
  const weight = clampWeight(task.weight)
  const rating = Number(task.rating)
  if (!isValidRating(rating)) return 0
  return (weight * rating) / TASK_RATING_MAX
}

export type WeightedTaskScore = {
  /** Weighted score 0-100, or null when there is no scorable work at all. */
  score: number | null
  earnedPoints: number
  availablePoints: number
  taskCount: number
  ratedCount: number
  /** Delivered but awaiting a rating — held out of the calculation. */
  awaitingRatingCount: number
}

/**
 * Weighted score across a set of tasks: SUM(weight * rating/5) / SUM(weight).
 *
 * Returns null rather than 0 when nothing is scorable, so "no work assigned"
 * stays distinguishable from "work assigned and failed".
 */
export function computeWeightedTaskScore(tasks: ScorableTask[]): WeightedTaskScore {
  let earnedPoints = 0
  let availablePoints = 0
  let taskCount = 0
  let ratedCount = 0
  let awaitingRatingCount = 0

  for (const task of tasks) {
    if (task.is_archived) continue

    if (isAwaitingRating(task)) {
      awaitingRatingCount++
      continue
    }
    if (!isTaskScorable(task)) continue

    taskCount++
    availablePoints += clampWeight(task.weight)
    earnedPoints += taskEarnedPoints(task)
    if (isValidRating(task.rating)) ratedCount++
  }

  const score = availablePoints > 0 ? Math.round((earnedPoints / availablePoints) * 100 * 100) / 100 : null

  return { score, earnedPoints, availablePoints, taskCount, ratedCount, awaitingRatingCount }
}

/**
 * Delivery vs quality for a project.
 *
 * Kept apart on purpose: a task can be finished on time and still be poor work.
 * Delivery answers "how much of the weighted plan is done", quality answers
 * "how well was it done" — one number would hide the difference.
 */
export function computeProjectProgress(tasks: ScorableTask[]) {
  let completedWeight = 0
  let totalWeight = 0

  for (const task of tasks) {
    if (task.is_archived) continue
    if (!isTaskScorable(task) && !isAwaitingRating(task)) continue
    const weight = clampWeight(task.weight)
    totalWeight += weight
    if (String(task.status || "").toLowerCase() === "completed") completedWeight += weight
  }

  const quality = computeWeightedTaskScore(tasks)

  return {
    deliveryPct: totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100 * 100) / 100 : null,
    qualityPct: quality.score,
    completedWeight,
    totalWeight,
  }
}
