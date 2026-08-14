import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  computeAttendanceDay,
  lateBracketFor,
  earlyBracketFor,
  attendanceRateFrom,
  NET_DAY_HOURS,
} from "@/lib/hr/attendance-ssot"

/**
 * The agreed penalty table is the contract for payroll, HR reports, the staff
 * dashboard and PMS scoring. Every boundary is pinned here so a future change
 * to the maths cannot silently move somebody's pay.
 */

describe("late-arrival brackets", () => {
  const cases: Array<[string, number]> = [
    // Grace period — 08:00 to 08:20 inclusive.
    ["08:00", 0],
    ["08:19", 0],
    ["08:20", 0],
    // Bracket 1: 08:21–09:00
    ["08:21", 1],
    ["08:45", 1],
    ["09:00", 1],
    // Bracket 2: 09:01–10:00
    ["09:01", 2],
    ["09:30", 2],
    ["10:00", 2],
    // Bracket 3: 10:01–11:00
    ["10:01", 3],
    ["11:00", 3],
    // Remaining brackets through the end of the shift.
    ["11:01", 4],
    ["12:00", 4],
    ["12:01", 5],
    ["13:00", 5],
    ["13:01", 6],
    ["14:00", 6],
    ["14:01", 7],
    ["15:00", 7],
    ["15:01", 8],
    ["16:00", 8],
    ["16:01", 9],
    ["17:00", 9],
  ]

  for (const [clockIn, expected] of cases) {
    it(`${clockIn} → bracket ${expected}`, () => {
      assert.equal(lateBracketFor(clockIn), expected)
    })
  }
})

describe("early-departure brackets", () => {
  const cases: Array<[string, number]> = [
    // No penalty at or after the end of the shift.
    ["17:00", 0],
    ["17:30", 0],
    // Bracket 1: 16:01–17:00
    ["16:59", 1],
    ["16:01", 1],
    // Bracket 2: 15:01–16:00 — note 16:00 belongs to the bracket below it.
    ["16:00", 2],
    ["15:01", 2],
    // Bracket 3: 14:01–15:00
    ["15:00", 3],
    ["14:01", 3],
    // Remaining brackets back to the start of the shift.
    ["14:00", 4],
    ["13:01", 4],
    ["13:00", 5],
    ["12:01", 5],
    ["12:00", 6],
    ["11:01", 6],
    ["11:00", 7],
    ["10:01", 7],
    ["10:00", 8],
    ["09:01", 8],
    ["09:00", 9],
    ["08:00", 9],
  ]

  for (const [clockOut, expected] of cases) {
    it(`${clockOut} → bracket ${expected}`, () => {
      assert.equal(earlyBracketFor(clockOut, "17:00"), expected)
    })
  }
})

describe("the two edge cases confirmed with HR", () => {
  it("in 08:20, out 09:00 → -9, which is a full day lost", () => {
    const result = computeAttendanceDay({ status: "present", clockIn: "08:20", clockOut: "09:00" })
    assert.equal(result.lateBracket, 0)
    assert.equal(result.earlyBracket, 9)
    // -9 capped at the 8.5h net day, so it lands exactly on "absent".
    assert.equal(result.hoursLost, NET_DAY_HOURS)
    assert.equal(result.isAbsent, true)
  })

  it("in 08:20, out 09:01 → -8, leaving half an hour credited", () => {
    const result = computeAttendanceDay({ status: "present", clockIn: "08:20", clockOut: "09:01" })
    assert.equal(result.lateBracket, 0)
    assert.equal(result.earlyBracket, 8)
    assert.equal(result.hoursLost, 8)
    assert.equal(result.hoursWorked, 0.5)
    assert.equal(result.isAbsent, false)
  })
})

