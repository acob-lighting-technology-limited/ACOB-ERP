import assert from "node:assert/strict"
import test from "node:test"
import { getCurrentOfficeWeek, getOfficeWeekDay, getReportingOfficeWeek } from "@/lib/meeting-week"

// The office year is anchored on a date the company picks each year (always a
// Monday in practice). Without an API call the module falls back to Jan 12,
// which is what these tests assume — Jan 12 2026 is a Monday, so office weeks
// run Monday to Sunday and week 30 is Mon 3 Aug — Sun 9 Aug 2026.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

test("getOfficeWeekDay: numbers the days of an office week 1..7", () => {
  assert.equal(getOfficeWeekDay(d(2026, 8, 3)), 1) // Monday
  assert.equal(getOfficeWeekDay(d(2026, 8, 6)), 4) // Thursday
  assert.equal(getOfficeWeekDay(d(2026, 8, 7)), 5) // Friday
  assert.equal(getOfficeWeekDay(d(2026, 8, 9)), 7) // Sunday
  assert.equal(getOfficeWeekDay(d(2026, 8, 10)), 1) // next Monday, back to 1
})

test("getOfficeWeekDay: is always within 1..7 across a full year", () => {
  for (let i = 0; i < 365; i++) {
    const day = new Date(2026, 0, 12 + i)
    const position = getOfficeWeekDay(day)
    assert.ok(position >= 1 && position <= 7, `${day.toDateString()} gave position ${position}`)
  }
})

test("getReportingOfficeWeek: Monday to Thursday reports on the current week", () => {
  for (const day of [3, 4, 5, 6]) {
    const date = d(2026, 8, day)
    assert.deepEqual(
      getReportingOfficeWeek(date),
      getCurrentOfficeWeek(date),
      `Aug ${day} should report on the current week`
    )
  }
})

test("getReportingOfficeWeek: Friday to Sunday rolls on to the next week", () => {
  // Reports for a week's Monday meeting arrive from the Friday before.
  for (const day of [7, 8, 9]) {
    const date = d(2026, 8, day)
    const current = getCurrentOfficeWeek(date)
    const reporting = getReportingOfficeWeek(date)
    assert.equal(reporting.week, current.week + 1, `Aug ${day} should roll forward`)
    assert.equal(reporting.year, current.year)
  }
})

test("getReportingOfficeWeek: never skips or repeats a week across a year", () => {
  // Walking day by day, the reporting week must only ever stay put or advance
  // by one — a jump or a step backwards would strand reports in a hidden week.
  let previous = getReportingOfficeWeek(new Date(2026, 0, 12))
  for (let i = 1; i < 365; i++) {
    const current = getReportingOfficeWeek(new Date(2026, 0, 12 + i))
    if (current.year === previous.year) {
      const delta = current.week - previous.week
      assert.ok(delta === 0 || delta === 1, `week jumped by ${delta} on day ${i}`)
    }
    previous = current
  }
})

test("getReportingOfficeWeek: the rollover happens exactly once per week", () => {
  // Over four consecutive weeks there should be exactly four rollover days.
  let rollovers = 0
  for (let i = 0; i < 28; i++) {
    const date = new Date(2026, 7, 3 + i)
    if (getReportingOfficeWeek(date).week !== getCurrentOfficeWeek(date).week) rollovers++
  }
  // Three rollover days (Fri, Sat, Sun) in each of four weeks.
  assert.equal(rollovers, 12)
})
