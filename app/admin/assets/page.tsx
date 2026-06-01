import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AdminAssetsContent, type Asset, type Employee, type UserProfile } from "./admin-assets-content"
import { getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"

import { logger } from "@/lib/logger"

const log = logger("assets")

type AdminAssetsPageClient = Awaited<ReturnType<typeof createClient>>

type AssetAssignmentRow = {
  asset_id: string
  assigned_to?: string | null
  department?: string | null
  office_location?: string | null
  assignment_type?: string | null
}

type AssetIssueRow = {
  asset_id: string
  resolved?: boolean | null
}

type AssignmentUserRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  department?: string | null
}

async function getAdminAssetsData() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const scope = await resolveAdminScope(supabase as AdminAssetsPageClient, user.id)
  if (!scope) {
    return { redirect: "/profile" as const }
  }

  const userProfile: UserProfile = {
    role: scope.role,
    admin_routes: scope.adminRoutes,
    is_department_lead: scope.isDepartmentLead,
    lead_departments: scope.leadDepartments,
    managed_departments: scope.managedDepartments,
    managed_offices: scope.managedOffices,
  }
  const departmentScope = getDepartmentScope(scope, "general")

  const dataClient = getServiceRoleClientOrFallback(supabase as AdminAssetsPageClient)

  // Fetch assets
  let { data: assetsData, error: assetsError } = await dataClient
    .from("assets")
    .select("*")
    .order("created_at", { ascending: false })

  if (assetsError && dataClient !== supabase) {
    // Fall back to user-scoped client if service-role query fails due env/config drift.
    const fallback = await supabase.from("assets").select("*").order("created_at", { ascending: false })
    assetsData = fallback.data
    assetsError = fallback.error
  }

  if (assetsError) {
    log.error("Error loading assets:", assetsError)
    return { assets: [], employees: [], departments: [], userProfile, loadError: "Failed to load admin assets" }
  }

  // Fetch current assignments for all assets
  const { data: assignmentsData } = await dataClient
    .from("asset_assignments")
    .select("asset_id, assigned_to, department, office_location, assignment_type")
    .eq("is_current", true)

  // Fetch user details for assignments
  const assignedUserIds = ((assignmentsData || []) as AssetAssignmentRow[]).map((a) => a.assigned_to).filter(Boolean)

  let assignmentUsersMap = new Map<string, AssignmentUserRow>()
  if (assignedUserIds.length > 0) {
    const { data: usersData } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, department")
      .in("id", assignedUserIds)

    assignmentUsersMap = new Map(usersData?.map((u) => [u.id, u]))
  }

  // Fetch employees - leads can only see employees in their departments
  const { data: employeeData } = await listAssignableProfiles(dataClient, {
    select: "id, first_name, last_name, company_email, department, employment_status",
    departmentScope,
    allowLegacyNullStatus: false,
  })
  const employees = (employeeData || []) as Employee[]

  // Fetch unresolved issue counts
  const { data: issuesData } = await dataClient.from("asset_issues").select("asset_id, resolved")

  const issueCountsByAsset: Record<string, number> = {}
  ;((issuesData || []) as AssetIssueRow[]).forEach((issue) => {
    if (!issue.resolved) {
      issueCountsByAsset[issue.asset_id] = (issueCountsByAsset[issue.asset_id] || 0) + 1
    }
  })

  // Filter assets for leads
  let filteredAssets = assetsData || []
  if (departmentScope) {
    const deptUserIds = employees.map((s) => s.id)
    filteredAssets = filteredAssets.filter((asset) => {
      const assignment = ((assignmentsData || []) as AssetAssignmentRow[]).find((a) => a.asset_id === asset.id)
      if (!assignment) return false

      if (assignment.assigned_to && deptUserIds.includes(assignment.assigned_to)) return true
      if (assignment.department && departmentScope.includes(assignment.department)) return true
      if (assignment.office_location && scope.managedOffices.includes(assignment.office_location)) return true
      return false
    })
  }

  // Combine assets with assignments and issue counts
  const assets: Asset[] = filteredAssets.map((asset) => {
    const assignment = ((assignmentsData || []) as AssetAssignmentRow[]).find((a) => a.asset_id === asset.id)
    return {
      ...asset,
      current_assignment: assignment
        ? {
            assigned_to: assignment.assigned_to,
            department: assignment.department,
            office_location: assignment.office_location,
            assignment_type: assignment.assignment_type,
            user: assignment.assigned_to ? assignmentUsersMap.get(assignment.assigned_to) : null,
          }
        : undefined,
      unresolved_issues_count: issueCountsByAsset[asset.id] || 0,
    }
  })

  // Get departments list
  const departments = departmentScope
    ? departmentScope
    : Array.from(new Set(employees.map((s) => s.department).filter(Boolean)))

  return { assets, employees, departments, userProfile, loadError: null }
}

export default async function AdminAssetsPage() {
  const data = await getAdminAssetsData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const pageData = data as {
    assets: Asset[]
    employees: Employee[]
    departments: string[]
    userProfile: UserProfile
    loadError?: string | null
  }

  return (
    <AdminAssetsContent
      initialAssets={pageData.assets}
      initialEmployees={pageData.employees}
      initialDepartments={pageData.departments}
      userProfile={pageData.userProfile}
      initialError={pageData.loadError}
    />
  )
}
