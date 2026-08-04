import { NextResponse } from "next/server"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Profiles for the job-descriptions screen, dept-scoped server-side (replaces the
// old client-side is_department_lead/lead_departments filter).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const userProfile = {
    role: scope.role,
    is_department_lead: scope.isDepartmentLead,
    lead_departments: scope.leadDepartments,
  }

  const depts = getScopedDepartments(scope)
  let query = db.from("profiles").select("*").order("last_name", { ascending: true })
  if (depts !== null) {
    if (depts.length === 0) return NextResponse.json({ profiles: [], userProfile })
    query = query.in("department", depts)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ profiles: data ?? [], userProfile })
}
