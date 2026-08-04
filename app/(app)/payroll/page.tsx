import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { redirect } from "next/navigation"
import type { PayrollBreakdown } from "@/lib/hr/payroll-utils"
import { UserPayrollPage } from "./view"

const log = logger("user-payroll-page")
export const dynamic = "force-dynamic"

export interface UserPayrollEntry {
  id: string
  payroll_period_id: string
  basic_salary: number
  gross_salary: number
  total_deductions: number
  net_salary: number
  tax_amount: number
  bonus: number
  lunch_deduction: number
  loan_repayment: number
  breakdown: PayrollBreakdown | null
  status: string
  payroll_periods: {
    id: string
    name: string
    start_date: string
    end_date: string
    pay_date: string
  } | null
}

async function getMyPayrollData() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return undefined

    // Fetch employee profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, employee_number, department, designation")
      .eq("id", user.id)
      .single()

    // Fetch payroll entries for this user
    const { data: entries, error } = await supabase
      .from("payroll_entries")
      .select(
        `
        id,
        payroll_period_id,
        basic_salary,
        gross_salary,
        total_deductions,
        net_salary,
        tax_amount,
        bonus,
        lunch_deduction:leave_deduction,
        loan_repayment:other_deductions,
        breakdown,
        status,
        payroll_periods:payroll_period_id (
          id,
          name,
          start_date,
          end_date,
          pay_date
        )
      `
      )
      .eq("user_id", user.id)
      .returns<UserPayrollEntry[]>()

    if (error) {
      log.error({ err: error.message }, "Failed to fetch user payroll entries")
      return undefined
    }

    return {
      profile: profile || null,
      entries: entries || [],
    }
  } catch (err) {
    log.error({ err: String(err) }, "Unexpected error loading user payroll page")
    return undefined
  }
}

export default async function UserPayrollPageRoute() {
  const initialData = await getMyPayrollData()
  if (!initialData) {
    redirect("/auth/login")
  }

  return <UserPayrollPage initialData={initialData} />
}
