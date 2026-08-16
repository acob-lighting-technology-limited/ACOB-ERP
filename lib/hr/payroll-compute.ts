/**
 * Payroll worksheet computation — shared by the worksheet API and the payslip
 * mailer so both see identical figures.
 *
 * A locked ("completed") period renders the immutable snapshot stored at publish
 * time; a draft period is computed live from attendance, salary and lunch data.
 * That distinction is deliberate: historical payslips must never drift when the
 * formula or an attendance record changes later.
 *
 * Extracted verbatim from app/api/admin/payroll/run/route.ts, which now imports it.
 */

import { loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { loadDayContext } from "@/lib/hr/attendance-day-context"
import {
  calculatePayroll,
  countUnpaidLeaveDays,
  defaultMonthlyCommunicationAllowance,
  derivePayrollAttendance,
  getPayrollWorkdays,
  type PayrollAttendanceRecord,
  type PayrollBreakdown,
  type UnpaidLeaveRow,
} from "@/lib/hr/payroll-utils"
import { logger } from "@/lib/logger"

const log = logger("hr-payroll-compute")

export interface PayrollComputedRow {
  user_id: string
  full_name: string
  first_name: string
  last_name: string
  employee_number: string
  company_email: string
  department: string | null
  designation: string | null
  breakdown: PayrollBreakdown
  /** The payroll_entries row id — only present once a period is locked and published. */
  entry_id?: string
  /** Set once the payslip has been emailed. Only meaningful (and present) for locked periods. */
  payslip_emailed_at?: string | null
}

/**
 * Approved leave in the period whose leave type is flagged `is_paid = false`
 * (Leave Without Pay, Study Leave, …), reduced to unpaid working days per employee.
 * Cancelled and pending requests are excluded — only granted leave costs pay.
 */
export async function loadUnpaidLeaveDays(
  dataClient: any,
  userIds: string[],
  period: { start_date: string; end_date: string },
  workdayDates: string[]
): Promise<Map<string, number>> {
  const { data, error } = await dataClient
    .from("leave_requests")
    .select("user_id, start_date, end_date, leave_type:leave_types!leave_requests_leave_type_id_fkey(is_paid)")
    .in("user_id", userIds)
    .eq("status", "approved")
    .lte("start_date", period.end_date)
    .gte("end_date", period.start_date)

  if (error) {
    // Never silently under-deduct: surface the failure rather than paying in full.
    log.error({ err: String(error) }, "Failed to load unpaid leave for payroll")
    throw new Error("Failed to load unpaid leave")
  }

  const unpaid = (data || []).filter((row: any) => row.leave_type?.is_paid === false) as UnpaidLeaveRow[]
  return countUnpaidLeaveDays(unpaid, workdayDates)
}

export async function computePayrollBatch(
  dataClient: any,
  periodId: string
): Promise<{ error: string } | { period: any; rows: PayrollComputedRow[] }> {
  const { data: period, error: periodErr } = await dataClient
    .from("payroll_periods")
    .select("*")
    .eq("id", periodId)
    .single()

  if (periodErr || !period) {
    return { error: "Payroll period not found" as const }
  }

  const policy = await loadAttendancePolicy(dataClient)

  const { data: employees, error: empErr } = await dataClient
    .from("profiles")
    .select(
      "id, full_name, first_name, last_name, employee_number, company_email, attendance_exempt, department, designation, is_department_lead"
    )
    .eq("employment_status", "active")
    .order("last_name", { ascending: true })

  if (empErr) {
    return { error: "Failed to fetch active employees" as const }
  }

  // A locked/completed period is a published payslip run — render the immutable
  // snapshot stored at publish time rather than recomputing, so historical
  // payslips never drift if attendance records or the formula change later.
  if (period.status === "completed") {
    const { data: publishedEntries } = await dataClient
      .from("payroll_entries")
      .select("id, user_id, breakdown, payslip_emailed_at")
      .eq("payroll_period_id", periodId)

    const byUser = new Map<string, any>((publishedEntries || []).map((e: any) => [e.user_id, e]))
    const rows = employees
      .filter((emp: any) => byUser.has(emp.id))
      .map((emp: any) => {
        const entry = byUser.get(emp.id)!
        return {
          user_id: emp.id,
          full_name: emp.full_name,
          first_name: emp.first_name,
          last_name: emp.last_name,
          employee_number: emp.employee_number,
          company_email: emp.company_email,
          department: emp.department ?? null,
          designation: emp.designation ?? null,
          breakdown: entry.breakdown,
          entry_id: entry.id,
          payslip_emailed_at: entry.payslip_emailed_at ?? null,
        }
      })

    return { period, rows }
  }

  const userIds: string[] = employees.map((e: any) => e.id)

  const ctx = await loadDayContext(dataClient, {
    userIds,
    start: period.start_date,
    end: period.end_date,
  })

  const workdayDates = getPayrollWorkdays(period.start_date, period.end_date, ctx)

  const [{ data: salaries }, { data: attendance }, { data: lunchLogs }, { data: existingEntries }] = await Promise.all([
    dataClient.from("employee_salaries").select("*").in("user_id", userIds).eq("is_active", true),
    dataClient
      .from("attendance_records")
      .select("user_id, date, clock_in, clock_out, waived, status")
      .in("user_id", userIds)
      .gte("date", period.start_date)
      .lte("date", period.end_date),
    dataClient
      .from("attendance_lunch_log")
      .select("user_id, employee_deduction")
      .in("user_id", userIds)
      .gte("date", period.start_date)
      .lte("date", period.end_date),
    dataClient.from("payroll_entries").select("*").eq("payroll_period_id", periodId),
  ])

  const existingMap = new Map<string, any>((existingEntries || []).map((e: any) => [e.user_id, e]))

  const attByUser = new Map<string, Map<string, PayrollAttendanceRecord>>()
  for (const rec of attendance || []) {
    if (!attByUser.has(rec.user_id)) attByUser.set(rec.user_id, new Map())
    attByUser.get(rec.user_id)!.set(rec.date, rec)
  }

  const lunchByUser = new Map<string, number>()
  for (const entry of lunchLogs || []) {
    lunchByUser.set(entry.user_id, (lunchByUser.get(entry.user_id) || 0) + Number(entry.employee_deduction))
  }

  const unpaidLeaveByUser = await loadUnpaidLeaveDays(dataClient, userIds, period, workdayDates)

  const rows = employees.map((emp: any) => {
    const salary = salaries?.find((s: any) => s.user_id === emp.id)
    const defaultMonthlyBase = salary ? Number(salary.basic_salary) : 0

    const { missedHours, absentDays } = derivePayrollAttendance({
      userId: emp.id,
      attendanceExempt: Boolean(emp.attendance_exempt),
      workdayDates,
      attendanceByDate: attByUser.get(emp.id) || new Map(),
      ctx,
      policy,
    })

    const existing = existingMap.get(emp.id)
    const bonus = existing ? Number(existing.bonus) : 0
    const loanRepayment = existing ? Number(existing.loan_repayment) : 0
    const lunchDeduction = lunchByUser.get(emp.id) || 0
    // A gross/communication override made in the worksheet (see the run route's
    // POST handler) is stored inside the saved breakdown snapshot, not a
    // dedicated column — carry it forward the same way bonus/loan already are,
    // so reloading a draft shows what was last saved rather than resetting it.
    // Absent any override, department leads default to a higher communication
    // allowance than regular staff (see defaultMonthlyCommunicationAllowance).
    const monthlyBase = existing?.breakdown?.monthlyBase ?? defaultMonthlyBase
    const communicationConfig =
      existing?.breakdown?.communication ?? defaultMonthlyCommunicationAllowance(Boolean(emp.is_department_lead)) * 12

    const breakdown = calculatePayroll({
      monthlyBase,
      workdays: workdayDates.length,
      missedHours,
      absentDays,
      unpaidLeaveDays: unpaidLeaveByUser.get(emp.id) || 0,
      bonus,
      loanRepayment,
      lunchDeduction,
      communicationConfig,
    })

    return {
      user_id: emp.id,
      full_name: emp.full_name,
      first_name: emp.first_name,
      last_name: emp.last_name,
      employee_number: emp.employee_number,
      company_email: emp.company_email,
      department: emp.department ?? null,
      designation: emp.designation ?? null,
      breakdown,
    }
  })

  return { period, rows }
}
