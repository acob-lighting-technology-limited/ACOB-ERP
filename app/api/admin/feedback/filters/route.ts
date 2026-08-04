import { NextResponse } from "next/server"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Employee/department options for the feedback filters. Dept-scoped: leads only
// see their departments. Resolved server-side (browser no longer queries directly).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const depts = getScopedDepartments(scope)
  let query = db
    .from("profiles")
    .select("id, first_name, last_name, department")
    .order("last_name", { ascending: true })
  if (depts !== null) {
    if (depts.length === 0) return NextResponse.json({ employees: [], departments: [] })
    query = query.in("department", depts)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const employees = (data ?? []) as { id: string; first_name: string; last_name: string; department: string }[]
  const departments = Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort()
  return NextResponse.json({ employees, departments })
}
