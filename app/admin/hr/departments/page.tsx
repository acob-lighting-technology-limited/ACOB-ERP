import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { logger } from "@/lib/logger"
import { getDefaultDepartmentDescription } from "@/shared/departments"
import { DepartmentsPage, type Department, type DepartmentEmployee, type DepartmentsData } from "./view"

const log = logger("departments-page")

export const dynamic = "force-dynamic"

async function getInitialData(): Promise<DepartmentsData | undefined> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return undefined

    const scope = await resolveAdminScope(supabase, user.id)

    // Departments page is intentionally org-wide — no dept filtering (per AGENTS.md)
    // canManage: admins in global mode only
    const canManageDepartments = Boolean(scope?.isAdminLike && scope.scopeMode !== "lead")

    const [{ data: departments, error: deptError }, { data: profiles }] = await Promise.all([
      supabase
        .from("departments")
        .select("id, name, description, department_code, is_executive_dept, is_active, created_at, updated_at")
        .order("name"),
      supabase
        .from("profiles")
        .select(
          "id, first_name, last_name, company_email, additional_email, designation, employment_status, department, department_id"
        ),
    ])

    if (deptError) {
      log.error({ err: deptError }, "Failed to fetch departments")
      return undefined
    }

    const deps = (departments ?? []) as Department[]

    // Build employee count map
    const employeesByDept: Record<string, DepartmentEmployee[]> = {}
    for (const d of deps) {
      employeesByDept[d.name] = []
    }

    for (const p of (profiles ?? []) as DepartmentEmployee[]) {
      if (!isAssignableEmploymentStatus(p.employment_status, { allowLegacyNullStatus: false })) continue
      const matchedDept = deps.find(
        (d) =>
          (p.department_id && d.id === p.department_id) ||
          (p.department && d.name.trim().toLowerCase() === p.department.trim().toLowerCase())
      )
      if (matchedDept) {
        employeesByDept[matchedDept.name].push(p)
      }
    }

    const depsWithCounts = deps.map((d) => ({
      ...d,
      description: d.description?.trim() || getDefaultDepartmentDescription(d.name),
      employee_count: employeesByDept[d.name]?.length ?? 0,
    }))

    return {
      departments: depsWithCounts,
      departmentEmployees: employeesByDept,
      canManageDepartments,
    }
  } catch (err) {
    log.error({ err }, "Unexpected error fetching initial departments data")
    return undefined
  }
}

export default async function DepartmentsPageRoute() {
  const initialData = await getInitialData()
  return <DepartmentsPage initialData={initialData} />
}
