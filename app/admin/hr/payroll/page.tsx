import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { PayrollPeriodsPage } from "./view"

const log = logger("payroll-periods-page")
export const dynamic = "force-dynamic"

async function getPeriodsData() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return undefined

    const [{ data: periods }, { data: entries }] = await Promise.all([
      supabase.from("payroll_periods").select("*").order("start_date", { ascending: false }),
      supabase.from("payroll_entries").select("net_salary, tax_amount"),
    ])

    return {
      periods: periods || [],
      entries: entries || [],
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
