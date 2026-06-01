import type { AdminScopeMode } from "@/lib/admin/rbac"
import {
  buildAccessContextV2,
  canAccessRouteV2,
  resolveAdminRouteKeyV2,
  type AccessContextV2,
  type AdminRouteKeyV2,
} from "@/lib/admin/policy-v2"

export interface AdminAccessScope {
  role: string | null | undefined
  isDepartmentLead: boolean
  isAdminLike: boolean
  adminRoutes: AdminRouteKeyV2[] | null
  scopeMode: AdminScopeMode
}

export function canAccessAdminPath(scope: AdminAccessScope, path: string): boolean {
  const context = buildAccessContextV2({
    role: scope.role || "",
    isDepartmentLead: scope.isDepartmentLead,
    isAdminLike: scope.isAdminLike,
    managedDepartments: [],
    adminRoutes: scope.adminRoutes,
    scopeMode: scope.scopeMode,
  })

  const route = resolveAdminRouteKeyV2(path)
  return canAccessRouteV2(context, route)
}

export { buildAccessContextV2, type AccessContextV2 }
