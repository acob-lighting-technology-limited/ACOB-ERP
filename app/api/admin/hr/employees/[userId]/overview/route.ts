import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"

type EmployeeOverviewClient = Awaited<ReturnType<typeof createClient>>

type AssetAssignmentRow = {
  id: string
  asset_id: string
  assigned_at?: string | null
  is_current?: boolean | null
  assignment_type?: string | null
}

type AssetRow = {
  id: string
  created_at?: string | null
  department?: string | null
  office_location?: string | null
}

type ProfileRow = {
  id: string
  department?: string | null
  department_id?: string | null
  office_location?: string | null
  [key: string]: unknown
}

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase as EmployeeOverviewClient, user.id)
    if (!scope || !canAccessAdminSection(scope, "hr")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const employeeId = String(params?.id || "").trim()
    if (!employeeId) {
      return NextResponse.json({ error: "Employee id is required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase as EmployeeOverviewClient)

    const { data: profile, error: profileError } = await dataClient
      .from("profiles")
      .select("*")
      .eq("id", employeeId)
      .single<ProfileRow>()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 })
    }

    // Department-lead actors can only read people within their managed scope.
    if (!scope.isAdminLike) {
      const inDepartmentScope =
        scope.managedDepartmentIds.length === 0
          ? scope.managedDepartments.length === 0 ||
            (profile.department && scope.managedDepartments.includes(profile.department))
          : profile.department_id
            ? scope.managedDepartmentIds.includes(profile.department_id)
            : Boolean(profile.department && scope.managedDepartments.includes(profile.department))
      const inOfficeScope =
        scope.managedOffices.length === 0 ||
        (profile.office_location && scope.managedOffices.includes(profile.office_location))

      if (!inDepartmentScope && !inOfficeScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const [tasksResult, assignmentsResult, deptAssetsResult, officeAssetsResult, docsResult] = await Promise.all([
      dataClient
        .from("tasks")
        .select("id, title, status, created_at")
        .eq("assigned_to", employeeId)
        .order("created_at", { ascending: false })
        .limit(10),
      dataClient
        .from("asset_assignments")
        .select("id, asset_id, assigned_at, is_current, assignment_type")
        .eq("assigned_to", employeeId)
        .eq("is_current", true)
        .limit(10),
      profile.department || profile.department_id
        ? (() => {
            const q = dataClient
              .from("assets")
              .select(
                "id, asset_name, asset_type, asset_model, serial_number, unique_code, status, assignment_type, department, created_at"
              )
              .eq("assignment_type", "department")
              .eq("status", "assigned")
              .is("deleted_at", null)
              .limit(10)
            return profile.department_id
              ? q.eq("department_id", profile.department_id)
              : q.eq("department", profile.department!)
          })()
        : Promise.resolve({ data: [] as AssetRow[] }),
      profile.office_location
        ? dataClient
            .from("assets")
            .select(
              "id, asset_name, asset_type, asset_model, serial_number, unique_code, status, assignment_type, office_location, created_at"
            )
            .eq("assignment_type", "office")
            .eq("office_location", profile.office_location)
            .eq("status", "assigned")
            .is("deleted_at", null)
            .limit(10)
        : Promise.resolve({ data: [] as AssetRow[] }),
      dataClient
        .from("user_documentation")
        .select("id, title, created_at")
        .eq("user_id", employeeId)
        .order("created_at", { ascending: false })
        .limit(10),
    ])

    const assignedAssetIds = Array.from(
      new Set(((assignmentsResult.data || []) as AssetAssignmentRow[]).map((row) => row.asset_id).filter(Boolean))
    )

    let assetMap = new Map<string, AssetRow>()
    if (assignedAssetIds.length > 0) {
      const { data: assetRows } = await dataClient
        .from("assets")
        .select("id, asset_name, asset_type, asset_model, serial_number, unique_code, status")
        .in("id", assignedAssetIds)
        .is("deleted_at", null)

      assetMap = new Map(((assetRows || []) as AssetRow[]).map((row) => [row.id, row] as const))
    }

    const individualAssets = ((assignmentsResult.data || []) as AssetAssignmentRow[]).map((assignment) => ({
      ...assignment,
      Asset: assetMap.get(assignment.asset_id) || null,
      assignmentType: "individual",
    }))

    const departmentAssets = ((deptAssetsResult.data || []) as AssetRow[]).map((asset) => ({
      id: `dept-${asset.id}`,
      asset_id: asset.id,
      assigned_at: asset.created_at,
      is_current: true,
      assignment_type: "department",
      Asset: asset,
      assignmentType: "department",
      department: asset.department,
    }))

    const officeAssets = ((officeAssetsResult.data || []) as AssetRow[]).map((asset) => ({
      id: `office-${asset.id}`,
      asset_id: asset.id,
      assigned_at: asset.created_at,
      is_current: true,
      assignment_type: "office",
      Asset: asset,
      assignmentType: "office",
      officeLocation: asset.office_location || profile.office_location,
    }))

    return NextResponse.json({
      profile,
      related: {
        tasks: tasksResult.data || [],
        assets: [...individualAssets, ...departmentAssets, ...officeAssets],
        documentation: docsResult.data || [],
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load employee overview"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
