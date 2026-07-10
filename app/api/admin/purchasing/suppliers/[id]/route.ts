import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const SupplierSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  contact_person: z.string().trim().optional().nullable(),
  is_active: z.boolean(),
})

// Supplier detail + last 10 purchase orders.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  const [{ data: supplier, error: supError }, { data: orders }] = await Promise.all([
    db.from("suppliers").select("*").eq("id", id).single(),
    db
      .from("purchase_orders")
      .select("id, po_number, order_date, total_amount, status")
      .eq("supplier_id", id)
      .order("order_date", { ascending: false })
      .limit(10),
  ])

  if (supError || !supplier) {
    return NextResponse.json({ error: supError?.message ?? "Supplier not found" }, { status: 404 })
  }
  return NextResponse.json({ data: { supplier, orders: orders ?? [] } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const parsed = SupplierSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { name, code, email, phone, address, contact_person, is_active } = parsed.data
  const { error } = await db
    .from("suppliers")
    .update({
      name,
      code,
      email: email || null,
      phone: phone || null,
      address: address || null,
      contact_person: contact_person || null,
      is_active,
    })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)
  const { error } = await db.from("suppliers").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
