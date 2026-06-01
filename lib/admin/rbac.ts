import type { SupabaseClient } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  normalizeDepartmentName as normalizeCanonicalDepartmentName,
  normalizeDepartmentList as normalizeCanonicalDepartmentList,
  getDepartmentAliases,
} from "@/shared/departments"
import { GRANTABLE_ADMIN_ROUTES, type AdminRouteKeyV2 } from "@/lib/admin/policy-v2"

export type AdminRole = "developer" | "super_admin" | "admin" | "employee" | "visitor" | string
export type AdminDomain = "hr" | "finance" | "assets" | "reports" | "tasks" | "projects" | "communications"
export type AdminScopeMode = "global" | "lead"
export type AdminSection =
  | "dev"
  | "assets"
  | "audit-logs"
  | "documentation"
  | "employees"
  | "feedback"
  | "finance"
  | "hr"
  | "inventory"
  | "job-descriptions"
  | "notification"
  | "onedrive"
  | "payments"
  | "projects"
  | "purchasing"
  | "reports"
  | "settings"
  | "tasks"
  | "admin"

export interface AdminScope {
  userId: string
  role: AdminRole
  department: string | null
  departmentId: string | null
  officeLocation: string | null
  isDepartmentLead: boolean
  leadDepartments: string[]
  managedDepartments: string[]
  managedDepartmentIds: string[]
  managedOffices: string[]
  isAdminLike: boolean
  adminRoutes: AdminRouteKeyV2[] | null
  scopeMode: AdminScopeMode
}

interface ProfileShape {
  role: AdminRole | null
  department: string | null
  department_id: string | null
  office_location: string | null
  admin_routes: string[] | null
  is_department_lead: boolean
  lead_departments: string[] | null
}

interface DepartmentRow {
  id: string
  name: string
}

/** Section → representative route keys used for section-level access checks. */
const SECTION_TO_ROUTES: Partial<Record<AdminSection, AdminRouteKeyV2[]>> = {
  dev: ["dev.main"],
  assets: ["assets.main", "assets.issues"],
  "audit-logs": ["auditlogs.main"],
  documentation: ["documentation.main"],
  employees: ["hr.main"],
  feedback: ["feedback.main"],
  finance: ["finance.main"],
  hr: ["hr.main"],
  inventory: ["inventory.main"],
  "job-descriptions": ["jobdescriptions.main"],
  notification: ["notifications.main"],
  onedrive: [],
  payments: ["finance.main"],
  projects: [],
  purchasing: ["purchasing.main"],
  reports: ["reports.weekly", "reports.other"],
  settings: ["settings.main"],
  tasks: ["tasks.main"],
  admin: [],
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  )
}

/**
 * Canonical department name normaliser.
 * Maps legacy "Finance" label → "Accounts" to match the DB value.
 * Single source of truth — import from here, do not copy locally.
 */
export function normalizeDepartmentName(value: string): string {
  return normalizeCanonicalDepartmentName(value)
}

export function normalizeDepartmentList(values: string[]): string[] {
  return unique(normalizeCanonicalDepartmentList(values))
}

export function isAdminLikeRole(role: string | null | undefined): boolean {
  const normalized = normalizeRoleValue(role)
  return normalized === "developer" || normalized === "admin" || normalized === "super_admin"
}

/**
 * Returns true when the role alone gives access to the /admin shell.
 *
 * Department leads are NO LONGER granted access via this gate — they have
 * their own /dept/[dept_id]/ surface. Admin users who are also dept leads
 * still enter /admin and can use the scope-toggle ribbon there.
 *
 * The `isDepartmentLead` parameter is retained for backwards-compatibility
 * with existing call-sites that pass it; it is intentionally unused here.
 */
export function roleCanEnterAdmin(role: string | null | undefined, isDepartmentLead = false): boolean {
  void isDepartmentLead // param kept for call-site compat — no longer used
  const normalized = normalizeRoleValue(role)
  return normalized === "developer" || normalized === "super_admin" || normalized === "admin"
}

export function canAccessAdminSection(scope: AdminScope, section: AdminSection): boolean {
  const role = normalizeRoleValue(scope.role)
  if (section === "dev") return role === "developer"
  if (role === "developer" || role === "super_admin") return true
  if (role === "admin") {
    if (section === "admin") return true
    const routes = Array.isArray(scope.adminRoutes) ? scope.adminRoutes : []
    const sectionRoutes = SECTION_TO_ROUTES[section] ?? []
    return sectionRoutes.some((route) => routes.includes(route))
  }
  // Pure department leads can no longer reach /admin (roleCanEnterAdmin no longer
  // passes them through). This branch only fires for admin+lead users in "lead"
  // scope mode — they retain access to all sections while scoped to their dept.
  if (!scope.isDepartmentLead) return false
  return true
}

function scopeDepartments(profile: ProfileShape): string[] {
  const leadDepartments = normalizeDepartmentList(
    Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  )
  if (leadDepartments.length > 0) return leadDepartments
  if (profile.department) return normalizeDepartmentList([profile.department])
  return []
}

