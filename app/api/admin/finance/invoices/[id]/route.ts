import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const InvoiceItemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.number(),
  unit_price: z.number(),
  tax_rate: z.number(),
  amount: z.number(),
})

// Full edit (invoice fields + replace all items) — used by the edit dialog.
const InvoiceEditSchema = z.object({
  mode: z.literal("edit"),
  customer_name: z.string().trim().min(1),
  customer_email: z.string().trim().optional().nullable(),
  customer_address: z.string().trim().optional().nullable(),
  issue_date: z.string().min(1),
  due_date: z.string().min(1),
  currency: z.string().min(1),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  items: z.array(InvoiceItemSchema).min(1),
})

// Status-only transition — used by "mark as sent" / "mark as paid".
const InvoiceStatusSchema = z.object({
  mode: z.literal("status"),
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]),
})

const PatchSchema = z.discriminatedUnion("mode", [InvoiceEditSchema, InvoiceStatusSchema])

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)
  const [{ data: invoice, error: invoiceError }, { data: items, error: itemsError }] = await Promise.all([
    db.from("invoices").select("*").eq("id", id).single(),
    db.from("invoice_items").select("*").eq("invoice_id", id).order("created_at"),
  ])
  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 404 })
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  return NextResponse.json({ data: { invoice, items: items ?? [] } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)

  if (parsed.data.mode === "status") {
    const update: Record<string, unknown> = { status: parsed.data.status }
    if (parsed.data.status === "paid") {
      const { data: current } = await db.from("invoices").select("total_amount").eq("id", id).single()
      const totalAmount = (current as { total_amount?: number } | null)?.total_amount ?? 0
      update.amount_paid = totalAmount
      update.balance_due = 0
    }
    const { error } = await db.from("invoices").update(update).eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // mode === "edit": update invoice fields, then replace all line items.
  const { customer_name, customer_email, customer_address, issue_date, due_date, currency, notes, terms, items } =
    parsed.data
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const taxAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price * (item.tax_rate / 100), 0)
  const total = subtotal + taxAmount

  const { error: invoiceError } = await db
    .from("invoices")
    .update({
      customer_name,
      customer_email: customer_email || null,
      customer_address: customer_address || null,
      issue_date,
      due_date,
      subtotal,
      tax_amount: taxAmount,
      total_amount: total,
      balance_due: total,
      currency,
      notes: notes || null,
      terms: terms || null,
    })
    .eq("id", id)
  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 500 })

  const { error: deleteItemsError } = await db.from("invoice_items").delete().eq("invoice_id", id)
  if (deleteItemsError) return NextResponse.json({ error: deleteItemsError.message }, { status: 500 })

  const { error: insertItemsError } = await db.from("invoice_items").insert(
    items.map((item) => ({
      invoice_id: id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate,
      amount: item.amount,
    }))
  )
  if (insertItemsError) return NextResponse.json({ error: insertItemsError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
