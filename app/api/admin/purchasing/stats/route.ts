import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type PurchaseOrderRow = {
  status?: string | null
  total_amount?: number | null
}

// Purchasing is org-wide, admin-only (matches AGENTS.md's intentionally org-wide list).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data: suppliers } = await db.from("suppliers").select("*")
  const { data: orders } = await db.from("purchase_orders").select("*")

  const orderRows = (orders ?? []) as PurchaseOrderRow[]
  const activeOrders = orderRows.filter((order) => order.status === "pending" || order.status === "approved")
  const pendingReceipts = orderRows.filter((order) => order.status === "approved").length
  const totalValue = orderRows.reduce((sum, order) => sum + (order.total_amount || 0), 0)

  return NextResponse.json({
    totalSuppliers: suppliers?.length || 0,
    activeOrders: activeOrders.length,
    pendingReceipts,
    totalOrderValue: totalValue,
  })
}
