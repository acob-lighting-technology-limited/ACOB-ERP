import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CorrespondenceRecord, CorrespondenceStatus } from "@/types/correspondence"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"

/** Minimal profile shape used across correspondence access-control helpers */
interface ProfileLike {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
  managed_departments?: string[] | null
}

export const CORRESPONDENCE_STATUSES: CorrespondenceStatus[] = [
  "draft",
  "under_review",
  "approved",
  "rejected",
  "returned_for_correction",
  "sent",
  "filed",
  "assigned_action_pending",
  "open",
  "closed",
  "cancelled",
]

export function isAdminRole(role?: string | null): boolean {
  return role === "developer" || role === "admin" || role === "super_admin"
}

export async function getAuthContext() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, user: null, profile: null }

  const [{ data: scopedProfile }, scope] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, role, department, lead_departments, is_department_lead, first_name, last_name, full_name, designation"
      )
      .eq("id", user.id)
      .single(),
    resolveAdminScope(supabase as unknown as SupabaseClient, user.id),
  ])
  const { data: fallbackProfile } = scopedProfile
    ? { data: null }
    : await dataClient
        .from("profiles")
        .select(
          "id, role, department, lead_departments, is_department_lead, first_name, last_name, full_name, designation"
        )
        .eq("id", user.id)
        .single()

  const profile = scopedProfile ?? fallbackProfile ?? null

  const managedDepartments = scope?.managedDepartments ?? []

  return {
    supabase,
    user,
    profile: profile
      ? {
          ...profile,
          managed_departments: managedDepartments,
        }
      : null,
  }
}

/**
 * Department-membership check ONLY — no admin bypass.
 * Callers that want to allow global admins must OR this with their own
 * `isGlobalAdmin` check (derived from `getRequestScope()` + `scopeMode`).
 * This separation lets lead-mode admins be restricted the same as leads.
 */
export function canAccessDepartment(profile: ProfileLike | null | undefined, department?: string | null): boolean {
  if (!department) return false
  if (!profile?.is_department_lead) return false

  const managedDepartments = Array.isArray(profile?.managed_departments)
    ? profile.managed_departments
    : Array.isArray(profile?.lead_departments)
      ? profile.lead_departments
      : []

  const canonicalTarget = normalizeDepartmentName(department)
  const targetAliases = new Set(getDepartmentAliases(canonicalTarget).map((item) => normalizeDepartmentName(item)))
  const normalizedManaged = managedDepartments.map((item) => normalizeDepartmentName(String(item || "")))
  const normalizedPrimary = profile?.department ? normalizeDepartmentName(profile.department) : ""

  return normalizedManaged.some((dept) => targetAliases.has(dept)) || targetAliases.has(normalizedPrimary)
}

/**
 * Per-record access check — no admin bypass.
 * Callers that want to allow global admins must OR this with their own
 * `isGlobalAdmin` check.
 */
export function canAccessRecord(
  profile: ProfileLike | null | undefined,
  userId: string,
  record: Partial<CorrespondenceRecord>
): boolean {
  if (record.originator_id === userId) return true
  if (record.responsible_officer_id === userId) return true

  return (
    canAccessDepartment(profile, record.department_name ?? null) ||
    canAccessDepartment(profile, record.assigned_department_name ?? null)
  )
}

export async function appendCorrespondenceEvent(params: {
  correspondenceId: string
  actorId: string
  eventType: string
  oldStatus?: string | null
  newStatus?: string | null
  details?: Record<string, unknown>
}) {
  const supabase = await createClient()
  await supabase.from("correspondence_events").insert({
    correspondence_id: params.correspondenceId,
    actor_id: params.actorId,
    event_type: params.eventType,
    old_status: params.oldStatus ?? null,
    new_status: params.newStatus ?? null,
    details: params.details ?? null,
  })
}

export async function appendCorrespondenceAuditLog(params: {
  actorId: string
  action: string
  recordId: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  department?: string | null
  route?: string
  critical?: boolean
}) {
  const supabase = await createClient()
  await writeAuditLog(
    supabase as unknown as SupabaseClient,
    {
      action: params.action,
      entityType: "correspondence_record",
      entityId: params.recordId,
      oldValues: params.oldValues ?? null,
      newValues: params.newValues ?? null,
      context: {
        actorId: params.actorId,
        department: params.department ?? null,
        source: "api",
        route: params.route ?? "/api/correspondence",
      },
    },
    {
      critical: params.critical,
    }
  )
}

export async function getDepartmentCodeByName(departmentName: string): Promise<string | null> {
  const requestedName = String(departmentName || "").trim()
  const normalizedRequested = normalizeDepartmentName(requestedName)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await dataClient
    .from("departments")
    .select("name, department_code")
    .eq("is_active", true)
    .not("department_code", "is", null)

  if (error || !data) return null

  const exact = data.find((item) => item.name === requestedName)
  if (exact?.department_code) return exact.department_code

  const normalizedMatch = data.find((item) => normalizeDepartmentName(String(item.name || "")) === normalizedRequested)
  return normalizedMatch?.department_code || null
}

/**
 * Returns the current name of the executive management department by looking up
 * the department with code "EXEC" in the departments table. Falls back to the
 * legacy string if no department with that code exists.
 */
export async function getExecutiveDepartmentName(): Promise<string> {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data } = await dataClient
    .from("departments")
    .select("name")
    .eq("is_executive_dept", true)
    .eq("is_active", true)
    .maybeSingle()

  return data?.name ?? "Executive Management"
}
