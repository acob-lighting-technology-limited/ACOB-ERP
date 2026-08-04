import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  company_email: string | null
  first_name: string | null
  last_name: string | null
  role: string
  admin_routes?: string[] | null
  department: string | null
  employment_status: string | null
  created_at: string
}

function shape(u: ProfileRow) {
  return {
    ...u,
    email: u.company_email,
    is_active: u.employment_status === "active",
    employment_status: u.employment_status || "active",
  }
}

// Org-wide, admin-only user administration. `?picker=1` returns only active
// users (for pickers); default returns all users plus the caller's role.
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const picker = request.nextUrl.searchParams.get("picker") === "1"

  if (picker) {
    const { data, error } = await db
      .from("profiles")
      .select("id, company_email, first_name, last_name, role, department, employment_status, created_at")
      .eq("employment_status", "active")
      .order("first_name")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ users: (data ?? []).map((u) => shape(u as ProfileRow)) })
  }

  const { data, error } = await db
    .from("profiles")
    .select("id, company_email, first_name, last_name, role, admin_routes, department, employment_status, created_at")
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    users: (data ?? []).map((u) => shape(u as ProfileRow)),
    currentUserRole: scope.role ?? "",
  })
}
