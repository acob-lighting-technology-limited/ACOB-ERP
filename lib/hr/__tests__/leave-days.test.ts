import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  countLeaveDays,
  describeLeaveRange,
  describeSegments,
  firstWorkingDayOnOrAfter,
  lastWorkingDayOnOrBefore,
  nextWorkingDayAfter,
  segmentsWorkingDays,
  trimRangeToWorkingDays,
} from "@/lib/hr/leave-days"

// 2026-03-02 is a Monday, so 03-07 is Saturday and 03-08 is Sunday.
const MONDAY = "2026-03-02"
const FRIDAY = "2026-03-06"
const SATURDAY = "2026-03-07"
const SUNDAY = "2026-03-08"
const NEXT_MONDAY = "2026-03-09"

const NO_HOLIDAY = new Set<string>()
const WEDNESDAY_HOLIDAY = new Set<string>(["2026-03-04"])

describe("countLeaveDays", () => {
  it("counts Mon-Fri as five days", () => {
    assert.equal(countLeaveDays(MONDAY, FRIDAY, NO_HOLIDAY), 5)
  })

  it("does not charge for the weekend when the range runs Mon-Sun", () => {
    // The bug this fixes: picking Mon-Sun to force a Monday return used to cost 7.
    assert.equal(countLeaveDays(MONDAY, SUNDAY, NO_HOLIDAY), 5)
  })

  it("skips a public holiday inside the range", () => {
    assert.equal(countLeaveDays(MONDAY, FRIDAY, WEDNESDAY_HOLIDAY), 4)
  })

  it("returns zero for a weekend-only range", () => {
    assert.equal(countLeaveDays(SATURDAY, SUNDAY, NO_HOLIDAY), 0)
  })

  it("returns zero for an inverted range", () => {
    assert.equal(countLeaveDays(FRIDAY, MONDAY, NO_HOLIDAY), 0)
  })
})

describe("describeLeaveRange", () => {
  it("separates deducted days from free weekend and holiday days", () => {
    const breakdown = describeLeaveRange(MONDAY, SUNDAY, WEDNESDAY_HOLIDAY)
    assert.equal(breakdown.workingDays, 4)
    assert.equal(breakdown.calendarDays, 7)
    assert.equal(breakdown.weekendDays, 2)
    assert.deepEqual(breakdown.holidayDates, ["2026-03-04"])
  })
})

describe("trimRangeToWorkingDays", () => {
  it("pulls a Mon-Sun selection back to Mon-Fri", () => {
    assert.deepEqual(trimRangeToWorkingDays(MONDAY, SUNDAY, NO_HOLIDAY), {
      start_date: MONDAY,
      end_date: FRIDAY,
    })
  })

  it("pulls the end back past a holiday that lands on the last day", () => {
    assert.deepEqual(trimRangeToWorkingDays(MONDAY, "2026-03-04", WEDNESDAY_HOLIDAY), {
      start_date: MONDAY,
      end_date: "2026-03-03",
    })
  })

  it("pushes the start forward off a weekend", () => {
    assert.deepEqual(trimRangeToWorkingDays(SATURDAY, "2026-03-10", NO_HOLIDAY), {
      start_date: NEXT_MONDAY,
      end_date: "2026-03-10",
    })
  })

  it("returns null when nothing in the range is deductible", () => {
    assert.equal(trimRangeToWorkingDays(SATURDAY, SUNDAY, NO_HOLIDAY), null)
    assert.equal(trimRangeToWorkingDays("2026-03-04", "2026-03-04", WEDNESDAY_HOLIDAY), null)
  })
})

describe("resumption dates", () => {
  it("returns the Monday after leave ending on a Friday", () => {
    assert.equal(nextWorkingDayAfter(FRIDAY, NO_HOLIDAY), NEXT_MONDAY)
  })

  it("skips a holiday that falls on the resumption day", () => {
    const mondayHoliday = new Set<string>([NEXT_MONDAY])
    assert.equal(nextWorkingDayAfter(FRIDAY, mondayHoliday), "2026-03-10")
  })

  it("snaps a weekend date to the surrounding working days", () => {
    assert.equal(firstWorkingDayOnOrAfter(SATURDAY, NO_HOLIDAY), NEXT_MONDAY)
    assert.equal(lastWorkingDayOnOrBefore(SUNDAY, NO_HOLIDAY), FRIDAY)
  })
})

describe("segments", () => {
  const segments = [
    { start_date: "2026-03-02", end_date: "2026-03-04" },
    { start_date: "2026-03-09", end_date: "2026-03-10" },
  ]

  it("totals disjoint ranges booked under one request", () => {
    assert.equal(segmentsWorkingDays(segments, NO_HOLIDAY), 5)
  })

  it("drops a holiday from whichever segment contains it", () => {
    assert.equal(segmentsWorkingDays(segments, WEDNESDAY_HOLIDAY), 4)
  })

  it("reports the combined breakdown across segments", () => {
    const breakdown = describeSegments(segments, WEDNESDAY_HOLIDAY)
    assert.equal(breakdown.workingDays, 4)
    assert.deepEqual(breakdown.holidayDates, ["2026-03-04"])
  })
})
