import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type ProductRow = {
  quantity_on_hand?: number | null
  reorder_level?: number | null
  unit_cost?: number | null
}

// Inventory is org-wide; gate on isAdminLike only (matches AGENTS.md's
// "intentionally org-wide" list — no department filter needed here).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)

  const { data: products, error: prodError } = await db.from("products").select("*")
  if (prodError && prodError.code !== "42P01") {
    return NextResponse.json({ error: prodError.message }, { status: 500 })
  }
  const { data: categories } = await db.from("product_categories").select("*")
  const { data: warehouses } = await db.from("warehouses").select("*")

  const allProducts = (products || []) as ProductRow[]
  const lowStock = allProducts.filter((p) => (p.quantity_on_hand || 0) <= (p.reorder_level || 10))
  const totalValue = allProducts.reduce((sum, p) => sum + (p.unit_cost || 0) * (p.quantity_on_hand || 0), 0)

  return NextResponse.json({
    totalProducts: allProducts.length,
    totalCategories: categories?.length || 0,
    totalWarehouses: warehouses?.length || 0,
    lowStockItems: lowStock.length,
    totalValue,
  })
}
