import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

// Employee/department picker for the general-meeting week setup card.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, department, employment_status")
    .not("department", "is", null)
    .order("full_name", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const employees = (data ?? [])
    .filter((row): row is { id: string; full_name: string; department: string; employment_status: string | null } =>
      Boolean(row?.id && row?.full_name && row?.department)
    )
    .map((row) => ({
      id: row.id,
      full_name: row.full_name,
      department: normalizeDepartmentName(row.department),
      employment_status: row.employment_status || null,
    }))

  return NextResponse.json({ data: employees })
}
