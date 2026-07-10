import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type StockMovementRow = Record<string, unknown> & {
  product?: { name?: string | null } | null
  created_by?: { first_name?: string | null; last_name?: string | null } | null
}

export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("stock_movements")
    .select("*, product:products(name), created_by:profiles(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const movements = ((data ?? []) as StockMovementRow[]).map((movement) => ({
    ...movement,
    product_name: movement.product?.name || undefined,
    created_by_name: movement.created_by
      ? `${movement.created_by.first_name || ""} ${movement.created_by.last_name || ""}`.trim() || undefined
      : undefined,
  }))
  return NextResponse.json({ data: movements })
}