export function scopeDepartmentIds(profile: ProfileShape, departmentIdsByName: Map<string, string>): string[] {
  const ids = new Set<string>()
  const scopedDepartments = scopeDepartments(profile)

  for (const departmentName of scopedDepartments) {
    const normalizedName = normalizeDepartmentName(departmentName)
    const departmentId = departmentIdsByName.get(normalizedName)
    if (departmentId) ids.add(departmentId)
  }

  if (profile.department_id) ids.add(profile.department_id)

  return Array.from(ids)
}

function normalizeRoleValue(role: string | null | undefined): string | null {
  if (!role) return null
  const normalized = role.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function normalizeAdminRoutes(routes: string[] | null | undefined): AdminRouteKeyV2[] | null {
  if (!Array.isArray(routes)) return null
  const normalized = Array.from(
    new Set(
      routes
        .map((v) =>
          String(v || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).filter((value): value is AdminRouteKeyV2 => GRANTABLE_ADMIN_ROUTES.includes(value as AdminRouteKeyV2))
  return normalized.length > 0 ? normalized : []
}

async function resolveManagedOffices(
  supabase: SupabaseClient,
  managedDepartments: string[],
  ownOffice: string | null
): Promise<string[]> {
  const offices = new Set<string>()
  if (ownOffice) offices.add(ownOffice)

  if (managedDepartments.length > 0) {
    // TODO: migrate office_locations.department text filter to department_id FK
    const { data } = await supabase.from("office_locations").select("name").in("department", managedDepartments)

    for (const row of data || []) {
      if (row?.name) offices.add(row.name)
    }
  }

  return Array.from(offices)
}

export async function resolveAdminScope(supabase: SupabaseClient, userId: string): Promise<AdminScope | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, department_id, office_location, admin_routes, is_department_lead, lead_departments")
    .eq("id", userId)
    .single<ProfileShape>()

  if (!profile) return null

  const normalizedRole = normalizeRoleValue(profile?.role)
  if (!normalizedRole || !roleCanEnterAdmin(normalizedRole, profile.is_department_lead)) return null

  const isAdminLike = isAdminLikeRole(normalizedRole)
  const leadScopedDepartments = scopeDepartments(profile)
  void leadScopedDepartments
  // scopeMode is always "global" for admin users — the lead toggle has been removed.
  // Dept leads use their own /dept/[id]/ shell instead.
  const scopeMode: AdminScopeMode = "global"
  const managedDepartments: string[] = []
  const departmentNamesForLookup = Array.from(
    new Set([
      ...managedDepartments.map((departmentName) => normalizeDepartmentName(departmentName)),
      ...(profile.department ? [normalizeDepartmentName(profile.department)] : []),
    ])
  )
  const departmentIdsByName = new Map<string, string>()

  if (departmentNamesForLookup.length > 0) {
    const { data: departments } = await supabase
      .from("departments")
      .select("id, name")
      .in("name", departmentNamesForLookup)

    for (const department of (departments || []) as DepartmentRow[]) {
      if (department.name) {
        departmentIdsByName.set(normalizeDepartmentName(department.name), department.id)
      }
    }
  }

  const managedDepartmentIds = managedDepartments.length > 0 ? scopeDepartmentIds(profile, departmentIdsByName) : []
  const managedOffices =
    managedDepartments.length > 0
      ? await resolveManagedOffices(supabase, managedDepartments, profile.office_location ?? null)
      : []

  const isDepartmentLead = Boolean(profile.is_department_lead)
  const adminRoutes = normalizeAdminRoutes(profile.admin_routes)
  if (normalizedRole === "admin" && (!adminRoutes || adminRoutes.length === 0) && !isDepartmentLead) {
    return null
  }

  return {
    userId,
    role: normalizedRole,
    department: profile.department ?? null,
    departmentId: profile.department_id ?? null,
    officeLocation: profile.office_location ?? null,
    isDepartmentLead,
    leadDepartments: Array.isArray(profile.lead_departments) ? profile.lead_departments : [],
    managedDepartments,
    managedDepartmentIds,
    managedOffices,
    isAdminLike,
    adminRoutes,
    scopeMode,
  }
}

export function getDepartmentScope(scope: AdminScope, domain: "finance" | "hr" | "general"): string[] | null {
  if (scope.scopeMode === "lead") {
    return scope.managedDepartments
  }
  const role = normalizeRoleValue(scope.role)
  if (role === "developer" || role === "super_admin") return null
  if (role === "admin") {
    const routes = Array.isArray(scope.adminRoutes) ? scope.adminRoutes : []
    if (domain === "general" && routes.length > 0) return null
    const routeForDomain = domain === "hr" ? "hr.main" : domain === "finance" ? "finance.main" : null
    if (routeForDomain && routes.includes(routeForDomain)) return null
  }
  if (!scope.isDepartmentLead) return []
  return scope.managedDepartments
}

export function expandDepartmentScopeForQuery(departments: string[]): string[] {
  const expanded = departments.flatMap((departmentName) => getDepartmentAliases(departmentName))
  return Array.from(new Set(expanded.filter(Boolean)))
}

export async function requireAdminSectionAccess(section: AdminSection): Promise<AdminScope> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect("/auth/login")

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) redirect("/profile")
  if (!canAccessAdminSection(scope, section)) redirect("/admin")

  return scope
}
