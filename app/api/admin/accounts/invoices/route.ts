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

const InvoiceCreateSchema = z.object({
  customer_name: z.string().trim().min(1),
  customer_email: z.string().trim().optional().nullable(),
  customer_address: z.string().trim().optional().nullable(),
  issue_date: z.string().min(1),
  due_date: z.string().min(1),
  currency: z.string().min(1),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  status: z.enum(["draft", "sent"]).default("draft"),
  items: z.array(InvoiceItemSchema).min(1),
})

export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db.from("invoices").select("*").order("created_at", { ascending: false })
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: data ?? [] })
}

// Creates an invoice + its line items in one call.
export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = InvoiceCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const {
    customer_name,
    customer_email,
    customer_address,
    issue_date,
    due_date,
    currency,
    notes,
    terms,
    status,
    items,
  } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const taxAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price * (item.tax_rate / 100), 0)
  const total = subtotal + taxAmount
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`

  const { data: invoice, error: invoiceError } = await db
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      customer_name,
      customer_email: customer_email || null,
      customer_address: customer_address || null,
      issue_date,
      due_date,
      subtotal,
      tax_amount: taxAmount,
      discount_amount: 0,
      total_amount: total,
      amount_paid: 0,
      balance_due: total,
      currency,
      status,
      notes: notes || null,
      terms: terms || null,
      created_by: scope.userId,
    })
    .select()
    .single()
  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 500 })

  const invoiceItems = items.map((item) => ({
    invoice_id: (invoice as { id: string }).id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate,
    amount: item.amount,
  }))
  const { error: itemsError } = await db.from("invoice_items").insert(invoiceItems)
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  return NextResponse.json({ ok: true, invoice_number: invoiceNumber })
}
