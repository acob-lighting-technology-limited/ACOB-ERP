import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type ReceiptRow = Record<string, unknown> & {
  purchase_order?: { po_number?: string | null; supplier?: { name?: string | null } | null } | null
}

export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("goods_receipts")
    .select("*, purchase_order:purchase_orders(po_number, supplier:suppliers(name))")
    .order("created_at", { ascending: false })

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const receipts = ((data ?? []) as ReceiptRow[]).map((receipt) => ({
    ...receipt,
    po_number: receipt.purchase_order?.po_number || undefined,
    supplier_name: receipt.purchase_order?.supplier?.name || undefined,
  }))
  return NextResponse.json({ data: receipts })
}
