import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Current assignment details — shared by the edit-asset dialog prefill and the
// assign-asset dialog.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: assetId } = await params
  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("asset_assignments")
    .select(
      "id, assigned_by, assigned_at, assigned_to, department, office_location, assignment_notes, assignment_type, is_current"
    )
    .eq("asset_id", assetId)
    .eq("is_current", true)
    .single()

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: data ?? null, currentUserId: scope.userId })
}
