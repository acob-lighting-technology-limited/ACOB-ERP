import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeDepartmentName } from "@/shared/departments"

export interface DeptScope {
  userId: string
  role: string
  deptId: string
  deptName: string
  isAdminLike: boolean
}

interface ProfileShape {
  role: string | null
  is_department_lead: boolean
  lead_departments: string[] | null
  department: string | null
  department_id: string | null
}

interface DepartmentRow {
  id: string
  name: string
}

function normalizeRole(role: string | null | undefined): string | null {
  if (!role) return null
  const n = role.trim().toLowerCase()
  return n.length > 0 ? n : null
}

/**
 * Resolves a DeptScope for the given user + department.
 *
 * Returns null when:
 *  - the user profile cannot be found
 *  - the user is not a department lead (is_department_lead !== true)
 *  - the requested deptId does not match any department the user leads
 *  - the department row does not exist
 */
export async function resolveDeptScope(
  supabase: SupabaseClient,
  userId: string,
  deptId: string
): Promise<DeptScope | null> {
  if (!deptId) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_department_lead, lead_departments, department, department_id")
    .eq("id", userId)
    .single<ProfileShape>()

  if (!profile) return null
  if (!profile.is_department_lead) return null

  // Fetch the target department
  const { data: dept } = await supabase.from("departments").select("id, name").eq("id", deptId).single<DepartmentRow>()

  if (!dept) return null

  const normalizedDeptName = normalizeDepartmentName(dept.name)

  // Verify ownership — either via lead_departments name match or department_id match
  const leadDepts: string[] = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  const normalizedLeadDepts = leadDepts.map((d) => normalizeDepartmentName(d))

  const leadsByName = normalizedLeadDepts.includes(normalizedDeptName)
  const leadsByDeptId = profile.department_id === deptId

  if (!leadsByName && !leadsByDeptId) return null

  const normalizedRole = normalizeRole(profile.role) ?? "employee"
  const isAdminLike = normalizedRole === "developer" || normalizedRole === "admin" || normalizedRole === "super_admin"

  return {
    userId,
    role: normalizedRole,
    deptId: dept.id,
    deptName: dept.name,
    isAdminLike,
  }
}
