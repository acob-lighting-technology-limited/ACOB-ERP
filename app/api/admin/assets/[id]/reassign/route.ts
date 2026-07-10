import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const ReassignSchema = z.object({
  assignment_type: z.enum(["individual", "department", "office"]),
  assigned_to: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  office_location: z.string().trim().optional().nullable(),
  assigned_by: z.string().trim().optional().nullable(),
  assigned_at: z.string().optional().nullable(),
  assignment_notes: z.string().trim().optional().nullable(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: assetId } = await params
  const parsed = ReassignSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { assignment_type, assigned_to, department, office_location, assigned_by, assigned_at, assignment_notes } =
    parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  const { error } = await db.rpc("reassign_asset", {
    p_asset_id: assetId,
    p_new_assignment_type: assignment_type,
    p_assigned_to: assigned_to || null,
    p_department: department || null,
    p_office_location: office_location || null,
    p_assigned_by: assigned_by || scope.userId,
    p_assigned_at: assigned_at ? new Date(assigned_at).toISOString() : new Date().toISOString(),
    p_assignment_notes: assignment_notes || null,
    p_handover_notes: "Reassigned",
    p_new_status: "assigned",
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
