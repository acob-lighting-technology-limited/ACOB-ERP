import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const BillItemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.number(),
  unit_price: z.number(),
  amount: z.number(),
})

const BillCreateSchema = z.object({
  supplier_name: z.string().trim().min(1),
  supplier_email: z.string().trim().optional().nullable(),
  bill_date: z.string().min(1),
  due_date: z.string().min(1),
  currency: z.string().min(1),
  notes: z.string().optional().nullable(),
  items: z.array(BillItemSchema).min(1),
})

export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db.from("bills").select("*").order("created_at", { ascending: false })
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: data ?? [] })
}

// Creates a bill + its line items in one call (both writes use the service role).
export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = BillCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { supplier_name, supplier_email, bill_date, due_date, currency, notes, items } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  const total = items.reduce((sum, item) => sum + item.amount, 0)
  const billNumber = `BILL-${Date.now().toString(36).toUpperCase()}`

  const { data: bill, error: billError } = await db
    .from("bills")
    .insert({
      bill_number: billNumber,
      supplier_name,
      supplier_email: supplier_email || null,
      bill_date,
      due_date,
      subtotal: total,
      tax_amount: 0,
      total_amount: total,
      amount_paid: 0,
      balance_due: total,
      currency,
      status: "pending",
      notes: notes || null,
      created_by: scope.userId,
    })
    .select()
    .single()
  if (billError) return NextResponse.json({ error: billError.message }, { status: 500 })

  const billItems = items.map((item) => ({
    bill_id: (bill as { id: string }).id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: 0,
    amount: item.amount,
  }))
  const { error: itemsError } = await db.from("bill_items").insert(billItems)
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  return NextResponse.json({ ok: true, bill_number: billNumber })
}
