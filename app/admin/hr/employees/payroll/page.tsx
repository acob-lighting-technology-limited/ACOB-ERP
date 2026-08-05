import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { PayrollPeriodsPage } from "@/app/admin/hr/payroll/view"

const log = logger("payroll-periods-page")
export const dynamic = "force-dynamic"

async function getPeriodsData() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return undefined

    // Service-role read: the register spans every employee's entries, which RLS only
    // grants to the exact `admin` role — the same reason the leave balances route
    // uses it. Access is already gated by the isAdminLike check above.
    const db = getServiceRoleClientOrFallback(supabase)

    const [{ data: periods }, { data: entries }] = await Promise.all([
      supabase.from("payroll_periods").select("*").order("start_date", { ascending: false }),
      db
        .from("payroll_entries")
        .select(
          `id, user_id, payroll_period_id, basic_salary, gross_salary, total_deductions,
           net_salary, tax_amount, bonus, lunch_deduction, loan_repayment,
           lateness_surcharge, absent_surcharge, status, breakdown,
           user:profiles!payroll_entries_user_id_fkey(id, full_name, employee_number, department),
           payroll_periods!payroll_entries_payroll_period_id_fkey(id, name, pay_date, start_date, status)`
        )
        .order("created_at", { ascending: false }),
    ])

    // PostgREST returns embedded relations as arrays; flatten to the single row each
    // FK actually points at so the client can read `entry.user.full_name` directly.
    const first = <T,>(value: T | T[] | null | undefined): T | null =>
      Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

    const normalizedEntries = (entries || []).map((entry) => ({
      ...entry,
      user: first(entry.user),
      payroll_periods: first(entry.payroll_periods),
    }))

    return {
      periods: periods || [],
      entries: normalizedEntries,
      isAdmin: scope.scopeMode !== "lead",
    }
  } catch (err) {
    log.error({ err: String(err) }, "Unexpected error fetching payroll periods data")
    return undefined
  }
}

export default async function PayrollPeriodsRoute() {
  const initialData = await getPeriodsData()
  return <PayrollPeriodsPage initialData={initialData} />
}
