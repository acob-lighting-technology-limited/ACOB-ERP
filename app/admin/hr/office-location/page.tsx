import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { normalizeDepartmentName } from "@/shared/departments"
import { logger } from "@/lib/logger"
import { OfficeLocationsPage, type OfficeLocationsData } from "./view"

const log = logger("office-location-page")

async function getInitialData(): Promise<OfficeLocationsData | undefined> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return undefined

    const scope = await resolveAdminScope(supabase, user.id)

    const canManageLocations = Boolean(scope?.isAdminLike && scope.scopeMode !== "lead")
    const scopeMode = scope?.scopeMode ?? "global"
    const managedDepartments: string[] = scope?.managedDepartments ?? []

    const [{ data: locations, error: locError }, { data: departments }, { data: profiles }] = await Promise.all([
      supabase.from("office_locations").select("*").order("name"),
      supabase.from("departments").select("name").eq("is_active", true).order("name"),
      supabase
        .from("profiles")
        .select(
          "id, first_name, last_name, company_email, additional_email, designation, office_location, employment_status"
        ),
    ])

    if (locError) {
      log.error({ err: locError }, "Failed to fetch office locations")
      return undefined
    }

    // Build employee map by location
    const byLocation: Record<string, { id: string; first_name: string | null; last_name: string | null; company_email: string | null; additional_email: string | null; designation: string | null; office_location: string | null; employment_status?: string | null }[]> = {}
    for (const p of profiles ?? []) {
      if (!isAssignableEmploymentStatus(p.employment_status, { allowLegacyNullStatus: false })) continue
      const locName = (p.office_location as string | null)?.trim() || "Unassigned"
      if (!byLocation[locName]) byLocation[locName] = []
      byLocation[locName].push(p as typeof byLocation[string][number])
    }

    // Apply dept-scope filtering for leads
    const scopedDeptSet = new Set(
      managedDepartments.map((d) => normalizeDepartmentName(d)).filter(Boolean)
    )
    const shouldScope = scopeMode === "lead" && scopedDeptSet.size > 0

    const locationsWithCounts = (locations ?? [])
      .filter((loc) => {
        if (!shouldScope) return true
        return scopedDeptSet.has(normalizeDepartmentName(String(loc.department || "")))
      })
      .map((loc) => ({
        ...loc,
        employee_count: byLocation[loc.name]?.length || 0,
      }))

    const filteredDepts = shouldScope
      ? (departments ?? []).filter((d) => scopedDeptSet.has(normalizeDepartmentName(d.name)))
      : (departments ?? [])

    return {
      locations: locationsWithCounts,
      locationEmployees: byLocation as OfficeLocationsData["locationEmployees"],
      canManageLocations,
      departments: filteredDepts.map((d) => d.name),
    }
  } catch (err) {
    log.error({ err }, "Unexpected error fetching initial office locations data")
    return undefined
  }
}

export default async function OfficeLocationsPageRoute() {
  const initialData = await getInitialData()
  return <OfficeLocationsPage initialData={initialData} />
}
