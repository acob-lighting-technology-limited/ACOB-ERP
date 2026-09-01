import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { normalizeDepartmentName } from "@/shared/departments"
import { formValidation } from "@/lib/validation"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import type { Database } from "@/types/database"

const log = logger("admin-hr-employee-profile")
export const dynamic = "force-dynamic"

function isManageUsersRole(role: string | null | undefined): boolean {
  return role === "developer" || role === "super_admin" || role === "admin"
}

/**
 * GET returns the full profile row (joined with contract_categories(code)) for the
 * employee3 edit dialog and for the pre-save diff check — the two reads the original
 * employees page used to do with a raw browser Supabase client, which is not allowed
 * from admin client components (bypasses middleware scope injection).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  const { data: profile, error } = await db
    .from("profiles")
    .select("*, contract_categories(code)")
    .eq("id", userId)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: error?.message ?? "Employee not found" }, { status: 404 })
  }

  return NextResponse.json({ data: profile })
}

const UpdateEmployeeProfileSchema = z.object({
  role: z.enum(["visitor", "employee", "admin", "super_admin", "developer"]),
  admin_routes: z.array(z.string()).nullable().optional(),
  department: z.string(),
  office_location: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  is_department_lead: z.boolean(),
  first_name: z.string(),
  last_name: z.string(),
  other_names: z.string().nullable().optional(),
  company_email: z.string().trim().toLowerCase(),
  additional_email: z.string().trim().toLowerCase().nullable().optional(),
  personal_email: z.string().trim().toLowerCase().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  additional_phone: z.string().nullable().optional(),
  residential_address: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  bank_account_number: z.string().nullable().optional(),
  bank_account_name: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  birth_year: z.union([z.string(), z.number()]).nullable().optional(),
  employment_date: z.string().nullable().optional(),
  job_description: z.string().nullable().optional(),
  attendance_exempt: z.boolean().optional(),
})

/**
 * PATCH applies the general profile edit — role, department, personal & bank details, etc.
 * Employment status/suspension/exit changes go through /api/v1/hr/employees/[id]/status, and
 * employment-type/contract-category conversion through /api/admin/employees/convert-type, as
 * in the original employees page; this endpoint only owns what that page wrote via a direct
 * `profiles` update.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const rl = await rateLimit(`admin-hr-employee-profile:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!isManageUsersRole(scope.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId } = await params
  const parsed = UpdateEmployeeProfileSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
  }
  const body = parsed.data

  if (!formValidation.isCompanyEmail(body.company_email)) {
    return NextResponse.json({ error: "Valid company email is required" }, { status: 400 })
  }

  const db = getServiceRoleClientOrFallback(supabase)

  const { data: currentProfile, error: fetchErr } = await db
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<{ role: string | null }>()

  if (fetchErr || !currentProfile) {
    return NextResponse.json(
      { error: "Could not retrieve current employee record for verification" },
      {
        status: 404,
      }
    )
  }

  if (scope.userId === userId && body.role !== currentProfile.role) {
    return NextResponse.json({ error: "You cannot change your own role from the HR employee editor" }, { status: 403 })
  }

  const canonicalDepartment = normalizeDepartmentName(body.department) || ""
  const leadDepartments = body.is_department_lead && canonicalDepartment ? [canonicalDepartment] : []

  let departmentId: string | null = null
  if (canonicalDepartment) {
    const { data: deptRow } = await db.from("departments").select("id").eq("name", canonicalDepartment).maybeSingle()
    departmentId = deptRow?.id || null
  }

  const updateData: Database["public"]["Tables"]["profiles"]["Update"] = {
    role: body.role,
    admin_routes: body.role === "admin" ? (body.admin_routes ?? null) : null,
    department: canonicalDepartment || null,
    department_id: departmentId,
    office_location: body.office_location || null,
    designation: body.designation || null,
    is_department_lead: body.is_department_lead,
    lead_departments: leadDepartments,
    updated_at: new Date().toISOString(),
    first_name: body.first_name || "",
    last_name: body.last_name || "",
    other_names: body.other_names || null,
    company_email: body.company_email,
    additional_email: body.additional_email || null,
    phone_number: body.phone_number || null,
    additional_phone: body.additional_phone || null,
    residential_address: body.residential_address || null,
    bank_name: body.bank_name || null,
    bank_account_number: body.bank_account_number || null,
    bank_account_name: body.bank_account_name || null,
    birthday: body.birthday || null,
    birth_year: body.birth_year ? Number(body.birth_year) : null,
    employment_date: body.employment_date || null,
    job_description: body.job_description || null,
  }

  ;(updateData as Record<string, unknown>).attendance_exempt = Boolean(body.attendance_exempt)
  ;(updateData as Record<string, unknown>).personal_email = body.personal_email || null

  const { error: updateError } = await db.from("profiles").update(updateData).eq("id", userId)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  const { data: updatedProfile, error: refetchError } = await db
    .from("profiles")
    .select("*, contract_categories(code)")
    .eq("id", userId)
    .single()

  if (refetchError || !updatedProfile) {
    log.error({ err: refetchError }, "profile updated but refetch failed")
  }

  await writeAuditLog(
    supabase,
    {
      action: "update",
      entityType: "profile",
      entityId: userId,
      newValues: updateData as unknown as Record<string, unknown>,
      context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/employees/[userId]/profile" },
    },
    { failOpen: true }
  )

  return NextResponse.json({ data: updatedProfile ?? null })
}
