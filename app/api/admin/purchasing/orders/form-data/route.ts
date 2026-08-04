import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Active suppliers + active products for the "create purchase order" dialog.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const [{ data: suppliers }, { data: products }] = await Promise.all([
    db.from("suppliers").select("id, name, code").eq("is_active", true).order("name"),
    db.from("products").select("id, name, sku, unit_cost").eq("status", "active").order("name"),
  ])

  return NextResponse.json({ suppliers: suppliers ?? [], products: products ?? [] })
}
