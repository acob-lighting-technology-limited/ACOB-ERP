import { strict as assert } from "node:assert"
import { test } from "node:test"
import { computeProjectProgress, computeWeightedTaskScore, isTaskInCycle, isTaskScorable } from "../scoring"

test("a task earns its weight scaled by its rating", () => {
  const { score, earnedPoints, availablePoints } = computeWeightedTaskScore([
    { status: "completed", weight: 5, rating: 4 },
  ])
  assert.equal(earnedPoints, 4)
  assert.equal(availablePoints, 5)
  assert.equal(score, 80)
})

test("weights decide how much each task moves the score", () => {
  // Heavy task rated poorly, light task rated perfectly: the heavy one dominates.
  const { score } = computeWeightedTaskScore([
    { status: "completed", weight: 5, rating: 1 },
    { status: "completed", weight: 1, rating: 5 },
  ])
  // (5*0.2 + 1*1) / 6 = 2/6
  assert.equal(score, 33.33)
})

test("unfinished work scores zero at full weight, so skipping tasks cannot raise a score", () => {
  const finishedOnly = computeWeightedTaskScore([{ status: "completed", weight: 5, rating: 5 }])
  const withAbandoned = computeWeightedTaskScore([
    { status: "completed", weight: 5, rating: 5 },
    { status: "failed", weight: 5, rating: null },
    { status: "pending", weight: 5, rating: null },
  ])
  assert.equal(finishedOnly.score, 100)
  assert.equal(withAbandoned.score, 33.33)
  assert.ok(withAbandoned.score! < finishedOnly.score!)
})

test("reassigned and cancelled work is neutral", () => {
  assert.equal(isTaskScorable({ status: "reassigned", weight: 5, rating: null }), false)
  assert.equal(isTaskScorable({ status: "cancelled", weight: 5, rating: null }), false)

  const { score, taskCount } = computeWeightedTaskScore([
    { status: "completed", weight: 5, rating: 5 },
    { status: "reassigned", weight: 5, rating: null },
    { status: "cancelled", weight: 5, rating: null },
  ])
  assert.equal(taskCount, 1)
  assert.equal(score, 100)
})

test("delivered work awaiting a rating is held out rather than scored zero", () => {
  const { score, awaitingRatingCount, taskCount } = computeWeightedTaskScore([
    { status: "completed", weight: 5, rating: 4 },
    { status: "submitted_for_review", weight: 5, rating: null },
  ])
  assert.equal(awaitingRatingCount, 1)
  assert.equal(taskCount, 1)
  assert.equal(score, 80)
})

test("archived tasks never score", () => {
  const { score } = computeWeightedTaskScore([{ status: "completed", weight: 5, rating: 5, is_archived: true }])
  assert.equal(score, null)
})

test("no assigned work is null, not zero", () => {
  assert.equal(computeWeightedTaskScore([]).score, null)
})

test("project delivery and quality are separate numbers", () => {
  // Everything delivered, but rated badly: delivery is full, quality is not.
  const progress = computeProjectProgress([
    { status: "completed", weight: 5, rating: 2 },
    { status: "completed", weight: 5, rating: 2 },
  ])
  assert.equal(progress.deliveryPct, 100)
  assert.equal(progress.qualityPct, 40)
})

test("out-of-range weights are clamped rather than trusted", () => {
  const { availablePoints } = computeWeightedTaskScore([
    { status: "completed", weight: 999, rating: 5 },
    { status: "completed", weight: 0, rating: 5 },
  ])
  assert.equal(availablePoints, 6) // 5 + 1
})

test("a task belongs to the cycle its deadline falls in, not the one it was finished in", () => {
  const q1 = { start: "2026-01-01", end: "2026-03-31" }

  // Due in March, dragged into May: still Q1's task.
  assert.equal(isTaskInCycle({ task_end_date: "2026-03-20", created_at: "2026-01-05" }, q1.start, q1.end), true)

  // task_end_date wins over due_date when both are present.
  assert.equal(isTaskInCycle({ task_end_date: "2026-05-01", due_date: "2026-02-01" }, q1.start, q1.end), false)

  // No deadline at all falls back to when it was raised.
  assert.equal(isTaskInCycle({ created_at: "2026-02-10T09:00:00Z" }, q1.start, q1.end), true)

  // Nothing to anchor on cannot be placed in any cycle.
  assert.equal(isTaskInCycle({}, q1.start, q1.end), false)
})

test("legacy completed work with no rating is held back, not scored zero", () => {
  // A rating is mandatory to complete a task now, so an unrated completed row
  // predates that rule. Scoring it zero would punish finished work.
  const { score, awaitingRatingCount } = computeWeightedTaskScore([
    { status: "completed", weight: 4, rating: 4 },
    { status: "completed", weight: 5, rating: null },
  ])
  assert.equal(awaitingRatingCount, 1)
  assert.equal(score, 80)
})
