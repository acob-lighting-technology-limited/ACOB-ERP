import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { notFound } from "next/navigation"
import { PayrollCalculatorPage } from "./view"

const log = logger("payroll-calculator-page")
export const dynamic = "force-dynamic"

export interface EmployeeSalaryPreset {
  id: string
  full_name: string
  employee_number: string
  department: string | null
  basic_salary: number
  is_department_lead?: boolean
}

async function getCalculatorInitialData() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return undefined

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const db = getServiceRoleClientOrFallback(supabase)

    const [{ data: profiles }, { data: salaries }] = await Promise.all([
      db
        .from("profiles")
        .select("id, full_name, employee_number, department, employment_status, is_department_lead, role")
        .eq("employment_status", "active")
        .order("full_name", { ascending: true }),
      db.from("employee_salaries").select("user_id, basic_salary, is_active").eq("is_active", true),
    ])

    const salaryMap = new Map<string, number>(
      (salaries || []).map((s: { user_id: string; basic_salary: number }) => [s.user_id, Number(s.basic_salary) || 0])
    )

    const employees: EmployeeSalaryPreset[] = (profiles || []).map(
      (p: {
        id: string
        full_name: string
        employee_number: string
        department: string | null
        is_department_lead?: boolean
        role?: string
      }) => ({
        id: p.id,
        full_name: p.full_name || "Unknown Employee",
        employee_number: p.employee_number || "N/A",
        department: p.department || "General",
        basic_salary: salaryMap.get(p.id) || 195000,
        is_department_lead: Boolean(
          p.is_department_lead || p.role === "department_lead" || p.role === "admin" || p.role === "super_admin"
        ),
      })
    )

    return {
      employees,
      currentUserId: user?.id ?? "",
      isAdmin: scope.scopeMode !== "lead",
    }
  } catch (err) {
    log.error({ err: String(err) }, "Unexpected error fetching payroll calculator initial data")
    return undefined
  }
}

export default async function PayrollCalculatorRoute() {
  const initialData = await getCalculatorInitialData()
  if (!initialData) {
    return notFound()
  }

  return <PayrollCalculatorPage initialData={initialData} />
}
