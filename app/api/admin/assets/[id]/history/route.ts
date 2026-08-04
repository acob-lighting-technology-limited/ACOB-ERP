import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type ProfileNameRow = { id: string; first_name: string | null; last_name: string | null }

// Raw assignment/issue/audit rows for the asset history modal. The client
// builds the unified activity timeline (formatting/sorting is presentational).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: assetId } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  const { data: assignments, error: assignmentsError } = await db
    .from("asset_assignments")
    .select(
      "id, assigned_at, handed_over_at, assignment_notes, handover_notes, assigned_by, assigned_to, department, office_location, assignment_type"
    )
    .eq("asset_id", assetId)
  if (assignmentsError) return NextResponse.json({ error: assignmentsError.message }, { status: 500 })

  const { data: issues, error: issuesError } = await db
    .from("asset_issues")
    .select("id, description, resolved, created_at, resolved_at, created_by, resolved_by")
    .eq("asset_id", assetId)
  if (issuesError) return NextResponse.json({ error: issuesError.message }, { status: 500 })

  const { data: auditLogs, error: auditError } = await db
    .from("audit_logs")
    .select("id, operation, old_values, new_values, created_at, user_id")
    .eq("table_name", "assets")
    .eq("record_id", assetId)
    .eq("operation", "UPDATE")
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 })

  const userIds = new Set<string>()
  assignments?.forEach((a) => {
    if (a.assigned_by) userIds.add(a.assigned_by)
    if (a.assigned_to) userIds.add(a.assigned_to)
  })
  issues?.forEach((i) => {
    if (i.created_by) userIds.add(i.created_by)
    if (i.resolved_by) userIds.add(i.resolved_by)
  })
  auditLogs?.forEach((l) => {
    if (l.user_id) userIds.add(l.user_id)
  })

  let users: ProfileNameRow[] = []
  if (userIds.size > 0) {
    const { data: usersData } = await db
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", Array.from(userIds))
    users = (usersData ?? []) as ProfileNameRow[]
  }

  return NextResponse.json({
    assignments: assignments ?? [],
    issues: issues ?? [],
    auditLogs: auditLogs ?? [],
    users,
  })
}
