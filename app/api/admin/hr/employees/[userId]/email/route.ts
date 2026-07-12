import { NextRequest, NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { z } from "zod"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { createClient } from "@/lib/supabase/server"
import { formValidation } from "@/lib/validation"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("admin-hr-employee-email")

const UpdateEmployeeEmailSchema = z.object({
  companyEmail: z.string().trim().toLowerCase().min(1, "Company email is required"),
  additionalEmail: z.string().trim().toLowerCase().nullable().optional(),
})

type EmployeeEmailClient = Awaited<ReturnType<typeof createClient>>

interface ProfileEmailRow {
  id: string
  company_email: string | null
  additional_email: string | null
}

function isManageUsersRole(role: string | null | undefined): boolean {
  return role === "developer" || role === "super_admin" || role === "admin"
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`admin-hr-employees-email:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase as EmployeeEmailClient, user.id)
    if (!scope || !isManageUsersRole(scope.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const employeeId = String(params?.userId || "").trim()
    if (!employeeId) {
      return NextResponse.json({ error: "Employee id is required" }, { status: 400 })
    }

    const parsed = UpdateEmployeeEmailSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const companyEmail = parsed.data.companyEmail
    const additionalEmail = parsed.data.additionalEmail?.trim() || null

    if (!formValidation.isCompanyEmail(companyEmail)) {
      return NextResponse.json(
        { error: "Only @acoblighting.com and @org.acoblighting.com emails are allowed" },
        { status: 400 }
      )
    }

    if (additionalEmail && !formValidation.isEmail(additionalEmail)) {
      return NextResponse.json({ error: "Additional email must be a valid email address" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      log.error("Missing Supabase service role configuration")
      return NextResponse.json({ error: "Configuration error: missing Supabase service role" }, { status: 500 })
    }

    const serviceSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: currentProfile, error: currentProfileError } = await serviceSupabase
      .from("profiles")
      .select("id, company_email, additional_email")
      .eq("id", employeeId)
      .single<ProfileEmailRow>()

    if (currentProfileError || !currentProfile) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 })
    }

    const { data: duplicateProfile, error: duplicateProfileError } = await serviceSupabase
      .from("profiles")
      .select("id")
      .ilike("company_email", companyEmail)
      .neq("id", employeeId)
      .maybeSingle<{ id: string }>()

    if (duplicateProfileError) {
      return NextResponse.json({ error: duplicateProfileError.message }, { status: 400 })
    }

    if (duplicateProfile) {
      return NextResponse.json({ error: "Another employee profile already uses this company email" }, { status: 409 })
    }

    const { data: authUser, error: authLookupError } = await serviceSupabase.auth.admin.getUserById(employeeId)
    if (authLookupError || !authUser.user) {
      return NextResponse.json({ error: "Employee auth account not found" }, { status: 404 })
    }

    const { error: authUpdateError } = await serviceSupabase.auth.admin.updateUserById(employeeId, {
      email: companyEmail,
      email_confirm: true,
      user_metadata: {
        ...authUser.user.user_metadata,
        email: companyEmail,
        email_verified: true,
      },
    })

    if (authUpdateError) {
      return NextResponse.json({ error: authUpdateError.message }, { status: 400 })
    }

    const { error: profileUpdateError } = await serviceSupabase
      .from("profiles")
      .update({
        company_email: companyEmail,
        additional_email: additionalEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)

    if (profileUpdateError) {
      return NextResponse.json({ error: profileUpdateError.message }, { status: 400 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "profile",
        entityId: employeeId,
        oldValues: {
          company_email: currentProfile.company_email,
          additional_email: currentProfile.additional_email,
          auth_email: authUser.user.email ?? null,
        },
        newValues: {
          company_email: companyEmail,
          additional_email: additionalEmail,
          auth_email: companyEmail,
        },
        context: { actorId: user.id, source: "api", route: "/api/admin/hr/employees/[userId]/email" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ ok: true, companyEmail, additionalEmail })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Failed to sync employee email")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
