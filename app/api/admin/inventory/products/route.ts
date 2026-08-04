import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const ProductSchema = z.object({
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

// Inventory is org-wide, admin-only.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db.from("products").select("*, category:product_categories(name)").order("name")

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const products = (data ?? []).map((p) => {
    const row = p as Record<string, unknown> & { category?: CategoryJoin }
    return { ...row, category_name: row.category?.name || undefined }
  })
  return NextResponse.json({ data: products })
}

export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = ProductSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { category_id, description, ...rest } = parsed.data

  const { error } = await db.from("products").insert({
    ...rest,
    description: description || null,
    category_id: category_id || null,
    created_by: scope.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
