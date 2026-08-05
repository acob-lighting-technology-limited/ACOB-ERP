import { missedHours, getWorkdaysInRange } from "@/lib/hr/attendance-utils"
import { toLocalISODate } from "@/lib/utils/date"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import type { AttendancePolicy } from "@/lib/org-config"

export interface PayrollBreakdown {
  monthlyBase: number
  workdays: number
  dailyPay: number
  hourlyRate: number
  missedHours: number
  absentDays: number
  unpaidLeaveDays: number

  // Annualized Cash Benefits (P.A.)
  annualBase: number
  basic: number
  housing: number
  transport: number
  leaveAllowance: number
  communication: number
  hmo: number
  lifeAssurance: number
  annualGross: number

  // Annualized Reliefs & Tax (P.A.)
  pensionEmployeeAnnual: number
  pensionEmployerAnnual: number
  totalReliefs: number
  netForCRA: number
  cra: number
  chargeableIncome: number
  annualTax: number
  minTax: number
  statutoryTaxAnnual: number

  // Monthly Breakdown (Per Month)
  monthlyGross: number // (Basic + Housing + Transport + Communication + Leave) / 12
  monthlyBasic: number
  monthlyHousing: number
  monthlyTransport: number
  monthlyLeave: number
  monthlyCommunication: number
  monthlyHmo: number
  monthlyLifeAssurance: number
  monthlyPensionEmployee: number
  monthlyPensionEmployer: number
  monthlyTax: number

  // Surcharges & Adjustments
  latenessSurcharge: number
  absentSurcharge: number // Days absent (uncutoff or complete day absent)
  bonus: number
  loanRepayment: number
  lunchDeduction: number
  unpaidLeaveDeduction: number
  otherDeductions: number

  totalDeductions: number
  netPay: number
}

/**
 * Calculates PAYE Tax based on progressive Nigerian tax brackets
 * and minimum tax (1% of gross).
 */
export function calculatePAYETax(
  annualGross: number,
  pensionEmployee: number
): {
  totalReliefs: number
  netForCRA: number
  cra: number
  chargeableIncome: number
  taxPayable: number
  minTax: number
  statutoryTax: number
} {
  const totalReliefs = pensionEmployee
  const netForCRA = Math.max(0, annualGross - totalReliefs)
  const cra = Math.max(0.01 * netForCRA, 200000) + 0.2 * netForCRA
  const chargeableIncome = Math.max(0, netForCRA - cra)

  let tax = 0
  let remaining = chargeableIncome

  // Bracket 1: First N300,000 @ 7%
  const b1 = Math.min(remaining, 300000)
  tax += b1 * 0.07
  remaining -= b1

  // Bracket 2: Next N300,000 @ 11%
  const b2 = Math.min(remaining, 300000)
  tax += b2 * 0.11
  remaining -= b2

  // Bracket 3: Next N500,000 @ 15%
  const b3 = Math.min(remaining, 500000)
  tax += b3 * 0.15
  remaining -= b3

  // Bracket 4: Next N500,000 @ 19%
  const b4 = Math.min(remaining, 500000)
  tax += b4 * 0.19
  remaining -= b4

  // Bracket 5: Next N1,600,000 @ 21%
  const b5 = Math.min(remaining, 1600000)
  tax += b5 * 0.21
  remaining -= b5

  // Bracket 6: Above N3,200,000 @ 24%
  if (remaining > 0) {
    tax += remaining * 0.24
  }

  const minTax = 0.01 * annualGross
  const statutoryTax = Math.max(tax, minTax)

  return {
    totalReliefs,
    netForCRA,
    cra,
    chargeableIncome,
    taxPayable: tax,
    minTax,
    statutoryTax,
  }
}

/**
 * Core payroll calculator matching June 2026 Excel models.
 */
