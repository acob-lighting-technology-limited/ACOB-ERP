import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Soft-delete (archive) an asset. Blocks archiving an asset that currently has
// an active assignment — must be released/reassigned first.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: assetId } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  const { data: asset, error: fetchError } = await db
    .from("assets")
    .select("status, deleted_at")
    .eq("id", assetId)
    .single()
  if (fetchError || !asset) {
    return NextResponse.json({ error: fetchError?.message ?? "Asset not found" }, { status: 404 })
  }
  if (asset.deleted_at) {
    return NextResponse.json({ error: "Asset is already archived" }, { status: 400 })
  }

  if (asset.status === "assigned") {
    const { data: assignments } = await db
      .from("asset_assignments")
      .select("id")
      .eq("asset_id", assetId)
      .eq("is_current", true)
    if (assignments && assignments.length > 0) {
      return NextResponse.json(
        { error: "Cannot archive asset with active assignments. Please return or reassign first." },
        { status: 409 }
      )
    }
  }

  const { error } = await db
    .from("assets")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: scope.userId,
      delete_reason: "Archived from Admin Assets",
      updated_at: new Date().toISOString(),
    })
    .eq("id", assetId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
