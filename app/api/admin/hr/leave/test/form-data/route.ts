import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

export const dynamic = "force-dynamic"

type ProfileOptionRow = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
  employment_status?: string | null
}

// Dev-only leave-flow test tool (app/admin/hr/leave/test) — employee + leave
// type pickers for constructing a synthetic test request.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (scope.role !== "developer") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const [profilesRes, typesRes] = await Promise.all([
    db
      .from("profiles")
      .select("id, full_name, first_name, last_name, company_email, employment_status")
      .order("first_name"),
    db.from("leave_types").select("id, name").order("name"),
  ])

  const employees = ((profilesRes.data ?? []) as ProfileOptionRow[])
    .filter((profile) => isAssignableEmploymentStatus(profile.employment_status, { allowLegacyNullStatus: false }))
    .map((p) => ({
      value: p.id,
      label: p.full_name?.trim() || `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.company_email || p.id,
    }))

  const leaveTypes = ((typesRes.data ?? []) as { id: string; name: string }[]).map((t) => ({
    value: t.id,
    label: t.name,
  }))

  return NextResponse.json({ employees, leaveTypes })
}
