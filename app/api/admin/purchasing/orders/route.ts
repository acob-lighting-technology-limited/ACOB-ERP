import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type SupplierJoin = { name?: string | null } | null

const POItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number(),
  unit_price: z.number(),
  amount: z.number(),
})

const POCreateSchema = z.object({
  supplier_id: z.string().min(1),
  order_date: z.string().min(1),
  expected_date: z.string().optional().nullable(),
  currency: z.string().min(1),
  notes: z.string().optional().nullable(),
  items: z.array(POItemSchema).min(1),
})

export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("purchase_orders")
    .select("*, supplier:suppliers(name)")
    .order("created_at", { ascending: false })

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const orders = (data ?? []).map((o) => {
    const row = o as Record<string, unknown> & { supplier?: SupplierJoin }
    return { ...row, supplier_name: row.supplier?.name || undefined }
  })
  return NextResponse.json({ data: orders })
}

// Creates a purchase order + its line items in one call (both writes use the
// service role so there is no partial-write window visible to the browser).
export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = POCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { supplier_id, order_date, expected_date, currency, notes, items } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`
  const total = items.reduce((sum, i) => sum + i.amount, 0)

  const { data: po, error: poError } = await db
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      supplier_id,
      order_date,
      expected_date: expected_date || null,
      total_amount: total,
      currency,
      status: "draft",
      notes: notes || null,
      created_by: scope.userId,
    })
    .select()
    .single()
  if (poError) return NextResponse.json({ error: poError.message }, { status: 500 })

  const poItems = items.map((i) => ({
    purchase_order_id: (po as { id: string }).id,
    product_id: i.product_id,
    quantity: i.quantity,
    unit_price: i.unit_price,
    amount: i.amount,
  }))
  const { error: itemsError } = await db.from("purchase_order_items").insert(poItems)
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  return NextResponse.json({ ok: true, po_number: poNumber })
}
