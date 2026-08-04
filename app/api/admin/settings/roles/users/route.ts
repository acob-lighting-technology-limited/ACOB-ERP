import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Lists profiles for the roles admin screen, optionally filtered to one role.
// Org-wide, admin-only (settings). Resolves scope server-side.
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const role = request.nextUrl.searchParams.get("role")
  const db = getServiceRoleClientOrFallback(supabase)

  let query = db
    .from("profiles")
    .select("id, first_name, last_name, company_email, department, employment_status, created_at")
    .order("first_name", { ascending: true })
  if (role) query = query.eq("role", role)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}
