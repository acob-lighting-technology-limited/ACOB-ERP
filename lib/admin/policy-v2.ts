import { normalizeDepartmentName } from "@/shared/departments"

export type AdminDomain = "hr" | "finance" | "assets" | "reports" | "tasks" | "projects" | "communications"

export interface AccessScopeInputV2 {
  role: string
  isDepartmentLead: boolean
  isAdminLike: boolean
  adminRoutes: AdminRouteKeyV2[] | null
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
  | "hr.leave"
  | "hr.attendance"
  | "hr.pms"
  | "hr.pms.cbt.manage"
  | "inventory.main"
  | "jobdescriptions.main"
  | "notifications.main"
  | "payroll.main"
  | "purchasing.main"
  | "reports.weekly"
  | "reports.other"
  | "security.networkActivity"
  | "security.bypassOverride"
  | "settings.main"
  | "tasks.main"
  | "tools.main"
  | "unknown"

/** Routes that can be explicitly granted to an admin user. Excludes system-only routes. */
export const GRANTABLE_ADMIN_ROUTES: AdminRouteKeyV2[] = [
  "hr.main",
  "hr.fleet",
  "hr.resources",
  "hr.leave",
  "hr.attendance",
  "hr.pms",
  "hr.pms.cbt.manage",
  "jobdescriptions.main",
  "finance.main",
  "payroll.main",
  "purchasing.main",
  "assets.main",
  "assets.issues",
  "inventory.main",
  "reports.weekly",
  "reports.other",
  "tasks.main",
  "communications.main",
  "communications.broadcast",
  "communications.meetings",
  "correspondence.main",
  "documentation.main",
  "feedback.main",
  "helpdesk.main",
  "notifications.main",
  "tools.main",
  "settings.main",
  "auditlogs.main",
  "security.networkActivity",
  "security.bypassOverride",
]

export interface AccessContextV2 {
  baseRole: string
  isDepartmentLead: boolean
  isAdminLike: boolean
  adminRoutes: AdminRouteKeyV2[] | null
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
    adminRoutes: scope.adminRoutes,
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
  // Onboarding lists every account and its sign-in state — same account-admin
  // surface as Settings → Users, so it gates on the same route key.
  if (pathname.startsWith("/admin/onboarding")) return "settings.main"
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
  // Payroll owns its own key. The two legacy HR paths still resolve here so the
  // redirect stubs behave identically to the new /admin/payroll route — this
  // must stay above the /admin/hr fallthrough below.
  if (pathname.startsWith("/admin/payroll")) return "payroll.main"
  if (pathname.startsWith("/admin/hr/payroll")) return "payroll.main"
  if (pathname.startsWith("/admin/hr/employees/payroll")) return "payroll.main"
  if (pathname.startsWith("/admin/hr/pms/cbt/question")) return "hr.pms.cbt.manage"
  if (/^\/admin\/hr\/pms\/cbt\/[^/]+$/.test(pathname)) return "hr.pms.cbt.manage"
  if (pathname.startsWith("/admin/hr/pms")) return "hr.pms"
  if (pathname.startsWith("/admin/hr/leave")) return "hr.leave"
  if (pathname.startsWith("/admin/hr/attendance")) return "hr.attendance"
  // Fleet and Resources are the same "Resource Booking" feature — both gate on hr.fleet.
  if (pathname.startsWith("/admin/hr/fleet")) return "hr.fleet"
  if (pathname.startsWith("/admin/hr/resources")) return "hr.fleet"
  if (pathname.startsWith("/admin/hr")) return "hr.main"
  if (pathname.startsWith("/admin/inventory")) return "inventory.main"
  if (pathname.startsWith("/admin/job-descriptions")) return "jobdescriptions.main"
  if (pathname.startsWith("/admin/notifications")) return "notifications.main"
  if (pathname.startsWith("/admin/purchasing")) return "purchasing.main"
  if (pathname.startsWith("/admin/security/bypass-override")) return "security.bypassOverride"
  if (pathname.startsWith("/admin/security/network-activity")) return "security.networkActivity"
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
    case "security.networkActivity":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: null }
    case "security.bypassOverride":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: null }
    case "communications.meetings":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "communications" }
    case "payroll.main":
      // Salary data spans the whole org and the pages already require isAdminLike,
      // so department leads never see it — adminOnly matches the runtime guard.
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "finance" }
    case "hr.fleet":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "hr" }
    case "hr.resources":
      return { visibility: "none", mutations: "none", adminOnly: true, domain: "hr" }
    case "hr.pms.cbt.manage":
      // Department leads set their own team's CBT from /dept/[id]/hr/pms/cbt —
      // they own the assessment for their department, so this is dept-scoped
      // rather than admin-only. Global admins still reach it via PMS/HR grants.
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "hr" }
    case "hr.pms":
    case "hr.leave":
    case "hr.attendance":
      return { visibility: "dept", mutations: "dept", adminOnly: false, domain: "hr" }
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

