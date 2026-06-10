import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"
import {
  AdminAssetsContent,
  type Asset,
  type Employee,
  type UserProfile,
} from "@/app/admin/assets/admin-assets-content"

type AssetAssignmentRow = {
  asset_id: string
  assigned_to?: string | null
  department?: string | null
  office_location?: string | null
  assignment_type?: string | null
}
type AssetIssueRow = { asset_id: string; resolved?: boolean | null }
type AssignmentUserRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  department?: string | null
}

interface DeptAssetsPageProps {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAssetsPage({ params }: DeptAssetsPageProps) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepartments = expandDepartmentScopeForQuery([deptName])
  const { data: officeRows } = await dataClient
    .from("office_locations")
    .select("name")
    .in("department", expandedDepartments)
  const managedOffices = (officeRows || []).map((office) => office.name).filter(Boolean)

  const userProfile: UserProfile = {
    role: scope.role,
    admin_routes: [],
    is_department_lead: true,
    lead_departments: [scope.deptName],
    managed_departments: [deptName],
    managed_offices: managedOffices,
  }

  const { data: employeeData } = await listAssignableProfiles(dataClient, {
    select: "id, first_name, last_name, company_email, department, employment_status",
    departmentScope: [deptName],
    allowLegacyNullStatus: false,
  })
  const employees = (employeeData || []) as Employee[]
  const deptUserIds = employees.map((e) => e.id)

  const [{ data: assetsData }, { data: assignmentsData }, { data: issuesData }] = await Promise.all([
    dataClient.from("assets").select("*").order("created_at", { ascending: false }),
    dataClient
      .from("asset_assignments")
      .select("asset_id, assigned_to, department, office_location, assignment_type")
      .eq("is_current", true),
    dataClient.from("asset_issues").select("asset_id, resolved"),
  ])

  const assignedUserIds = ((assignmentsData || []) as AssetAssignmentRow[])
    .map((a) => a.assigned_to)
    .filter(Boolean) as string[]
  let assignmentUsersMap = new Map<string, AssignmentUserRow>()
  if (assignedUserIds.length > 0) {
    const { data: usersData } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, department")
      .in("id", assignedUserIds)
    assignmentUsersMap = new Map(usersData?.map((u) => [u.id, u]))
  }

  const issueCountsByAsset: Record<string, number> = {}
  ;((issuesData || []) as AssetIssueRow[]).forEach((issue) => {
    if (!issue.resolved) issueCountsByAsset[issue.asset_id] = (issueCountsByAsset[issue.asset_id] || 0) + 1
  })

  // Filter to dept assets only
  const filteredAssets = (assetsData || []).filter((asset) => {
    const assignment = ((assignmentsData || []) as AssetAssignmentRow[]).find((a) => a.asset_id === asset.id)
    if (!assignment) return false
    if (assignment.assigned_to && deptUserIds.includes(assignment.assigned_to)) return true
    if (assignment.department && normalizeDepartmentName(assignment.department) === deptName) return true
    if (assignment.office_location && managedOffices.includes(assignment.office_location)) return true
    return false
  })

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

  return (
    <AdminAssetsContent
      initialAssets={assets}
      initialEmployees={employees}
      initialDepartments={[deptName]}
      userProfile={userProfile}
      initialError={null}
      lockedDepartment={scope.deptName}
    />
  )
}
