import { NextResponse } from "next/server"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

type AssetRow = {
  unique_code: string
  asset_type: string
  status: string
  assignment_type?: string | null
  department?: string | null
  office_location?: string | null
}
type ProfileNameRow = { first_name: string; last_name: string; department?: string | null }

// All asset issues, enriched with asset/creator/resolver/assignment details.
// Shared between /admin/assets/issues (org-wide) and /dept/[id]/assets/issues
// (department-scoped via getScopedDepartments — no client-side lock filter).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const depts = getScopedDepartments(scope)
  if (depts !== null && depts.length === 0) return NextResponse.json({ data: [] })

  const { data: issuesData, error: issuesError } = await db
    .from("asset_issues")
    .select("*")
    .order("created_at", { ascending: false })
  if (issuesError) return NextResponse.json({ error: issuesError.message }, { status: 500 })

  const issuesWithDetails = await Promise.all(
    (issuesData ?? []).map(async (issue) => {
      const { data: assetData } = await db
        .from("assets")
        .select("unique_code, asset_type, status, assignment_type, department, office_location")
        .eq("id", issue.asset_id)
        .single<AssetRow>()

      let assignmentData: Record<string, unknown> | null = null
      if (assetData) {
        const { data: assignment } = await db
          .from("asset_assignments")
          .select("assigned_to, department, office_location")
          .eq("asset_id", issue.asset_id)
          .eq("is_current", true)
          .maybeSingle()

        if (assignment) {
          if (assignment.assigned_to) {
            const { data: userData } = await db
              .from("profiles")
              .select("first_name, last_name, department")
              .eq("id", assignment.assigned_to)
              .single<ProfileNameRow>()
            assignmentData = {
              type: "individual",
              user: userData,
              department: assignment.department,
              office_location: assignment.office_location,
            }
          } else if (assignment.department) {
            assignmentData = { type: "department", department: assignment.department }
          } else if (assignment.office_location) {
            assignmentData = { type: "office", office_location: assignment.office_location }
          }
        }
      }

      const { data: creatorData } = await db
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", issue.created_by)
        .single<ProfileNameRow>()

      let resolverData: ProfileNameRow | null = null
      if (issue.resolved_by) {
        const { data } = await db
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", issue.resolved_by)
          .single<ProfileNameRow>()
        resolverData = data
      }

      return {
        ...issue,
        asset: { ...assetData, current_assignment: assignmentData },
        creator: creatorData,
        resolver: resolverData,
      }
    })
  )

  if (depts === null) return NextResponse.json({ data: issuesWithDetails })

  const scopedSet = new Set(depts.map((d) => normalizeDepartmentName(d)))
  const filtered = issuesWithDetails.filter((issue) => {
    const assignment = issue.asset?.current_assignment as {
      department?: string
      user?: { department?: string | null }
    } | null
    const assetDepartment = normalizeDepartmentName(issue.asset?.department || "")
    const assignmentDepartment = normalizeDepartmentName(assignment?.department || "")
    const assignedUserDepartment = normalizeDepartmentName(assignment?.user?.department || "")
    return [assetDepartment, assignmentDepartment, assignedUserDepartment].some((d) => scopedSet.has(d))
  })

  return NextResponse.json({ data: filtered })
}
