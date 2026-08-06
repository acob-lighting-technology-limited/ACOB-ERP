import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { loadDayContext } from "@/lib/hr/attendance-day-context"
import {
  calculatePayroll,
  countUnpaidLeaveDays,
  derivePayrollAttendance,
  getPayrollWorkdays,
  type PayrollAttendanceRecord,
  type UnpaidLeaveRow,
} from "@/lib/hr/payroll-utils"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-payroll-run")
export const dynamic = "force-dynamic"

/**
 * Approved leave in the period whose leave type is flagged `is_paid = false`
 * (Leave Without Pay, Study Leave, …), reduced to unpaid working days per employee.
 * Cancelled and pending requests are excluded — only granted leave costs pay.
 */
async function loadUnpaidLeaveDays(
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

async function computeBatch(dataClient: any, periodId: string) {
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
    .select("id, full_name, employee_number, company_email, attendance_exempt")
    .eq("employment_status", "active")
    .order("full_name", { ascending: true })

  if (empErr) {
    return { error: "Failed to fetch active employees" as const }
  }

  // A locked/completed period is a published payslip run — render the immutable
  // snapshot stored at publish time rather than recomputing, so historical
  // payslips never drift if attendance records or the formula change later.
  if (period.status === "completed") {
    const { data: publishedEntries } = await dataClient
      .from("payroll_entries")
      .select("user_id, breakdown")
      .eq("payroll_period_id", periodId)

    const byUser = new Map((publishedEntries || []).map((e: any) => [e.user_id, e.breakdown]))
    const rows = employees
      .filter((emp: any) => byUser.has(emp.id))
      .map((emp: any) => ({
        user_id: emp.id,
        full_name: emp.full_name,
        employee_number: emp.employee_number,
        company_email: emp.company_email,
        breakdown: byUser.get(emp.id),
      }))

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
    const monthlyBase = salary ? Number(salary.basic_salary) : 0

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

    const breakdown = calculatePayroll({
      monthlyBase,
      workdays: workdayDates.length,
      missedHours,
      absentDays,
      unpaidLeaveDays: unpaidLeaveByUser.get(emp.id) || 0,
      bonus,
      loanRepayment,
      lunchDeduction,
    })

    return {
      user_id: emp.id,
      full_name: emp.full_name,
      employee_number: emp.employee_number,
      company_email: emp.company_email,
      breakdown,
    }
  })

  return { period, rows }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = request.nextUrl
    const periodId = searchParams.get("payroll_period_id")
    if (!periodId) {
      return NextResponse.json({ error: "payroll_period_id is required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const result = await computeBatch(dataClient, periodId)
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json({ data: result.rows, status: result.period.status })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET /api/admin/hr/payroll/run")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || !body.payroll_period_id || !Array.isArray(body.overrides)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const {
      payroll_period_id,
      overrides,
      lockPeriod = false,
    } = body as {
      payroll_period_id: string
      overrides: Array<{ user_id: string; bonus?: number; loanRepayment?: number }>
      lockPeriod?: boolean
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Persist bonus/loan overrides first so the recompute below picks them up.
    const overrideMap = new Map(overrides.map((o) => [o.user_id, o]))

    const { data: period, error: periodErr } = await dataClient
      .from("payroll_periods")
      .select("*")
      .eq("id", payroll_period_id)
      .single()

    if (periodErr || !period) {
      return NextResponse.json({ error: "Payroll period not found" }, { status: 404 })
    }

    if (period.status === "completed") {
      return NextResponse.json({ error: "This payroll period is locked and cannot be modified" }, { status: 409 })
    }

    const policy = await loadAttendancePolicy(dataClient)

    const { data: employees, error: empErr } = await dataClient
      .from("profiles")
      .select("id, full_name, employee_number, attendance_exempt")
      .eq("employment_status", "active")
      .order("full_name", { ascending: true })

    if (empErr) {
      return NextResponse.json({ error: "Failed to fetch active employees" }, { status: 500 })
    }

    const userIds: string[] = employees.map((e: any) => e.id)

    const ctx = await loadDayContext(dataClient, {
      userIds,
      start: period.start_date,
      end: period.end_date,
    })
    const workdayDates = getPayrollWorkdays(period.start_date, period.end_date, ctx)

    const [{ data: salaries }, { data: attendance }, { data: lunchLogs }, { data: existingEntries }] =
      await Promise.all([
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
        dataClient
          .from("payroll_entries")
          .select("user_id, bonus, loan_repayment")
          .eq("payroll_period_id", payroll_period_id),
      ])

    const existingMap = new Map<string, any>((existingEntries || []).map((e: any) => [e.user_id, e]))

    const attByUser = new Map<string, Map<string, PayrollAttendanceRecord>>()
    for (const rec of attendance || []) {
      if (!attByUser.has(rec.user_id)) attByUser.set(rec.user_id, new Map())
      attByUser.get(rec.user_id)!.set(rec.date, rec)
    }

    const lunchByUser = new Map<string, number>()
    for (const l of lunchLogs || []) {
      lunchByUser.set(l.user_id, (lunchByUser.get(l.user_id) || 0) + Number(l.employee_deduction))
    }

    const unpaidLeaveByUser = await loadUnpaidLeaveDays(dataClient, userIds, period, workdayDates)

    // Server recomputes every figure from source data; the client only ever supplies
    // the bonus/loan overrides, never the derived breakdown itself.
    const insertRows = employees.map((emp: any) => {
      const salary = salaries?.find((s: any) => s.user_id === emp.id)
      const monthlyBase = salary ? Number(salary.basic_salary) : 0

      const { missedHours, absentDays } = derivePayrollAttendance({
        userId: emp.id,
        attendanceExempt: Boolean(emp.attendance_exempt),
        workdayDates,
        attendanceByDate: attByUser.get(emp.id) || new Map(),
        ctx,
        policy,
      })

      const override = overrideMap.get(emp.id)
      const existing = existingMap.get(emp.id)
      const bonus = override?.bonus ?? (existing ? Number(existing.bonus) : 0)
      const loanRepayment = override?.loanRepayment ?? (existing ? Number(existing.loan_repayment) : 0)
      const lunchDeduction = lunchByUser.get(emp.id) || 0

      const breakdown = calculatePayroll({
        monthlyBase,
        workdays: workdayDates.length,
        missedHours,
        absentDays,
        unpaidLeaveDays: unpaidLeaveByUser.get(emp.id) || 0,
        bonus,
        loanRepayment,
        lunchDeduction,
      })

      return {
        payroll_period_id,
        user_id: emp.id,
        basic_salary: breakdown.monthlyBase,
        gross_salary: breakdown.monthlyGross,
        total_deductions: breakdown.totalDeductions,
        net_salary: breakdown.netPay,
        tax_amount: breakdown.monthlyTax,
        bonus: breakdown.bonus,
        lunch_deduction: breakdown.lunchDeduction,
        loan_repayment: breakdown.loanRepayment,
        lateness_surcharge: breakdown.latenessSurcharge,
        absent_surcharge: breakdown.absentSurcharge,
        pension_employee: breakdown.monthlyPensionEmployee,
        pension_employer: breakdown.monthlyPensionEmployer,
        breakdown,
        status: lockPeriod ? "paid" : "pending",
        payslip_generated: lockPeriod,
      }
    })

    const { data: savedRows, error: upsertErr } = await dataClient
      .from("payroll_entries")
      .upsert(insertRows, { onConflict: "payroll_period_id,user_id" })
      .select()

    if (upsertErr) {
      log.error({ err: upsertErr.message }, "Error saving payroll entries")
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }

    if (lockPeriod) {
      const totalNet = insertRows.reduce((acc, cur) => acc + Number(cur.net_salary), 0)
      const { error: lockErr } = await dataClient
        .from("payroll_periods")
        .update({
          status: "completed",
          total_amount: totalNet,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payroll_period_id)

      if (lockErr) {
        log.error({ err: lockErr.message }, "Error locking payroll period")
        return NextResponse.json({ error: lockErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, entries: savedRows })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in POST /api/admin/hr/payroll/run")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