function adminHasRoute(context: AccessContextV2, route: AdminRouteKeyV2): boolean {
  if (context.baseRole === "developer" || context.baseRole === "super_admin") return true
  if (context.baseRole !== "admin") return false
  return Array.isArray(context.adminRoutes) && context.adminRoutes.includes(route)
}

function isDepartmentManaged(context: AccessContextV2, department: string) {
  const normalizedDepartment = normalizeDepartmentName(department)
  return context.managedDepartments.includes(normalizedDepartment)
}

export function canAccessRouteV2(context: AccessContextV2, route: AdminRouteKeyV2): boolean {
  const policy = getRoutePolicyV2(route)
  const isGlobalAdminContext = context.actingContext === "global_admin" && context.isAdminLike

  if (isGlobalAdminContext) {
    // Dev tooling is developer-only (matches canAccessAdminSection). super_admin
    // and admin never see /admin/dev, regardless of granted routes.
    if (route === "dev.main") {
      return context.baseRole === "developer"
    }
    // Dashboard is always accessible to any admin-like role
    if (route === "admin.dashboard") return true
    // Leave, Attendance, Resource Booking (Fleet/Resources) and PMS are grantable
    // on their own, but full "Employees & HR" (hr.main) also includes them — so
    // admins who already had HR keep access (no lockout). CBT folds into PMS.
    if (route === "hr.leave") {
      return adminHasRoute(context, "hr.leave") || adminHasRoute(context, "hr.main")
    }
    if (route === "hr.attendance") {
      return adminHasRoute(context, "hr.attendance") || adminHasRoute(context, "hr.main")
    }
    if (route === "hr.fleet" || route === "hr.resources") {
      return (
        adminHasRoute(context, "hr.fleet") ||
        adminHasRoute(context, "hr.resources") ||
        adminHasRoute(context, "hr.main")
      )
    }
    if (route === "hr.pms") {
      return adminHasRoute(context, "hr.pms") || adminHasRoute(context, "hr.main")
    }
    // Payroll moved out of HR into Accounts and gained its own key. Admins who
    // already held full HR keep access so the split is not a lockout.
    if (route === "payroll.main") {
      return adminHasRoute(context, "payroll.main") || adminHasRoute(context, "hr.main")
    }
    if (route === "hr.pms.cbt.manage") {
      // CBT is part of PMS now — granting PMS (or full HR) covers it.
      return (
        adminHasRoute(context, "hr.pms.cbt.manage") ||
        adminHasRoute(context, "hr.pms") ||
        adminHasRoute(context, "hr.main")
      )
    }
    // Everything else — including Settings and Audit Logs — is assignment-driven:
    //   - developer / super_admin: full access (adminHasRoute returns true)
    //   - admin: only routes explicitly granted to them (admin_routes)
    // i.e. an admin is a super_admin scoped to their assigned routes.
    return adminHasRoute(context, route)
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
    // reports.other has mutations:"none" in policy but admin access implies write access
    if (route === "reports.other") return true
    return policy.mutations !== "none"
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