export function calculatePayroll({
  monthlyBase,
  workdays,
  missedHours = 0,
  absentDays = 0,
  unpaidLeaveDays = 0,
  bonus = 0,
  loanRepayment = 0,
  lunchDeduction = 0,
  otherDeductions = 0,
  hmoConfig,
  lifeAssuranceConfig,
}: {
  monthlyBase: number
  workdays: number
  missedHours?: number
  absentDays?: number
  /** Working days in the period spent on leave whose type is flagged `is_paid = false`. */
  unpaidLeaveDays?: number
  bonus?: number
  loanRepayment?: number
  lunchDeduction?: number
  otherDeductions?: number
  hmoConfig?: number
  lifeAssuranceConfig?: number
}): PayrollBreakdown {
  const dailyPay = workdays > 0 ? monthlyBase / workdays : 0
  const hourlyRate = dailyPay / 8.5

  // Lateness Surcharge: (Pay/Day / 8.5) * Missed Hours
  const latenessSurcharge = hourlyRate * missedHours

  // Absent Surcharge: Pay/Day * Absent Days
  const absentSurcharge = dailyPay * absentDays

  // Annualized values
  const annualBase = monthlyBase * 12
  const basic = annualBase * 0.5
  const housing = annualBase * 0.3
  const transport = annualBase * 0.1
  const leaveAllowance = annualBase * 0.1

  const communication = 60000 // Fixed per annum (5,000 monthly)
  const hmo = hmoConfig !== undefined ? hmoConfig : 83475 // Fixed per annum
  const lifeAssurance = lifeAssuranceConfig !== undefined ? lifeAssuranceConfig : 43438 // Fixed per annum

  // G7 Allowances (bonus/refunds) monthly gets annualized for TAX gross
  const annualGross = basic + housing + transport + communication + leaveAllowance + bonus * 12 + hmo

  // Pension Employer = 10% of Basic
  const pensionEmployerAnnual = basic * 0.1
  // Pension Employee = 8% of Basic
  const pensionEmployeeAnnual = basic * 0.08

  const taxDetails = calculatePAYETax(annualGross, pensionEmployeeAnnual)

  const monthlyGross = (basic + housing + transport + communication + leaveAllowance) / 12 // Matches (AH - AD - G) / 12

  const monthlyBasic = basic / 12
  const monthlyHousing = housing / 12
  const monthlyTransport = transport / 12
  const monthlyLeave = leaveAllowance / 12
  const monthlyCommunication = communication / 12
  const monthlyHmo = hmo / 12
  const monthlyLifeAssurance = lifeAssurance / 12
  const monthlyPensionEmployee = pensionEmployeeAnnual / 12
  const monthlyPensionEmployer = pensionEmployerAnnual / 12
  const monthlyTax = taxDetails.statutoryTax / 12

  // Unpaid leave (LWOP, Study, etc.) is docked pro-rata against monthly gross, not
  // monthlyBase — an unpaid day withholds the whole day's earnings, allowances included.
  // Only working days count; `unpaidLeaveDays` is already filtered to the period's
  // workday set by the caller, so weekends and public holidays never attract a charge.
  // Leave days are exempt from absentSurcharge via isCoveredPayrollStatus, so this is
  // the only charge they attract — no double-docking.
  const grossDailyPay = workdays > 0 ? monthlyGross / workdays : 0
  const unpaidLeaveDeduction = grossDailyPay * unpaidLeaveDays

  const totalDeductions =
    latenessSurcharge +
    absentSurcharge +
    loanRepayment +
    lunchDeduction +
    unpaidLeaveDeduction +
    monthlyPensionEmployee +
    monthlyTax +
    otherDeductions

  const netPay = monthlyGross + bonus - totalDeductions

  return {
    monthlyBase,
    workdays,
    dailyPay,
    hourlyRate,
    missedHours,
    absentDays,
    unpaidLeaveDays,

    annualBase,
    basic,
    housing,
    transport,
    leaveAllowance,
    communication,
    hmo,
    lifeAssurance,
    annualGross,

    pensionEmployeeAnnual,
    pensionEmployerAnnual,
    totalReliefs: taxDetails.totalReliefs,
    netForCRA: taxDetails.netForCRA,
    cra: taxDetails.cra,
    chargeableIncome: taxDetails.chargeableIncome,
    annualTax: taxDetails.taxPayable,
    minTax: taxDetails.minTax,
    statutoryTaxAnnual: taxDetails.statutoryTax,

    monthlyGross,
    monthlyBasic,
    monthlyHousing,
    monthlyTransport,
    monthlyLeave,
    monthlyCommunication,
    monthlyHmo,
    monthlyLifeAssurance,
    monthlyPensionEmployee,
    monthlyPensionEmployer,
    monthlyTax,

    latenessSurcharge,
    absentSurcharge,
    bonus,
    loanRepayment,
    lunchDeduction,
    unpaidLeaveDeduction,
    otherDeductions,

    totalDeductions,
    netPay,
  }
}

/** Attendance statuses that exempt an employee from lateness/absence payroll surcharges. */
export function isCoveredPayrollStatus(status: string): boolean {
  return (
    status === "waiver" ||
    status === "exempted" ||
    status === "on_leave" ||
    status === "holiday" ||
    status === "out_of_station" ||
    status === "absent_with_permission" ||
    status === "lateness_with_permission"
  )
}

