import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { z } from "zod"
import { buildApprovalEmailPreview } from "@/lib/onboarding/approval-email-preview"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import {
  sendNotificationEmailWithRetry,
  sendNotificationEmailsIndividuallyWithRetry,
} from "@/lib/notifications/email-gateway"
import { isSystemNotificationChannelEnabled } from "@/lib/notifications/delivery-policy"
import { syncEmploymentStatusToAuth } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { normalizeDepartmentName } from "@/shared/departments"

const log = logger("approve-user")

const ApproveUserSchema = z.object({
  pendingUserId: z.string().trim().min(1, "Missing pendingUserId"),
  employeeId: z.string().trim().optional(),
  hireDate: z.string().trim().nullable().optional(),
  // When false (default for UI), skip auto-sending emails and return the built preview so the
  // frontend can ask the admin whether to send before dispatching.
  sendEmails: z.boolean().optional().default(false),
})

export async function POST(req: Request) {
  const rl = await rateLimit(`approve-user:${getClientId(req)}`, { limit: 20, windowSec: 600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  // 1. Verify Caller is an Admin
  const supabase = await createServerClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()

  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, department, designation, full_name, first_name, last_name, is_department_lead, lead_departments")
    .eq("id", caller.id)
    .single<{
      role?: string | null
      department?: string | null
      designation?: string | null
      full_name?: string | null
      first_name?: string | null
      last_name?: string | null
      is_department_lead?: boolean | null
      lead_departments?: string[] | null
    }>()
  const callerRole = String(callerProfile?.role || "").toLowerCase()
  const callerIsAdminLike = ["developer", "super_admin", "admin"].includes(callerRole)
  const callerIsLead = callerProfile?.is_department_lead === true
  if (!callerProfile || (!callerIsAdminLike && !callerIsLead)) {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 })
  }

  log.info({ callerId: caller.id }, "Starting approval process")
  try {
    const emailWarnings: Array<{
      audience: "employee" | "management"
      reason: string
      recipients: string[]
    }> = []

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      log.error("Missing Supabase environment variables")
      return NextResponse.json({ error: "System configuration error: Missing database keys" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const authUserExistsById = async (id: string): Promise<boolean> => {
      if (!id) return false
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(id)
        if (error) return false
        return Boolean(data?.user?.id)
      } catch (_error) {
        return false
      }
    }
    const findAuthUserIdByEmail = async (email: string): Promise<string | null> => {
      const normalizedTarget = String(email || "")
        .trim()
        .toLowerCase()
      if (!normalizedTarget) return null

      try {
        let page = 1
        const perPage = 200
        while (true) {
          const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
          if (listError) break
          const users = listed?.users || []
          const matched = users.find(
            (candidate) =>
              String(candidate.email || "")
                .trim()
                .toLowerCase() === normalizedTarget
          )
          if (matched?.id) return matched.id
          if (users.length < perPage) break
          page += 1
        }
      } catch (_error) {
        // Non-fatal; caller handles null.
      }

      return null
    }

    const body = await req.json()
    const parsed = ApproveUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { pendingUserId, employeeId: manualEmployeeId, hireDate, sendEmails } = parsed.data

    // 1. Fetch Pending User Details
    const { data: pendingUser, error: fetchError } = await supabaseAdmin
      .from("pending_users")
      .select("*")
      .eq("id", pendingUserId)
      .single()

    if (fetchError || !pendingUser) {
      return NextResponse.json({ error: "Pending user not found" }, { status: 404 })
    }

    if (!callerIsAdminLike) {
      const managedDepartments = Array.from(
        new Set([callerProfile?.department, ...(callerProfile?.lead_departments || [])].filter(Boolean) as string[])
      ).map((departmentName) => normalizeDepartmentName(departmentName))
      const pendingDepartment = normalizeDepartmentName(String(pendingUser.department || ""))
      if (managedDepartments.length === 0 || !managedDepartments.includes(pendingDepartment)) {
        return NextResponse.json({ error: "Forbidden: Department scope mismatch" }, { status: 403 })
      }
    }

    // 1b. Validate Required Fields
    const requiredFields = ["company_email", "personal_email", "first_name", "last_name", "department", "designation"]
    const missingFields = requiredFields.filter((field) => !pendingUser[field])

    if (missingFields.length > 0) {
      return NextResponse.json({ error: `Missing required user data: ${missingFields.join(", ")}` }, { status: 422 })
    }

    // 2. Determine Employee ID — use DB sequence for atomic, collision-free generation
    let employeeId = manualEmployeeId

    if (employeeId) {
      const empNumPattern = /^ACOB\/[0-9]{4}\/[0-9]{3}$/
      if (!empNumPattern.test(employeeId)) {
        return NextResponse.json(
          { error: "Employee number must be in format: ACOB/YEAR/NUMBER (e.g., ACOB/2026/058)" },
          { status: 400 }
        )
      }
    }

    if (!employeeId) {
      // next_employee_number() calls nextval() on a sequence — fully atomic, no race condition
      const { data: seqRow, error: seqError } = await supabaseAdmin.rpc("next_employee_number")
      if (seqError || !seqRow) {
        throw new Error(`Failed to generate employee number: ${seqError?.message ?? "unknown error"}`)
      }
      employeeId = seqRow as string
    }

    const emailPreview = await buildApprovalEmailPreview({
      supabase: supabaseAdmin,
      pendingUser,
      preparedBy: {
        name:
          callerProfile?.full_name ||
          [callerProfile?.first_name, callerProfile?.last_name].filter(Boolean).join(" ").trim() ||
          caller.email ||
          "Admin & HR Lead",
        designation: callerProfile?.designation || null,
        department: callerProfile?.department || "Admin & HR",
      },
    })

    // 3. Create or Update Auth User
    // First check if profile or auth user already exists
    const { data: matchingProfiles, error: matchingProfilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, company_email, employee_number, employment_status")
      .ilike("company_email", pendingUser.company_email)
    if (matchingProfilesError) {
      throw new Error(`Profile creation failed: ${matchingProfilesError.message}`)
    }

    const existingProfiles = (matchingProfiles || []) as Array<{
      id: string
      company_email?: string | null
      employee_number?: string | null
      employment_status?: string | null
    }>
    let authUserId: string | null = null
    const normalizedCompanyEmail = String(pendingUser.company_email || "")
      .trim()
      .toLowerCase()
    log.info(
      {
        companyEmail: normalizedCompanyEmail,
        matchingProfilesCount: existingProfiles.length,
        matchingProfiles: existingProfiles.map((row) => ({
          id: row.id,
          company_email: row.company_email,
          employee_number: row.employee_number,
          employment_status: row.employment_status,
        })),
      },
      "Approval profile preflight matches"
    )
    for (const profile of existingProfiles) {
      const authExists = await authUserExistsById(profile.id)
      if (authExists) {
        log.info(
          { profileId: profile.id, companyEmail: normalizedCompanyEmail },
          "Found existing auth user by profile id"
        )
        authUserId = profile.id
        break
      }
      const hasEmployeeNumber = Boolean(String(profile.employee_number || "").trim())
      const currentStatus = String(profile.employment_status || "")
        .trim()
        .toLowerCase()
      const isDisposableProfile = !hasEmployeeNumber && currentStatus !== "active"
      if (!isDisposableProfile) {
        throw new Error(
          "Profile creation failed: Existing profile is not linked to auth user. Please contact support to repair this account."
        )
      }
      const archivedEmail = `orphan+${Date.now()}+${profile.id.slice(0, 8)}@acoblighting.local`
      const { error: orphanUpdateError } = await supabaseAdmin
        .from("profiles")
        .update({
          company_email: archivedEmail,
          personal_email: null,
          employment_status: "exited",
          termination_reason: "orphaned_profile_recovery",
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id)

      if (orphanUpdateError) {
        throw new Error(`Profile creation failed: ${orphanUpdateError.message}`)
      }
      log.warn(
        { profileId: profile.id, oldCompanyEmail: profile.company_email, newCompanyEmail: archivedEmail },
        "Archived orphan profile row during approval recovery"
      )
    }

    if (!authUserId) {
      authUserId = await findAuthUserIdByEmail(normalizedCompanyEmail)
    }

    if (!authUserId) {
      const { data: newAuthUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: pendingUser.company_email,
        password: emailPreview.tempPassword,
        email_confirm: true,
        user_metadata: {
          first_name: pendingUser.first_name,
          last_name: pendingUser.last_name,
          full_name: `${pendingUser.first_name} ${pendingUser.last_name}`,
        },
      })

      if (authError) {
        log.error(
          {
            authErrorMessage: authError.message,
            authErrorCode: "code" in authError ? String(authError.code) : null,
            authErrorStatus: "status" in authError ? String(authError.status) : null,
            companyEmail: normalizedCompanyEmail,
          },
          "Auth admin createUser failed"
        )
        // Probe path for diagnostics: determine if auth creation is globally broken
        // (e.g., trigger/function misconfiguration) vs this specific email conflict.
        try {
          const probeEmail = `probe-${Date.now()}@org.acoblighting.com`
          const { data: probeData, error: probeError } = await supabaseAdmin.auth.admin.createUser({
            email: probeEmail,
            password: emailPreview.tempPassword,
            email_confirm: true,
            user_metadata: {
              first_name: "Probe",
              last_name: "User",
              full_name: "Probe User",
            },
          })

          if (probeError) {
            log.error(
              {
                probeEmail,
                probeErrorMessage: probeError.message,
                probeErrorCode: "code" in probeError ? String(probeError.code) : null,
                probeErrorStatus: "status" in probeError ? String(probeError.status) : null,
              },
              "Auth probe createUser failed"
            )
          } else if (probeData?.user?.id) {
            log.info(
              { probeEmail, probeUserId: probeData.user.id },
              "Auth probe createUser succeeded; deleting probe user"
            )
            await supabaseAdmin.auth.admin
              .deleteUser(probeData.user.id)
              .catch((probeDeleteError) =>
                log.error(
                  { err: String(probeDeleteError), probeUserId: probeData.user.id },
                  "Failed to delete probe user"
                )
              )
          }
        } catch (probeUnhandledError) {
          log.error({ err: String(probeUnhandledError) }, "Auth probe execution failed unexpectedly")
        }
        // Recovery path:
        // If auth user already exists (often returned as generic DB error), reuse it.
        const recoveredAuthUserId = await findAuthUserIdByEmail(normalizedCompanyEmail)

        if (recoveredAuthUserId) {
          const { error: recoveredUpdateError } = await supabaseAdmin.auth.admin.updateUserById(recoveredAuthUserId, {
            password: emailPreview.tempPassword,
            email_confirm: true,
            user_metadata: {
              first_name: pendingUser.first_name,
              last_name: pendingUser.last_name,
              full_name: `${pendingUser.first_name} ${pendingUser.last_name}`,
            },
          })
          if (recoveredUpdateError) {
            throw new Error(`Auth creation failed: ${authError.message}`)
          }
          authUserId = recoveredAuthUserId
        } else {
          throw new Error(`Auth creation failed: ${authError.message}`)
        }
      }
      if (!authUserId) {
        authUserId = newAuthUser?.user?.id ?? null
      }
    } else {
      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password: emailPreview.tempPassword,
        email_confirm: true,
      })
      if (updateAuthError) {
        throw new Error(`Auth update failed: ${updateAuthError.message}`)
      }
    }

    // Split the onboarding DOB (YYYY-MM-DD) into the canonical month/day +
    // optional year. The profiles trigger derives date_of_birth from these.
    const dobMatch = String(pendingUser.date_of_birth || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
    const pendingBirthday = dobMatch ? `${dobMatch[2]}-${dobMatch[3]}` : null
    const pendingBirthYear = dobMatch ? Number(dobMatch[1]) : null

    // 4 & 5. Atomically upsert profile + delete from pending_users in one DB transaction.
    // If either step fails, both roll back — no ghost users, no orphaned profiles.
    const { error: approvalError } = await supabaseAdmin.rpc("atomic_complete_user_approval", {
      p_auth_user_id: authUserId,
      p_pending_user_id: pendingUserId,
      p_employee_number: employeeId,
      p_first_name: pendingUser.first_name,
      p_last_name: pendingUser.last_name,
      p_other_names: pendingUser.other_names ?? null,
      p_department: pendingUser.department,
      p_designation: pendingUser.designation,
      p_company_email: pendingUser.company_email,
      p_personal_email: pendingUser.personal_email,
      p_phone_number: pendingUser.phone_number ?? null,
      p_additional_phone: pendingUser.additional_phone_number ?? null,
      p_residential_address: pendingUser.residential_address ?? null,
      p_office_location: pendingUser.office_location ?? null,
      p_employment_date: hireDate ?? null,
      p_birthday: pendingBirthday,
      p_birth_year: pendingBirthYear,
    })

    if (approvalError) {
      // Clean up orphaned auth user if we just created one
      if (existingProfiles.length === 0 && authUserId) {
        await supabaseAdmin.auth.admin
          .deleteUser(authUserId)
          .catch((e) => log.error({ err: String(e) }, "Failed to clean up orphaned auth user"))
      }
      throw new Error(`Profile creation failed: ${approvalError.message}`)
    }

    if (sendEmails) {
      // 6. Send Welcome Email
      try {
        const onboardingMailEnabled = await isSystemNotificationChannelEnabled(supabaseAdmin, "onboarding", "email")
        if (onboardingMailEnabled) {
          const result = await sendNotificationEmailWithRetry({
            to: emailPreview.welcome.recipients,
            subject: emailPreview.welcome.subject,
            html: emailPreview.welcome.html,
          })

          if (!result.sent) {
            emailWarnings.push({
              audience: "employee",
              reason: result.reason,
              recipients: emailPreview.welcome.recipients,
            })
            log.error(
              { reason: result.reason, recipients: emailPreview.welcome.recipients },
              "Welcome email was not sent"
            )
          }
        }
      } catch (emailError) {
        emailWarnings.push({
          audience: "employee",
          reason: emailError instanceof Error ? emailError.message : String(emailError),
          recipients: emailPreview.welcome.recipients,
        })
        log.error({ err: String(emailError) }, "Failed to send welcome email")
      }

      // 7. Send Internal Confirmation Email to Department Leads
      try {
        const onboardingMailEnabled = await isSystemNotificationChannelEnabled(supabaseAdmin, "onboarding", "email")
        if (onboardingMailEnabled && emailPreview.internal.recipients.length > 0) {
          const result = await sendNotificationEmailsIndividuallyWithRetry({
            to: emailPreview.internal.recipients,
            subject: emailPreview.internal.subject,
            html: emailPreview.internal.html,
          })

          if (!result.sent) {
            const failureSummary = result.failedRecipients
              .map((failure) => `${failure.recipient}: ${failure.reason}`)
              .join("; ")
            emailWarnings.push({
              audience: "management",
              reason: failureSummary || "failed to send to one or more recipients",
              recipients: result.failedRecipients.map((failure) => failure.recipient),
            })
            log.error(
              { failedRecipients: result.failedRecipients, deliveredRecipients: result.deliveredRecipients },
              "Internal onboarding email failed for one or more recipients"
            )
          }
        }
      } catch (emailError) {
        emailWarnings.push({
          audience: "management",
          reason: emailError instanceof Error ? emailError.message : String(emailError),
          recipients: emailPreview.internal.recipients,
        })
        log.error({ err: String(emailError) }, "Failed to send stakeholder notification emails")
      }
    }

    // Sync employment_status into JWT metadata so middleware doesn't need a DB query.
    // This should not fail the approval if metadata sync hits a transient auth error.
    try {
      await syncEmploymentStatusToAuth(authUserId!, "active")
    } catch (syncError) {
      log.error({ err: String(syncError), authUserId }, "Employment status auth sync failed after approval")
      emailWarnings.push({
        audience: "management",
        reason: "Employment status sync warning (approval completed)",
        recipients: [],
      })
    }

    // Audit: new employee onboarding is a critical action
    const supabaseForAudit = await createServerClient()
    await writeAuditLog(
      supabaseForAudit,
      {
        action: "create",
        entityType: "profile",
        entityId: authUserId!,
        context: { actorId: caller.id, source: "api" as const },
        newValues: {
          employee_number: employeeId,
          company_email: pendingUser.company_email,
          department: pendingUser.department,
          role: "employee",
          employment_status: "active",
        },
        metadata: { source: "approve-user", pending_user_id: pendingUserId, email_warnings: emailWarnings },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      success: true,
      employeeId,
      profileId: authUserId,
      emailWarnings,
      // Returned when sendEmails=false so the frontend can prompt before dispatching.
      pendingEmailPreview: sendEmails
        ? null
        : {
            welcome: emailPreview.welcome,
            internal: emailPreview.internal,
          },
    })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Approval process failed")
    // Redact internal error details from the client while still surfacing known actionable failures.
    const knownPrefixes = [
      "Auth creation failed:",
      "Auth update failed:",
      "Profile creation failed:",
      "Failed to generate employee number:",
    ]
    const safeKnownError =
      error instanceof Error ? knownPrefixes.find((prefix) => error.message.startsWith(prefix)) : null
    const message =
      error instanceof Error && safeKnownError
        ? error.message
        : "An unexpected error occurred during the approval process. Please check system logs."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
