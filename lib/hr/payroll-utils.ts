import { getWorkdaysInRange } from "@/lib/hr/attendance-utils"
import { computeAttendanceDay, NET_DAY_HOURS } from "@/lib/hr/attendance-ssot"
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

export interface TaxReformBracketResult {
  totalReliefs: number
  netForCRA: number
  cra: number
  chargeableIncome: number
  annualTax: number
  monthlyTax: number
  brackets: Array<{
    label: string
    amount: number
    tax: number
    rate: string
  }>
}

/**
 * Calculates PAYE Tax based on Proposed Tax Reform Schedule:
 * - Replaces CRA Component 1 & 2 with a Static Statutory Relief of N500,000.
 * - Band 1: First N800,000 @ 0%
 * - Band 2: Next N2,200,000 @ 15%
 * - Band 3: Next N9,000,000 @ 18%
 * - Band 4: Next N13,000,000 @ 21%
 * - Band 5: Next N25,000,000 @ 23%
 * - Band 6: Above N50,000,000 @ 25%
 */
export function calculateNewTaxReformPAYE(
  annualGross: number,
  pensionEmployee: number,
  staticReliefConfig: number = 500000
): TaxReformBracketResult {
  const pensionRelief = pensionEmployee
  const staticRelief = staticReliefConfig // Fixed N500,000 statutory relief under Tax Reform
  const totalReliefs = pensionRelief + staticRelief
  const netForCRA = Math.max(0, annualGross - pensionRelief)
  const chargeableIncome = Math.max(0, annualGross - totalReliefs)

  let remaining = chargeableIncome
  let tax = 0

  // Band 1: First N800,000 @ 0%
  const b1 = Math.min(remaining, 800000)
  const t1 = 0
  remaining -= b1

  // Band 2: Next N2,200,000 @ 15%
  const b2 = Math.min(remaining, 2200000)
  const t2 = b2 * 0.15
  tax += t2
  remaining -= b2

  // Band 3: Next N9,000,000 @ 18%
  const b3 = Math.min(remaining, 9000000)
  const t3 = b3 * 0.18
  tax += t3
  remaining -= b3

  // Band 4: Next N13,000,000 @ 21%
  const b4 = Math.min(remaining, 13000000)
  const t4 = b4 * 0.21
  tax += t4
  remaining -= b4

  // Band 5: Next N25,000,000 @ 23%
  const b5 = Math.min(remaining, 25000000)
  const t5 = b5 * 0.23
  tax += t5
  remaining -= b5

  // Band 6: Above N50,000,000 @ 25%
  const b6 = Math.max(0, remaining)
  const t6 = b6 * 0.25
  tax += t6

  const minTax = 0.01 * annualGross
  const statutoryTax = Math.max(tax, minTax)

  return {
    totalReliefs,
    netForCRA,
    cra: staticRelief,
    chargeableIncome,
    annualTax: statutoryTax,
    monthlyTax: statutoryTax / 12,
    brackets: [
      { label: "First ₦800,000 @ 0%", amount: b1, tax: t1, rate: "0%" },
      { label: "Next ₦2,200,000 @ 15%", amount: b2, tax: t2, rate: "15%" },
      { label: "Next ₦9,000,000 @ 18%", amount: b3, tax: t3, rate: "18%" },
      { label: "Next ₦13,000,000 @ 21%", amount: b4, tax: t4, rate: "21%" },
      { label: "Next ₦25,000,000 @ 23%", amount: b5, tax: t5, rate: "23%" },
      { label: "Above ₦50,000,000 @ 25%", amount: b6, tax: t6, rate: "25%" },
    ],
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
  communicationConfig,
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
  communicationConfig?: number
}): PayrollBreakdown {
  const dailyPay = workdays > 0 ? monthlyBase / workdays : 0
  const hourlyRate = dailyPay / NET_DAY_HOURS

  // Lateness Surcharge: (Pay/Day / net day hours) * Missed Hours
  const latenessSurcharge = hourlyRate * missedHours

  // Absent Surcharge: Pay/Day * Absent Days
  const absentSurcharge = dailyPay * absentDays

  // Annualized values
  const annualBase = monthlyBase * 12
  const basic = annualBase * 0.5
  const housing = annualBase * 0.3
  const transport = annualBase * 0.1
  const leaveAllowance = annualBase * 0.1

  const communication = communicationConfig !== undefined ? communicationConfig : 60000 // Default 60,000 per annum (5,000 monthly)
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

/**
 * Attendance statuses that exempt an employee from lateness/absence payroll surcharges.
 *
 * `lwop` is exempt from the *surcharge* but is not forgiven: unpaid leave is charged
 * separately as `unpaidLeaveDeduction`, a full day's gross per day. Treating it as an absence
 * here as well would deduct for the same day twice.
 */
export function isCoveredPayrollStatus(status: string): boolean {
  return (
    status === "waiver" ||
    status === "exempted" ||
    status === "on_leave" ||
    status === "lwop" ||
    status === "holiday" ||
    status === "out_of_station" ||
    status === "absent_with_permission" ||
    status === "lateness_with_permission"
  )
}

export interface PayrollDayContext {
  isHoliday(date: string): boolean
  isOnLeave(userId: string, date: string): boolean
  /** Optional so existing hand-built contexts keep compiling; absent means "all leave paid". */
  isOnUnpaidLeave?(userId: string, date: string): boolean
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
 * Turns a month of attendance records into the two payroll surcharge inputs
 * (missed hours, absent days) by delegating every day to `computeAttendanceDay()`,
 * so the bulk run, single-employee calc, client preview, HR reports and PMS
 * scoring all charge from one set of numbers.
 *
 * A full day of missed hours and an absent day cost the same money — `hourlyRate`
 * is `dailyPay / NET_DAY_HOURS` — so the split here is purely for reporting.
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
        isOnUnpaidLeave: ctx.isOnUnpaidLeave?.(userId, date) ?? false,
        isExempted: attendanceExempt || ctx.isExempt(userId, date),
        recordDate: date,
        earlyClosure: closeTime ? { closeTime } : null,
        lateResumption: lateRes ? { resumptionTime: lateRes } : null,
      },
      policy
    )

    if (isCoveredPayrollStatus(status)) continue

    const day = computeAttendanceDay({
      status,
      clockIn: rec?.clock_in ?? null,
      clockOut: rec?.clock_out ?? null,
      policy,
      earlyCloseTime: closeTime,
      lateResumptionTime: lateRes,
    })

    if (day.covered) continue

    // A day costing the full net shift is billed as an absent day rather than
    // hours, so it reads correctly on the payslip. The money is identical.
    if (day.isAbsent) {
      absentDaysCount++
      continue
    }

    missedHoursCount += day.hoursLost
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
