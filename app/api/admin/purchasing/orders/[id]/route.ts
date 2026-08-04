import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type SupplierJoin = { name?: string | null } | null
type ProductJoin = { name?: string | null } | null
type POItemRow = Record<string, unknown> & { product?: ProductJoin }

const StatusSchema = z.object({
  status: z.enum(["draft", "pending", "approved", "received", "cancelled"]),
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("purchase_orders")
    .select("*, supplier:suppliers(name), items:purchase_order_items(*, product:products(name))")
    .eq("id", id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  const row = data as Record<string, unknown> & { supplier?: SupplierJoin; items?: POItemRow[] }
  const order = {
    ...row,
    supplier_name: row.supplier?.name || undefined,
    items: (row.items ?? []).map((item) => ({ ...item, product_name: item.product?.name || undefined })),
  }
  return NextResponse.json({ data: order })
}

// Status transitions only (draft -> pending -> approved -> received, or cancelled).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const parsed = StatusSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { error } = await db.from("purchase_orders").update({ status: parsed.data.status }).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
