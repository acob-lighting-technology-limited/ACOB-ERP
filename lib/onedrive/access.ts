import type { SupabaseClient } from "@supabase/supabase-js"
import { isAdminLikeRole } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"

interface OneDriveProfile {
  role: string | null
  department: string | null
  is_department_lead: boolean | null
  lead_departments: string[] | null
}

const explicitDepartmentMappings: Record<string, string> = {
  accounts: "accounts",
  "admin and hr": "admin-hr",
  "admin & hr": "admin-hr",
  "business, growth and innovation": "business-growth-innovation",
  "corporate services": "corporate-services",
  "demo operations": "demo-operations",
  "executive management": "executive-management",
  "it and communications": "it-communications",
  logistics: "logistics",
  "monitoring and evaluation": "monitoring-evaluation",
  "operations and maintenance": "operations-maintenance",
  project: "project",
  "regulatory and compliance": "regulatory-compliance",
  technical: "technical",
}

const explicitLibraryMappings = Object.fromEntries(
  Object.entries(explicitDepartmentMappings).map(([department, key]) => [key, department])
)

export function departmentToLibraryKey(department: string): string {
  const normalizedDepartment = department.trim().toLowerCase()
  return (
    explicitDepartmentMappings[normalizedDepartment] ??
    normalizedDepartment.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  )
}

export function libraryKeyToDepartment(libraryKey: string): string {
  const normalizedKey = libraryKey.trim().toLowerCase()
  const explicitDepartment = explicitLibraryMappings[normalizedKey]
  if (explicitDepartment) {
    return explicitDepartment
      .split(" ")
      .map((part) => (part === "&" ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join(" ")
  }

  return normalizedKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function getDepartmentContextFromPath(path: string): { departmentKey: string; departmentName: string } | null {
  const normalizedPath = normalizePath(path)
  const [departmentKey] = normalizedPath.split("/").filter(Boolean)

  if (!departmentKey) return null

  return {
    departmentKey,
    departmentName: libraryKeyToDepartment(departmentKey),
  }
}

export interface OneDriveAccessScope {
  isAdminLike: boolean
  managedDepartments: string[]
  allowedPrefixes: string[]
  defaultPath: string
  rootLabel: string
}

interface ResolveOneDriveAccessScopeOptions {
  allowAdminLike?: boolean
  allowManagedDepartments?: boolean
}

function normalizePath(path: string): string {
  const normalized = `/${path || ""}`.replace(/\/+/g, "/")
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

function uniqueDepartments(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)))
}

export async function resolveOneDriveAccessScope(
  supabase: SupabaseClient,
  userId: string,
  options: ResolveOneDriveAccessScopeOptions = {}
): Promise<OneDriveAccessScope | null> {
  const { allowAdminLike = true, allowManagedDepartments = true } = options
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, is_department_lead, lead_departments")
    .eq("id", userId)
    .single<OneDriveProfile>()

  if (!profile) return null

  if (allowAdminLike && isAdminLikeRole(profile.role)) {
    return {
      isAdminLike: true,
      managedDepartments: [],
      allowedPrefixes: ["/"],
      defaultPath: "/",
      rootLabel: "Department Libraries",
    }
  }

  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  const managedDepartments =
    allowManagedDepartments && profile.is_department_lead
      ? uniqueDepartments([...leadDepartments, profile.department])
      : uniqueDepartments([profile.department])

  if (managedDepartments.length === 0) return null

  const allowedPrefixes = managedDepartments.map((dept) => normalizePath(`/${departmentToLibraryKey(dept)}`))
  const defaultDepartment = managedDepartments[0]

  return {
    isAdminLike: false,
    managedDepartments,
    allowedPrefixes,
    defaultPath: normalizePath(`/${departmentToLibraryKey(defaultDepartment)}`),
    rootLabel: defaultDepartment,
  }
}

export async function resolveOneDriveDepartmentAccessScope(
  supabase: SupabaseClient,
  userId: string,
  department: string
): Promise<OneDriveAccessScope | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, is_department_lead, lead_departments")
    .eq("id", userId)
    .single<OneDriveProfile>()

  if (!profile?.is_department_lead) return null

  const requestedDepartment = normalizeDepartmentName(department)
  const ledDepartments = uniqueDepartments([...(profile.lead_departments || []), profile.department]).map(
    normalizeDepartmentName
  )
  if (!ledDepartments.includes(requestedDepartment)) return null

  const prefix = normalizePath(`/${departmentToLibraryKey(requestedDepartment)}`)
  return {
    isAdminLike: false,
    managedDepartments: [requestedDepartment],
    allowedPrefixes: [prefix],
    defaultPath: prefix,
    rootLabel: requestedDepartment,
  }
}

export function isPathAllowed(path: string, scope: OneDriveAccessScope): boolean {
  const normalizedPath = normalizePath(path)
  if (scope.isAdminLike) return true
  return scope.allowedPrefixes.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))
}
