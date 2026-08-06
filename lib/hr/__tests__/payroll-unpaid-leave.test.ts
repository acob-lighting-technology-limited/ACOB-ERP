import test from "node:test"
import assert from "node:assert/strict"
import { calculatePayroll, countUnpaidLeaveDays } from "@/lib/hr/payroll-utils"

// Mon 2026-08-03 → Fri 2026-08-07, then Mon 2026-08-10 → Fri 2026-08-14.
const WORKDAYS = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
]

test("counts only working days inside the period", () => {
  // Fri 07th → Mon 10th spans a weekend: 2 working days, not 4 calendar days.
  const result = countUnpaidLeaveDays([{ user_id: "u1", start_date: "2026-08-07", end_date: "2026-08-10" }], WORKDAYS)
  assert.equal(result.get("u1"), 2)
})

test("ignores a holiday that was excluded from the workday set", () => {
  const withHoliday = WORKDAYS.filter((d) => d !== "2026-08-05")
  const result = countUnpaidLeaveDays([{ user_id: "u1", start_date: "2026-08-03", end_date: "2026-08-07" }], withHoliday)
  assert.equal(result.get("u1"), 4)
})

test("never docks the same day twice when grants overlap", () => {
  const result = countUnpaidLeaveDays(
    [
      { user_id: "u1", start_date: "2026-08-03", end_date: "2026-08-05" },
      { user_id: "u1", start_date: "2026-08-04", end_date: "2026-08-06" },
    ],
    WORKDAYS
  )
  assert.equal(result.get("u1"), 4) // 03,04,05,06 — not 3 + 3
})

test("clips leave that extends beyond the payroll period", () => {
  const result = countUnpaidLeaveDays([{ user_id: "u1", start_date: "2026-07-20", end_date: "2026-09-30" }], WORKDAYS)
  assert.equal(result.get("u1"), WORKDAYS.length)
})

test("keeps employees separate and omits those with no unpaid leave", () => {
  const result = countUnpaidLeaveDays(
    [
      { user_id: "u1", start_date: "2026-08-03", end_date: "2026-08-03" },
      { user_id: "u2", start_date: "2026-08-03", end_date: "2026-08-04" },
    ],
    WORKDAYS
  )
  assert.equal(result.get("u1"), 1)
  assert.equal(result.get("u2"), 2)
  assert.equal(result.get("u3"), undefined)
})

test("deducts pro-rata against monthly gross, not monthly base", () => {
  const base = { monthlyBase: 1_000_000, workdays: 20 }
  const none = calculatePayroll(base)
  const twoDays = calculatePayroll({ ...base, unpaidLeaveDays: 2 })

  const expected = (none.monthlyGross / 20) * 2
  assert.ok(Math.abs(twoDays.unpaidLeaveDeduction - expected) < 0.01)

  // The charge is strictly additive on top of the unchanged baseline deductions.
  assert.ok(Math.abs(twoDays.totalDeductions - (none.totalDeductions + expected)) < 0.01)
  assert.ok(Math.abs(twoDays.netPay - (none.netPay - expected)) < 0.01)

  // Gross is unaffected — this is a deduction, not a reduction of earnings.
  assert.equal(twoDays.monthlyGross, none.monthlyGross)
})

test("zero unpaid days costs nothing", () => {
  const breakdown = calculatePayroll({ monthlyBase: 500_000, workdays: 22 })
  assert.equal(breakdown.unpaidLeaveDays, 0)
  assert.equal(breakdown.unpaidLeaveDeduction, 0)
})

test("does not divide by zero when a period has no workdays", () => {
  const breakdown = calculatePayroll({ monthlyBase: 500_000, workdays: 0, unpaidLeaveDays: 3 })
  assert.equal(breakdown.unpaidLeaveDeduction, 0)
  assert.ok(Number.isFinite(breakdown.netPay))
})
