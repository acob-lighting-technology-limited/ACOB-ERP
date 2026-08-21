import { strict as assert } from "node:assert"
import { test } from "node:test"
import { computePortfolioHealth, computeProjectHealth, computeTimeElapsedPct } from "../health"

const YEAR = { start: "2026-01-01", end: "2026-12-31" }

test("elapsed time is measured against the project's own schedule", () => {
  assert.equal(computeTimeElapsedPct(YEAR.start, YEAR.end, "2026-01-01"), 0)
  assert.equal(computeTimeElapsedPct(YEAR.start, YEAR.end, "2026-12-31"), 100)
  // Past the end date it stays at 100 rather than running away above it.
  assert.equal(computeTimeElapsedPct(YEAR.start, YEAR.end, "2027-06-01"), 100)
})

test("delivery and quality diverge when work lands but lands badly", () => {
  const health = computeProjectHealth({
    startDate: YEAR.start,
    endDate: YEAR.end,
    today: "2026-08-21",
    tasks: [
      { status: "completed", weight: 5, rating: 4 },
      { status: "completed", weight: 8, rating: 5 },
      { status: "completed", weight: 10, rating: 2 },
      { status: "in_progress", weight: 10, rating: null, task_end_date: "2026-07-01" },
      { status: "pending", weight: 7, rating: null, task_end_date: "2026-11-01" },
    ],
  })

  // 23 of 40 weight delivered; earned (4 + 8 + 4) of 40.
  assert.equal(health.deliveryPct, 57.5)
  assert.equal(health.qualityPct, 40)
  assert.equal(health.overdueCount, 1)
  assert.equal(health.status, "at_risk")
})

test("an overdue task alone is enough to flag a project", () => {
  const health = computeProjectHealth({
    startDate: YEAR.start,
    endDate: YEAR.end,
    today: "2026-08-21",
    tasks: [
      { status: "completed", weight: 10, rating: 5 },
      { status: "completed", weight: 10, rating: 5 },
      { status: "in_progress", weight: 1, rating: null, due_date: "2026-08-01" },
    ],
  })

  assert.ok(health.deliveryPct! > (health.timeElapsedPct ?? 0))
  assert.equal(health.overdueCount, 1)
  assert.equal(health.status, "at_risk")
})

test("a fully delivered project reads as completed, whatever the calendar says", () => {
  const health = computeProjectHealth({
    startDate: YEAR.start,
    endDate: YEAR.end,
    today: "2026-03-01",
    tasks: [{ status: "completed", weight: 10, rating: 4 }],
  })
  assert.equal(health.deliveryPct, 100)
  assert.equal(health.status, "completed")
})

test("far behind schedule is distinguished from merely at risk", () => {
  const health = computeProjectHealth({
    startDate: YEAR.start,
    endDate: YEAR.end,
    today: "2026-10-01",
    tasks: [
      { status: "completed", weight: 2, rating: 5 },
      { status: "pending", weight: 10, rating: null, task_end_date: "2026-12-01" },
    ],
  })
  assert.equal(health.status, "behind_schedule")
})

test("a project with no schedule falls back to overdue work as its only signal", () => {
  const health = computeProjectHealth({
    startDate: null,
    endDate: null,
    today: "2026-08-21",
    tasks: [{ status: "pending", weight: 5, rating: null }],
  })
  assert.equal(health.timeElapsedPct, null)
  assert.equal(health.variancePct, null)
  assert.equal(health.status, "on_track")
})

test("portfolio delivery is weighted, so a big project cannot be masked by small ones", () => {
  const big = computeProjectHealth({
    startDate: YEAR.start,
    endDate: YEAR.end,
    today: "2026-08-21",
    tasks: Array.from({ length: 10 }, () => ({ status: "pending", weight: 10, rating: null })),
  })
  const small = computeProjectHealth({
    startDate: YEAR.start,
    endDate: YEAR.end,
    today: "2026-08-21",
    tasks: [{ status: "completed", weight: 1, rating: 5 }],
  })

  const rollup = computePortfolioHealth([big, small])
  assert.equal(rollup.projectCount, 2)
  // 1 of 101 weight delivered — not the 50% a mean of percentages would give.
  assert.equal(rollup.deliveryPct, 0.99)
})
