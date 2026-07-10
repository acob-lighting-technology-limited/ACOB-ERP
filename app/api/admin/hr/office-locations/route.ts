import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

type LocationEmployee = {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
  designation: string | null
  office_location: string | null
  employment_status?: string | null
}

const LocationSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().min(1),
  department: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  is_active: z.boolean(),
})

// Office locations — org-wide list, admin-only can manage (pure dept leads get
// a read-only, department-filtered view). Matches AGENTS.md's
// "app/admin/hr/office-location" org-wide exception, gated on isAdminLike.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const canManageLocations = scope.isAdminLike && scope.scopeMode !== "lead"

  const [{ data: locations, error }, { data: departments }] = await Promise.all([
    db.from("office_locations").select("*").order("name"),
    db.from("departments").select("name").eq("is_active", true).order("name"),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: profiles } = await db
    .from("profiles")
    .select(
      "id, first_name, last_name, company_email, additional_email, designation, office_location, employment_status"
    )

  const byLocation: Record<string, LocationEmployee[]> = {}
  for (const profile of ((profiles ?? []) as LocationEmployee[]).filter((employee) =>
    isAssignableEmploymentStatus(employee.employment_status, { allowLegacyNullStatus: false })
  )) {
    const locationName = profile.office_location?.trim() || "Unassigned"
    if (!byLocation[locationName]) byLocation[locationName] = []
    byLocation[locationName].push(profile)
  }

  const depts = getScopedDepartments(scope)
  const shouldScopeToDepartments = depts !== null
  const scopedDepartmentSet = new Set((depts ?? []).map((d) => normalizeDepartmentName(d)))

  const locationsWithCounts = (locations ?? [])
    .filter((location) => {
      if (!shouldScopeToDepartments) return true
      return scopedDepartmentSet.has(normalizeDepartmentName(String(location.department || "")))
    })
    .map((location) => ({
      ...location,
      employee_count: byLocation[location.name]?.length || 0,
    }))

  const scopedDepartments = shouldScopeToDepartments
    ? (departments ?? []).filter((department) => scopedDepartmentSet.has(normalizeDepartmentName(department.name)))
    : (departments ?? [])

  return NextResponse.json({
    locations: locationsWithCounts,
    locationEmployees: byLocation,
    canManageLocations,
    departments: scopedDepartments.map((department) => department.name),
  })
}

export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike || scope.scopeMode === "lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = LocationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { name, type, department, description, is_active } = parsed.data
  const { error } = await db.from("office_locations").insert({
    name: name.trim(),
    type,
    department: department || null,
    description: description || null,
    is_active,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
