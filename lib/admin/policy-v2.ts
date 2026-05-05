import { normalizeDepartmentName } from "@/shared/departments"

export type AdminDomain = "hr" | "finance" | "assets" | "reports" | "tasks" | "projects" | "communications"

export interface AccessScopeInputV2 {
  role: string
  isDepartmentLead: boolean
  isAdminLike: boolean
  adminDomains: AdminDomain[] | null
  scopeMode: "global" | "lead"
  managedDepartments: string[]
}

export type ActingContextV2 = "global_admin" | "department_lead"
export type RouteVisibilityV2 = "none" | "dept" | "global_view"
export type RouteMutationsV2 = "none" | "dept" | "global"
export type DataScopeV2 = "none" | "all" | string[]

export type AdminRouteKeyV2 =
  | "admin.dashboard"
  | "auditlogs.main"
  | "assets.main"
  | "assets.issues"
  | "communications.main"
  | "communications.broadcast"
  | "communications.meetings"
  | "correspondence.main"
  | "dev.main"
  | "documentation.main"
  | "feedback.main"
  | "finance.main"
  | "helpdesk.main"
  | "hr.main"
  | "hr.fleet"
  | "hr.resources"
  | "hr.pms.cbt.manage"
  | "inventory.main"
  | "jobdescriptions.main"
  | "notifications.main"
  | "purchasing.main"
  | "reports.weekly"
  | "reports.other"
  | "settings.main"
  | "tasks.main"
  | "tools.main"
  | "unknown"

export interface AccessContextV2 {
  baseRole: string
  isDepartmentLead: boolean
  isAdminLike: boolean
  adminDomains: AdminDomain[] | null
  actingContext: ActingContextV2
  managedDepartments: string[]
}

export interface RoutePolicyV2 {
  visibility: RouteVisibilityV2
  mutations: RouteMutationsV2
  adminOnly: boolean
  domain: AdminDomain | null
}

export function isRbacV2Enabled() {
  return String(process.env.RBAC_V2_ENABLED || "true").toLowerCase() !== "false"
}

function normalizeRole(role: string | null | undefined) {
  return String(role || "")
    .trim()
    .toLowerCase()
}

function normalizeDepartmentList(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizeDepartmentName(String(value || ""))).filter(Boolean)))
}

export function buildAccessContextV2(scope: AccessScopeInputV2): AccessContextV2 {
  const baseRole = normalizeRole(scope.role)
  const isAdminLike = scope.isAdminLike || ["developer", "super_admin", "admin"].includes(baseRole)
  const actingContext: ActingContextV2 =
    scope.scopeMode === "lead" || (!isAdminLike && scope.isDepartmentLead) ? "department_lead" : "global_admin"

  return {
    baseRole,
    isDepartmentLead: scope.isDepartmentLead,
    isAdminLike,
    adminDomains: scope.adminDomains,
    actingContext,
    managedDepartments: normalizeDepartmentList(scope.managedDepartments || []),
  }
}

export function resolveAdminRouteKeyV2(pathname: string): AdminRouteKeyV2 {
  if (!pathname.startsWith("/admin")) return "unknown"
  if (pathname === "/admin") return "admin.dashboard"
  if (pathname.startsWith("/admin/audit-logs")) return "auditlogs.main"
  if (pathname.startsWith("/admin/dev")) return "dev.main"
  if (pathname.startsWith("/admin/settings")) return "settings.main"
  if (pathname.startsWith("/admin/communications/meetings")) return "communications.meetings"
  if (pathname.startsWith("/admin/communications/broadcast")) return "communications.broadcast"
  if (pathname.startsWith("/admin/communications")) return "communications.main"
  if (pathname.startsWith("/admin/assets/issues")) return "assets.issues"
  if (pathname.startsWith("/admin/assets")) return "assets.main"
  if (pathname.startsWith("/admin/correspondence")) return "correspondence.main"
  if (pathname.startsWith("/admin/documentation")) return "documentation.main"
  if (pathname.startsWith("/admin/feedback")) return "feedback.main"
  if (pathname.startsWith("/admin/finance")) return "finance.main"
  if (pathname.startsWith("/admin/help-desk")) return "helpdesk.main"
  if (pathname.startsWith("/admin/hr/pms/cbt/question")) return "hr.pms.cbt.manage"
  if (/^\/admin\/hr\/pms\/cbt\/[^/]+$/.test(pathname)) return "hr.pms.cbt.manage"
  if (pathname.startsWith("/admin/hr/fleet")) return "hr.fleet"
  if (pathname.startsWith("/admin/hr/resources")) return "hr.resources"
  if (pathname.startsWith("/admin/hr")) return "hr.main"
  if (pathname.startsWith("/admin/inventory")) return "inventory.main"
  if (pathname.startsWith("/admin/job-descriptions")) return "jobdescriptions.main"
  if (pathname.startsWith("/admin/notifications")) return "notifications.main"
  if (pathname.startsWith("/admin/purchasing")) return "purchasing.main"
  if (pathname.startsWith("/admin/reports")) {
    if (pathname.includes("/weekly-reports")) return "reports.weekly"
    return "reports.other"
  }
  if (pathname.startsWith("/admin/tasks")) return "tasks.main"
  if (pathname.startsWith("/admin/tools")) return "tools.main"
  return "unknown"
}

