import type { SupabaseClient } from "@supabase/supabase-js"
import { isAdminLikeRole, resolveAdminScope } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"

const EXECUTIVE_DEPARTMENT = normalizeDepartmentName("Executive Management")

/**
 * Who may sign off an emergency requisition.
 *
 * The expedited route drops the review / authorization / verification tiers, so the
 * single remaining signature has to be a real one: an admin-like role, or the lead of
 * Executive Management. Without this gate any authenticated user could clear an
 * emergency requisition end to end.
 */
export async function canApproveEmergencyRequisition(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const scope = await resolveAdminScope(supabase, userId)
  if (!scope) return false

  if (isAdminLikeRole(scope.role)) return true

  if (!scope.isDepartmentLead) return false

  const managed = (scope.managedDepartments || []).map((dept) => normalizeDepartmentName(String(dept || "")))
  const primary = normalizeDepartmentName(String(scope.department || ""))
  return managed.includes(EXECUTIVE_DEPARTMENT) || primary === EXECUTIVE_DEPARTMENT
}
