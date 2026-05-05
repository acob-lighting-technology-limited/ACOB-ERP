import type { EmploymentStatus } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export interface AssignableProfileLite {
  id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  department?: string | null
  employment_status?: EmploymentStatus | string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

export interface AssignablePolicyOptions {
  allowLegacyNullStatus?: boolean
  requiredDepartment?: string | null
}

export interface AssignableQueryOptions extends AssignablePolicyOptions {
  select?: string
  orderBy?: "first_name" | "last_name" | "full_name"
  departmentScope?: string[] | null
  leadOnly?: boolean
  excludeUserId?: string
}

interface AssignableStatusQuery<TSelf> {
  eq(column: string, value: string | boolean): TSelf
  ilike(column: string, value: string): TSelf
  or(filters: string): TSelf
}

type DepartmentLookupRow = {
  id: string
}

const ASSIGNABLE_SELECT =
  "id, first_name, last_name, full_name, company_email, department, employment_status, is_department_lead, lead_departments"

export function isAssignableEmploymentStatus(
  status: EmploymentStatus | string | null | undefined,
  options: AssignablePolicyOptions = {}
): boolean {
  if (typeof status === "string" && status.toLowerCase() === "active") return true
  if (options.allowLegacyNullStatus === false) return false
  return status == null
}

export function isAssignableProfile(
  profile: Pick<AssignableProfileLite, "employment_status" | "department">,
  options: AssignablePolicyOptions = {}
): boolean {
  if (!isAssignableEmploymentStatus(profile.employment_status, options)) return false
  if (options.requiredDepartment && profile.department !== options.requiredDepartment) return false
  return true
}

export function getUnassignableReason(
  profile: Pick<AssignableProfileLite, "employment_status" | "department">,
  options: AssignablePolicyOptions = {}
): string | null {
  if (!isAssignableEmploymentStatus(profile.employment_status, options)) {
    return "Selected assignee is not active"
  }
  if (options.requiredDepartment && profile.department !== options.requiredDepartment) {
    return "Selected assignee must belong to the service department"
  }
  return null
}

export function applyAssignableStatusFilter<TQuery extends AssignableStatusQuery<TQuery>>(
  query: TQuery,
  options: AssignablePolicyOptions = {}
) {
  if (options.allowLegacyNullStatus === false) {
    return query.eq("employment_status", "active")
  }
  return query.or("employment_status.eq.active,employment_status.is.null")
}

export async function buildAssignableProfilesQuery(
  client: SupabaseClient<Database>,
  options: AssignableQueryOptions = {}
) {
  let query = client
    .from("profiles")
    .select(options.select || ASSIGNABLE_SELECT)
    .order(options.orderBy || "last_name", { ascending: true })

  query = applyAssignableStatusFilter(query, options)

  if (options.departmentScope) {
    if (options.departmentScope.length > 0) {
      // Look up department IDs from names for FK filter
      const { data: depts } = await client.from("departments").select("id").in("name", options.departmentScope)
      const departmentIds = ((depts as DepartmentLookupRow[] | null) || []).map((department) => department.id)

      query =
        departmentIds.length > 0
          ? query.in("department_id", departmentIds)
          : query.in("department", options.departmentScope) // fallback to text filter
    } else {
      query = query.eq("id", "__none__")
    }
  }

  if (options.requiredDepartment) {
    // Look up department ID from name for FK filter
    const { data: dept } = await client
      .from("departments")
      .select("id")
      .eq("name", options.requiredDepartment)
      .single<DepartmentLookupRow>()

    query = dept?.id ? query.eq("department_id", dept.id) : query.eq("department", options.requiredDepartment) // fallback to text filter
  }

  if (options.leadOnly) {
    query = query.eq("is_department_lead", true)
  }

  if (options.excludeUserId) {
    query = query.neq("id", options.excludeUserId)
  }

  return query
}

export async function listAssignableProfiles(client: SupabaseClient<Database>, options: AssignableQueryOptions = {}) {
  const query = await buildAssignableProfilesQuery(client, options)
  const { data, error } = await query
  if (error) return { data: [] as AssignableProfileLite[], error }
  const rows = (data || []) as AssignableProfileLite[]
  return {
    data: rows.filter((profile) => isAssignableProfile(profile, options)),
    error: null,
  }
}
