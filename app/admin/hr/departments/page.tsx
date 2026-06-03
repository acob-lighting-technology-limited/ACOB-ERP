import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { logger } from "@/lib/logger"
import { DepartmentsPage, type Department, type DepartmentEmployee, type DepartmentsData } from "./view"

const log = logger("departments-page")

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
          "id, first_name, last_name, company_email, additional_email, designation, employment_status, department"
        ),
    ])

    if (deptError) {
      log.error({ err: deptError }, "Failed to fetch departments")
      return undefined
    }

    const deps = (departments ?? []) as Department[]

    // Build employee count map
    const scopedDeptNames = new Set(deps.map((d) => d.name))
    const employeesByDept: Record<string, DepartmentEmployee[]> = {}
    for (const p of (profiles ?? []) as DepartmentEmployee[]) {
      if (!isAssignableEmploymentStatus(p.employment_status, { allowLegacyNullStatus: false })) continue
      const deptName = p.department || "Unassigned"
      if (!scopedDeptNames.has(deptName)) continue
      if (!employeesByDept[deptName]) employeesByDept[deptName] = []
      employeesByDept[deptName].push(p)
    }

    const depsWithCounts = deps.map((d) => ({
      ...d,
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
