import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"
import { getPaginationRange, paginatedResponse, PaginationSchema } from "@/lib/pagination"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"

type AdminAssetsSnapshotClient = Awaited<ReturnType<typeof createClient>>

type AssetAssignmentRow = {
  asset_id: string
  assigned_to?: string | null
  department?: string | null
  office_location?: string | null
  assignment_type?: string | null
}

type AssignmentUserRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  department?: string | null
}

type AssetIssueRow = {
  asset_id: string
  resolved?: boolean | null
}

type EmployeeRow = {
  id: string
}

type AssetRow = {
  id: string
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase as AdminAssetsSnapshotClient, user.id)
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const requestedDepartment = searchParams.get("department")
  const normalizedLedDepartments = scope.leadDepartments.map(normalizeDepartmentName)
  if (
    requestedDepartment &&
    (!scope.isDepartmentLead || !normalizedLedDepartments.includes(normalizeDepartmentName(requestedDepartment)))
  ) {
    return NextResponse.json({ error: "Forbidden: outside your department scope" }, { status: 403 })
  }
  const departmentScope = requestedDepartment
    ? expandDepartmentScopeForQuery([requestedDepartment])
    : getDepartmentScope(scope, "general")
  const { data: requestedOfficeRows } = requestedDepartment
    ? await getServiceRoleClientOrFallback(supabase as AdminAssetsSnapshotClient)
        .from("office_locations")
        .select("name")
        .in("department", departmentScope || [])
    : { data: null }
  const managedOffices = requestedDepartment
    ? (requestedOfficeRows || []).map((office) => office.name).filter(Boolean)
    : scope.managedOffices
  const paginationParsed = PaginationSchema.safeParse(Object.fromEntries(searchParams))
  if (!paginationParsed.success) {
    return NextResponse.json(
      { error: paginationParsed.error.issues[0]?.message ?? "Invalid pagination params" },
      { status: 400 }
    )
  }
  const pagination = paginationParsed.data
  const { from, to } = getPaginationRange(pagination)

  const dataClient = getServiceRoleClientOrFallback(supabase as AdminAssetsSnapshotClient)

  let { data: assetsData, error: assetsError } = await dataClient
    .from("assets")
    .select("*")
    .order("created_at", { ascending: false })

  if (assetsError && dataClient !== supabase) {
    const fallback = await supabase.from("assets").select("*").order("created_at", { ascending: false })
    assetsData = fallback.data
    assetsError = fallback.error
  }

  if (assetsError) {
    return NextResponse.json({ error: assetsError.message }, { status: 500 })
  }

  const { data: assignmentsData } = await dataClient
    .from("asset_assignments")
    .select("asset_id, assigned_to, department, office_location, assignment_type")
    .eq("is_current", true)

  const assignedUserIds = ((assignmentsData || []) as AssetAssignmentRow[]).map((a) => a.assigned_to).filter(Boolean)

  let assignmentUsersMap = new Map<string, AssignmentUserRow>()
  if (assignedUserIds.length > 0) {
    const { data: usersData } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, department")
      .in("id", assignedUserIds)

    assignmentUsersMap = new Map((usersData || []).map((u) => [u.id, u]))
  }

  const { data: employeeData } = await listAssignableProfiles(dataClient, {
    select: "id, first_name, last_name, company_email, department, employment_status",
    departmentScope,
    allowLegacyNullStatus: false,
  })
  const employees = employeeData || []

  const { data: issuesData } = await dataClient.from("asset_issues").select("asset_id, resolved")

  const issueCountsByAsset: Record<string, number> = {}
  ;((issuesData || []) as AssetIssueRow[]).forEach((issue) => {
    if (!issue.resolved) {
      issueCountsByAsset[issue.asset_id] = (issueCountsByAsset[issue.asset_id] || 0) + 1
    }
  })

  let filteredAssets = assetsData || []
  if (departmentScope) {
    const deptUserIds = (employees as EmployeeRow[]).map((s) => s.id)
    filteredAssets = filteredAssets.filter((asset) => {
      const assignment = ((assignmentsData || []) as AssetAssignmentRow[]).find(
        (a) => a.asset_id === (asset as AssetRow).id
      )
      if (!assignment) return false

      if (assignment.assigned_to && deptUserIds.includes(assignment.assigned_to)) return true
      if (assignment.department && departmentScope.includes(assignment.department)) return true
      if (assignment.office_location && managedOffices.includes(assignment.office_location)) return true
      return false
    })
  }

  const assets = (filteredAssets as AssetRow[]).map((asset) => {
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

  return NextResponse.json({
    ...paginatedResponse(assets.slice(from, to + 1), assets.length, pagination),
    employees,
  })
}
