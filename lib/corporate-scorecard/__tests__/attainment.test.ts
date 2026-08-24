import { strict as assert } from "node:assert"
import { test } from "node:test"
import { averageCappedPct, companyAttainment, computeAttainment, ragStatus, rollupByPerspective } from "../attainment"

test("at_least attainment is actual over target", () => {
  const result = computeAttainment({
    measureType: "count",
    direction: "at_least",
    targetValue: 5,
    actualValue: 3,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(result.rawPct, 60)
  assert.equal(result.cappedPct, 60)
})

test("over-achievement shows in full but caps for rollup use", () => {
  const result = computeAttainment({
    measureType: "count",
    direction: "at_least",
    targetValue: 5,
    actualValue: 10,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(result.rawPct, 200)
  assert.equal(result.cappedPct, 100)
})

test("at_most inverts: a lower actual is the win", () => {
  // Target: reduce operational cost to at most 20%. Achieved 15% — better than target.
  const beatTarget = computeAttainment({
    measureType: "percentage",
    direction: "at_most",
    targetValue: 20,
    actualValue: 15,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(beatTarget.rawPct, Math.round((20 / 15) * 100 * 100) / 100)
  assert.ok(beatTarget.rawPct! > 100)
  assert.equal(beatTarget.cappedPct, 100)

  // Missed it: actual cost higher than the at-most target.
  const missedTarget = computeAttainment({
    measureType: "percentage",
    direction: "at_most",
    targetValue: 20,
    actualValue: 40,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(missedTarget.rawPct, 50)
})

test("at_most treats zero actual as a full win, not a division error", () => {
  const result = computeAttainment({
    measureType: "percentage",
    direction: "at_most",
    targetValue: 20,
    actualValue: 0,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(result.rawPct, 100)
})

test("milestone attainment is completed over total, ignoring target_value entirely", () => {
  const result = computeAttainment({
    measureType: "milestone",
    direction: "at_least",
    targetValue: 999, // must be ignored for milestone type
    actualValue: null,
    milestonesCompleted: 2,
    milestonesTotal: 3,
  })
  assert.equal(result.rawPct, 66.67)
})

test("no recorded actual is null, not zero", () => {
  const noTarget = computeAttainment({
    measureType: "count",
    direction: "at_least",
    targetValue: null,
    actualValue: 5,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(noTarget.rawPct, null)

  const noActual = computeAttainment({
    measureType: "count",
    direction: "at_least",
    targetValue: 5,
    actualValue: null,
    milestonesCompleted: null,
    milestonesTotal: null,
  })
  assert.equal(noActual.rawPct, null)
})

test("RAG bands match the agreed thresholds", () => {
  assert.equal(ragStatus(95), "green")
  assert.equal(ragStatus(100), "green")
  assert.equal(ragStatus(94.99), "amber")
  assert.equal(ragStatus(80), "amber")
  assert.equal(ragStatus(79.99), "red")
  assert.equal(ragStatus(0), "red")
})

test("averageCappedPct skips missing data rather than treating it as zero", () => {
  assert.equal(averageCappedPct([80, null, 100, undefined]), 90)
  assert.equal(averageCappedPct([null, undefined]), null)
  assert.equal(averageCappedPct([]), null)
})

test("rollup: KPI -> objective -> perspective, equal-weighted at each level", () => {
  const rollup = rollupByPerspective([
    { perspective: "Financial", strategicObjective: "Increased project size", cappedPct: 100 },
    { perspective: "Financial", strategicObjective: "Increased project size", cappedPct: 50 },
    { perspective: "Financial", strategicObjective: "Increased retail sales", cappedPct: 80 },
    { perspective: "Customer", strategicObjective: "Increased visibility", cappedPct: 40 },
  ])

  const financial = rollup.find((p) => p.perspective === "Financial")!
  const sizeObjective = financial.objectives.find((o) => o.strategicObjective === "Increased project size")!
  assert.equal(sizeObjective.attainmentPct, 75) // (100 + 50) / 2
  // Objective average of [75, 80] = 77.5, not a KPI-weighted average of the three raw values.
  assert.equal(financial.attainmentPct, 77.5)

  const customer = rollup.find((p) => p.perspective === "Customer")!
  assert.equal(customer.attainmentPct, 40)

  assert.equal(companyAttainment(rollup), 58.75) // (77.5 + 40) / 2
})

test("an objective with no recorded actuals yet still appears, reading null rather than 0", () => {
  const rollup = rollupByPerspective([
    { perspective: "Internal Process", strategicObjective: "Improved process", cappedPct: null },
  ])
  const objective = rollup[0].objectives[0]
  assert.equal(objective.strategicObjective, "Improved process")
  assert.equal(objective.attainmentPct, null)
  assert.equal(rollup[0].attainmentPct, null)
})
