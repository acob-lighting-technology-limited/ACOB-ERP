import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const LocationSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().min(1),
  department: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  is_active: z.boolean(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike || scope.scopeMode === "lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const parsed = LocationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { name, type, department, description, is_active } = parsed.data

  const { data: updatedRows, error } = await db
    .from("office_locations")
    .update({
      name: name.trim(),
      type,
      department: department || null,
      description: description || null,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "Update was blocked by a database policy. Check office location permissions." },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true })
}
