import test from "node:test"
import assert from "node:assert/strict"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { derivePayrollAttendance, isCoveredPayrollStatus } from "@/lib/hr/payroll-utils"
import { DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"

/**
 * Leave without pay is still leave, but unearned: it must read as its own attendance status
 * rather than the benign "On Leave", while never being charged twice in payroll (the day is
 * already deducted as unpaidLeaveDeduction).
 */

test("unpaid leave derives as lwop, not on_leave", () => {
  const status = deriveUnifiedAttendanceStatus({
    record: null,
    isOnLeave: true,
    isOnUnpaidLeave: true,
    recordDate: "2026-08-05",
  })
  assert.equal(status, "lwop")
})

test("paid leave is unaffected and still derives as on_leave", () => {
  const status = deriveUnifiedAttendanceStatus({
    record: null,
    isOnLeave: true,
    isOnUnpaidLeave: false,
    recordDate: "2026-08-05",
  })
  assert.equal(status, "on_leave")
})

test("a holiday still wins over unpaid leave", () => {
  const status = deriveUnifiedAttendanceStatus({
    record: null,
    isHoliday: true,
    isOnLeave: true,
    isOnUnpaidLeave: true,
    recordDate: "2026-08-05",
  })
  assert.equal(status, "holiday")
})

test("lwop is exempt from the absent surcharge so the day is not charged twice", () => {
  assert.equal(isCoveredPayrollStatus("lwop"), true)
})

test("an lwop day produces no absent day in payroll", () => {
  const workdayDates = ["2026-08-03", "2026-08-04"]
  const ctx = {
    isHoliday: () => false,
    isOnLeave: (_u: string, date: string) => date === "2026-08-03",
    isOnUnpaidLeave: (_u: string, date: string) => date === "2026-08-03",
    isExempt: () => false,
    earlyCloseTime: () => null,
    lateResumptionTime: () => null,
  }

  const result = derivePayrollAttendance({
    userId: "u1",
    attendanceExempt: false,
    workdayDates,
    attendanceByDate: new Map(),
    ctx,
    policy: DEFAULT_ATTENDANCE_POLICY,
  })

  // 08-03 is unpaid leave → covered here (charged separately). 08-04 has no record → absent.
  assert.equal(result.absentDays, 1)
})