export interface PayrollDayContext {
  isHoliday(date: string): boolean
  isOnLeave(userId: string, date: string): boolean
  isExempt(userId: string, date: string): boolean
  earlyCloseTime(date: string): string | null
  lateResumptionTime(date: string): string | null
}

export interface PayrollAttendanceRecord {
  clock_in?: string | null
  clock_out?: string | null
  status?: string | null
  waived?: boolean | null
}

/**
 * Single source of truth for turning a month of attendance records into the two
 * payroll surcharge inputs (missed hours, absent days). Reuses the canonical
 * `missedHours()` lateness/early-departure math so the bulk run, single-employee
 * calc, and client preview can never disagree.
 */
export function derivePayrollAttendance(params: {
  userId: string
  attendanceExempt: boolean
  workdayDates: string[]
  attendanceByDate: Map<string, PayrollAttendanceRecord>
  ctx: PayrollDayContext
  policy: AttendancePolicy
}): { missedHours: number; absentDays: number } {
  const { userId, attendanceExempt, workdayDates, attendanceByDate, ctx, policy } = params
  let missedHoursCount = 0
  let absentDaysCount = 0

  for (const date of workdayDates) {
    const rec = attendanceByDate.get(date) || null
    const closeTime = ctx.earlyCloseTime(date)
    const lateRes = ctx.lateResumptionTime(date)

    const status = deriveUnifiedAttendanceStatus(
      {
        record: rec,
        isHoliday: ctx.isHoliday(date),
        isOnLeave: ctx.isOnLeave(userId, date),
        isExempted: attendanceExempt || ctx.isExempt(userId, date),
        recordDate: date,
        earlyClosure: closeTime ? { closeTime } : null,
        lateResumption: lateRes ? { resumptionTime: lateRes } : null,
      },
      policy
    )

    if (isCoveredPayrollStatus(status)) continue

    if (status === "absent") {
      absentDaysCount++
      continue
    }

    const inTime = rec?.clock_in || null
    const outTime = rec?.clock_out || null

    if (!inTime || !outTime) {
      absentDaysCount++
      continue
    }

    const [ih, im] = inTime.split(":").map(Number)
    if (!isNaN(ih) && !isNaN(im) && ih * 60 + im > 16 * 60) {
      // Arrived after the 4:00 PM cutoff — counts as a full day absent.
      absentDaysCount++
    } else {
      missedHoursCount += missedHours(inTime, outTime, lateRes, closeTime)
    }
  }

  return { missedHours: missedHoursCount, absentDays: absentDaysCount }
}

/** Working days for a payroll period: Mon–Fri in range, excluding org holidays. */
export function getPayrollWorkdays(start: string, end: string, ctx: Pick<PayrollDayContext, "isHoliday">): string[] {
  return getWorkdaysInRange(start, end).filter((date) => !ctx.isHoliday(date))
}

/** An approved leave grant whose type carries no pay. */
export interface UnpaidLeaveRow {
  user_id: string
  start_date: string
  end_date: string
}

/**
 * Counts each employee's unpaid-leave days that fall on a payroll working day.
 *
 * Overlapping or duplicated grants are de-duplicated per date, so a day can never be
 * docked twice. Days outside `workdayDates` — weekends, public holidays, and any date
 * beyond the period — are ignored entirely.
 */
export function countUnpaidLeaveDays(rows: UnpaidLeaveRow[], workdayDates: string[]): Map<string, number> {
  const workdaySet = new Set(workdayDates)
  const datesByUser = new Map<string, Set<string>>()

  for (const row of rows) {
    if (!row.user_id || !row.start_date || !row.end_date) continue
    // Local-date arithmetic, matching getWorkdaysInRange — the workday set this is
    // intersected against is built the same way, so the two always line up.
    const [sy, sm, sd] = row.start_date.split("-").map(Number)
    const [ey, em, ed] = row.end_date.split("-").map(Number)
    if ([sy, sm, sd, ey, em, ed].some((n) => !Number.isFinite(n))) continue

    const cursor = new Date(sy, sm - 1, sd)
    const end = new Date(ey, em - 1, ed)

    while (cursor <= end) {
      const iso = toLocalISODate(cursor)
      if (workdaySet.has(iso)) {
        if (!datesByUser.has(row.user_id)) datesByUser.set(row.user_id, new Set())
        datesByUser.get(row.user_id)!.add(iso)
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }

  return new Map([...datesByUser].map(([userId, dates]) => [userId, dates.size]))
}