describe("combined late and early penalties stack", () => {
  it("in 09:30 (-2), out 16:30 (-1) → -3", () => {
    const result = computeAttendanceDay({ status: "late", clockIn: "09:30", clockOut: "16:30" })
    assert.equal(result.lateBracket, 2)
    assert.equal(result.earlyBracket, 1)
    assert.equal(result.hoursLost, 3)
    assert.equal(result.hoursWorked, 5.5)
  })

  it("a perfect day costs nothing", () => {
    const result = computeAttendanceDay({ status: "present", clockIn: "08:00", clockOut: "17:00" })
    assert.equal(result.hoursLost, 0)
    assert.equal(result.hoursWorked, NET_DAY_HOURS)
    assert.equal(result.breakdown, "On time — no hours lost")
  })

  it("arriving within grace costs nothing", () => {
    const result = computeAttendanceDay({ status: "present", clockIn: "08:20", clockOut: "17:00" })
    assert.equal(result.hoursLost, 0)
  })

  it("never charges more than a full day", () => {
    const result = computeAttendanceDay({ status: "late", clockIn: "15:00", clockOut: "15:30" })
    assert.equal(result.hoursLost, NET_DAY_HOURS)
    assert.equal(result.hoursWorked, 0)
  })
})

describe("covered days never reach the bracket maths", () => {
  for (const status of ["on_leave", "holiday", "exempted", "awp", "lwop", "early_closure", "late_resumption"]) {
    it(`${status} costs 0 hours even with a terrible clock-in`, () => {
      const result = computeAttendanceDay({ status, clockIn: "15:00", clockOut: "15:30" })
      assert.equal(result.hoursLost, 0)
      assert.equal(result.covered, true)
      assert.equal(result.hoursWorked, NET_DAY_HOURS)
    })
  }
})

describe("absence and incomplete days", () => {
  it("absent costs the full net day", () => {
    const result = computeAttendanceDay({ status: "absent" })
    assert.equal(result.hoursLost, NET_DAY_HOURS)
    assert.equal(result.isAbsent, true)
  })

  it("a missing clock-out charges the late side plus the incomplete penalty", () => {
    const result = computeAttendanceDay({ status: "incomplete", clockIn: "09:30", clockOut: null })
    // bracket 2 for the 09:30 arrival, plus the default 1.0 incomplete penalty
    assert.equal(result.hoursLost, 3)
  })

  it("a missing clock-in charges the early side plus the incomplete penalty", () => {
    const result = computeAttendanceDay({ status: "incomplete", clockIn: null, clockOut: "16:30" })
    assert.equal(result.hoursLost, 2)
  })
})

describe("approvals and org-wide overrides", () => {
  it("LEWP forgives the early departure but never the lateness", () => {
    const result = computeAttendanceDay({
      status: "early_departure_with_permission",
      clockIn: "09:30",
      clockOut: "14:00",
    })
    assert.equal(result.lateBracket, 2)
    assert.equal(result.earlyBracket, 0)
    assert.equal(result.hoursLost, 2)
  })

  it("early closure measures the early departure against the closing time", () => {
    // Office closed at 14:00, employee left at 14:00 — nothing owed.
    const result = computeAttendanceDay({
      status: "present",
      clockIn: "08:00",
      clockOut: "14:00",
      earlyCloseTime: "14:00",
    })
    assert.equal(result.hoursLost, 0)
  })

  it("late resumption removes the grace period and measures from the announced time", () => {
    // Resumption announced for 10:00; arriving 10:30 is one hour late.
    const result = computeAttendanceDay({
      status: "late",
      clockIn: "10:30",
      clockOut: "17:00",
      lateResumptionTime: "10:00",
    })
    assert.equal(result.lateBracket, 1)
    assert.equal(result.hoursLost, 1)
  })

  it("arriving before the announced resumption time costs nothing", () => {
    const result = computeAttendanceDay({
      status: "present",
      clockIn: "09:45",
      clockOut: "17:00",
      lateResumptionTime: "10:00",
    })
    assert.equal(result.hoursLost, 0)
  })
})

describe("overtime is tracked separately from penalties", () => {
  it("counts hours past the end of the shift", () => {
    const result = computeAttendanceDay({ status: "present", clockIn: "08:00", clockOut: "19:00" })
    assert.equal(result.overtimeHours, 2)
    assert.equal(result.hoursLost, 0)
  })
})

describe("the derived percentage view", () => {
  it("a clean day is 100%", () => {
    assert.equal(attendanceRateFrom(0), 100)
  })

  it("a full day lost is 0%", () => {
    assert.equal(attendanceRateFrom(NET_DAY_HOURS), 0)
  })

  it("scales across a period", () => {
    // 20 working days, 8.5 hours lost across the period = one day's worth.
    assert.equal(attendanceRateFrom(NET_DAY_HOURS, 20), 95)
  })
})