export function getRoutePolicyV2(route: AdminRouteKeyV2): RoutePolicyV2 {
  switch (route) {
    case "dev.main":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: null }
    case "auditlogs.main":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: null }
    case "settings.main":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: null }
    case "communications.meetings":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "communications" }
    case "hr.fleet":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "hr" }
    case "hr.resources":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "hr" }
    case "hr.pms.cbt.manage":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "hr" }
    case "reports.weekly":
      return { visibility: "global_view", mutations: "dept", adminOnly: false, domain: "reports" }
    case "reports.other":
      return { visibility: "global_view", mutations: "none", adminOnly: false, domain: "reports" }
    case "admin.dashboard":
      return { visibility: "dept", mutations: "none", adminOnly: false, domain: null }
    case "assets.main":
    case "assets.issues":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "assets" }
    case "communications.main":
    case "communications.broadcast":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "correspondence.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "documentation.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "feedback.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "finance.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "finance" }
    case "helpdesk.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "hr.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "hr" }
    case "inventory.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "assets" }
    case "jobdescriptions.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "hr" }
    case "notifications.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "purchasing.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "finance" }
    case "tasks.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "tasks" }
    case "tools.main":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "communications" }
    case "unknown":
    default:
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: null }
  }
}

function adminHasDomain(context: AccessContextV2, domain: AdminDomain | null) {
  if (!domain) return true
  if (context.baseRole === "developer" || context.baseRole === "super_admin") return true
  if (context.baseRole !== "admin") return false
  return Array.isArray(context.adminDomains) && context.adminDomains.includes(domain)
}

function isDepartmentManaged(context: AccessContextV2, department: string) {
  const normalizedDepartment = normalizeDepartmentName(department)
  return context.managedDepartments.includes(normalizedDepartment)
}

export function canAccessRouteV2(context: AccessContextV2, route: AdminRouteKeyV2): boolean {
  const policy = getRoutePolicyV2(route)
  const isGlobalAdminContext = context.actingContext === "global_admin" && context.isAdminLike

  if (isGlobalAdminContext) {
    if (route === "auditlogs.main") {
      return context.baseRole === "developer" || context.baseRole === "super_admin"
    }
    if (policy.adminOnly) return adminHasDomain(context, policy.domain)
    return adminHasDomain(context, policy.domain)
  }

  if (!context.isDepartmentLead) return false
  if (policy.adminOnly) return false
  return policy.visibility !== "none"
}

export function getDataScopeV2(context: AccessContextV2, route: AdminRouteKeyV2): DataScopeV2 {
  if (!canAccessRouteV2(context, route)) return "none"

  const policy = getRoutePolicyV2(route)
  const isGlobalAdminContext = context.actingContext === "global_admin" && context.isAdminLike
  if (isGlobalAdminContext) return "all"

  if (policy.visibility === "global_view") return "all"
  if (policy.visibility === "dept") return context.managedDepartments
  return "none"
}

export function canMutateV2(
  context: AccessContextV2,
  route: AdminRouteKeyV2,
  resourceDepartment?: string | null
): boolean {
  if (!canAccessRouteV2(context, route)) return false

  const policy = getRoutePolicyV2(route)
  const isGlobalAdminContext = context.actingContext === "global_admin" && context.isAdminLike
  if (isGlobalAdminContext) {
    if (route === "reports.other") {
      return adminHasDomain(context, policy.domain)
    }
    return policy.mutations !== "none" && adminHasDomain(context, policy.domain)
  }

  if (policy.adminOnly || policy.mutations === "none") return false
  if (policy.mutations === "global") return true

  if (policy.mutations === "dept") {
    if (!resourceDepartment) return false
    return isDepartmentManaged(context, resourceDepartment)
  }

  return false
}

export function applyDataScopeV2<T>(rows: T[], scope: DataScopeV2, getDepartment: (row: T) => string | null): T[] {
  if (scope === "all") return rows
  if (scope === "none") return []
  if (scope.length === 0) return []

  return rows.filter((row) => {
    const department = getDepartment(row)
    if (!department) return false
    const normalizedDepartment = normalizeDepartmentName(department)
    return scope.includes(normalizedDepartment)
  })
}
