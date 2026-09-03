import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { sendNotificationEmailWithRetry } from "@/lib/notifications/email-gateway"
import { isSystemNotificationChannelEnabled } from "@/lib/notifications/delivery-policy"
import { renderWelcomeEmail } from "@/lib/email-templates/welcome"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"

const log = logger("api-dispatch-credentials")

interface RouteContext {
  params: Promise<{ userId: string }>
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await context.params
    const id = userId
    if (!id) {
      return NextResponse.json({ error: "Missing employee ID" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope || !canAccessAdminSection(scope, "hr")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await req.json()) as { password?: string }
    const rawPassword = body.password?.trim()
    if (!rawPassword || rawPassword.length < 6) {
      return NextResponse.json({ error: "A valid password of at least 6 characters is required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Fetch employee profile
    const { data: profile, error: profileErr } = await dataClient
      .from("profiles")
      .select(
        "id, first_name, last_name, employee_number, department, designation, company_email, personal_email, office_location, residential_address, phone_number"
      )
      .eq("id", id)
      .single()

    if (profileErr || !profile) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 404 })
    }

    if (!profile.personal_email) {
      return NextResponse.json(
        { error: "Employee does not have a personal email on file to receive credentials" },
        { status: 422 }
      )
    }

    if (!profile.company_email) {
      return NextResponse.json({ error: "Employee does not have a company email assigned" }, { status: 422 })
    }

    // Fetch caller profile for email signature
    const { data: callerProfile } = await dataClient
      .from("profiles")
      .select("full_name, designation, department")
      .eq("id", user.id)
      .maybeSingle()

    // Render Welcome Email HTML
    const emailHtml = renderWelcomeEmail({
      pendingUser: {
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        department: profile.department || "General",
        designation: profile.designation || "Staff",
        company_email: profile.company_email,
        personal_email: profile.personal_email,
        employee_number: profile.employee_number || undefined,
        office_location: profile.office_location || undefined,
        residential_address: profile.residential_address || undefined,
        phone_number: profile.phone_number || undefined,
      },
      tempPassword: rawPassword,
      preparedBy: {
        name: callerProfile?.full_name || "Admin & IT",
        designation: callerProfile?.designation || "Administrator",
        department: callerProfile?.department || "Admin and HR",
      },
    })

    const onboardingMailEnabled = await isSystemNotificationChannelEnabled(dataClient, "onboarding", "email")
    if (!onboardingMailEnabled) {
      return NextResponse.json(
        { error: "Onboarding email notifications are currently disabled in system settings" },
        { status: 400 }
      )
    }

    const sendResult = await sendNotificationEmailWithRetry({
      to: [profile.personal_email],
      subject: "Welcome to ACOB - Official Company Email & Matrix Setup",
      html: emailHtml,
    })

    if (!sendResult.sent) {
      log.error({ reason: sendResult.reason, recipient: profile.personal_email }, "Failed to send credentials email")
      return NextResponse.json({ error: `Failed to deliver email: ${sendResult.reason}` }, { status: 502 })
    }

    const dispatchedAt = new Date().toISOString()

    // Update mailbox_credentials_sent_at on profile
    const { error: updateErr } = await dataClient
      .from("profiles")
      .update({
        mailbox_credentials_sent_at: dispatchedAt,
        updated_at: dispatchedAt,
      })
      .eq("id", id)

    if (updateErr) {
      log.error({ err: updateErr, profileId: id }, "Failed to update mailbox_credentials_sent_at")
    }

    // Create in-app announcement notification
    await dataClient.from("notifications").insert({
      user_id: id,
      type: "announcement",
      category: "system",
      priority: "high",
      title: "Welcome to ACOB",
      message: "Your official company email credentials and portal setup instructions have been dispatched.",
      link_url: null,
    })

    // Audit log
    await writeAuditLog(
      supabase,
      {
        action: "dispatch_webmail_credentials",
        entityType: "profile",
        entityId: id,
        newValues: {
          recipient: profile.personal_email,
          company_email: profile.company_email,
          dispatched_at: dispatchedAt,
        },
        context: {
          actorId: user.id,
          department: scope.department,
          source: "api",
          route: `/api/admin/hr/employees/${id}/dispatch-credentials`,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      success: true,
      message: "Webmail credentials dispatched successfully",
      dispatchedAt,
    })
  } catch (error) {
    log.error({ error }, "Unhandled error in dispatch-credentials")
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
