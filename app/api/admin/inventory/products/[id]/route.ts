import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const ProductUpdateSchema = z.object({
  sku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  category_id: z.string().trim().optional().nullable(),
  unit_cost: z.number(),
  selling_price: z.number(),
  quantity_on_hand: z.number(),
  reorder_level: z.number(),
  status: z.string(),
})

type CategoryJoin = { name: string | null } | null

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db.from("products").select("*, category:product_categories(name)").eq("id", id).single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  const row = data as Record<string, unknown> & { category?: CategoryJoin }
  return NextResponse.json({ data: { ...row, category_name: row.category?.name || undefined } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const parsed = ProductUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { category_id, description, ...rest } = parsed.data

  const { error } = await db
    .from("products")
    .update({ ...rest, description: description || null, category_id: category_id || null })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
