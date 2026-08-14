import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"
import { renderPasswordChangedEmail } from "@/lib/email-templates/password-changed"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { writeLoginLog, REAUTH_SOURCE } from "@/lib/auth/login-log"

const log = logger("change-password")

export async function POST(req: Request) {
  const ipAddress =
    (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "").split(",")[0].trim() || null

  const rl = await rateLimit(`change-password:${getClientId(req)}`, { limit: 5, windowSec: 900 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { currentPassword, newPassword } = await req.json()

    if (!newPassword || typeof newPassword !== "string") {
      return NextResponse.json({ error: "New password is required" }, { status: 400 })
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters long" }, { status: 400 })
    }

    // Verify current password if provided
    if (currentPassword && typeof currentPassword === "string") {
      if (user.email) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        })

        if (signInError) {
          return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
        }

        // Supabase records this verification as a `login` in
        // auth.audit_log_entries even though the user never signed in. Tag a
        // matching row so reconciliation can tell it apart from a real login.
        await writeLoginLog({
          supabase,
          headers: req.headers,
          userId: user.id,
          authMethod: "password",
          source: REAUTH_SOURCE,
          userEmail: user.email,
        })
      }
    }

    // Update the password for the current user
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      log.error({ err: updateError.message }, "Failed to update password in Supabase Auth")
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    // Fetch user profile details for email recipient name/address
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_email, personal_email, first_name, last_name, full_name")
      .eq("id", user.id)
      .single()

    const recipientEmail = profile?.company_email || profile?.personal_email || user.email

    // Send confirmation email
    if (recipientEmail) {
      const changeTimeFormatted = new Date().toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Lagos",
      })

      const recipientName =
        profile?.full_name || `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || user.email || "User"

      try {
        await sendNotificationEmail({
          to: [recipientEmail],
          subject: withSubjectPrefix("Security", "Your ACOB Account Password Has Been Changed"),
          html: renderPasswordChangedEmail({
            userName: recipientName,
            userEmail: recipientEmail,
            changeTime: `${changeTimeFormatted} (WAT)`,
            ipAddress,
          }),
        })
      } catch (emailErr) {
        log.warn({ err: String(emailErr) }, "Failed to send password changed email notification")
      }
    }

    // Send in-app notification
    try {
      await supabase.rpc("create_notification", {
        p_user_id: user.id,
        p_type: "security_alert",
        p_category: "security",
        p_title: "Password Changed",
        p_message: "Your account password was updated successfully.",
        p_priority: "high",
        p_link_url: "/settings/security",
        p_actor_id: user.id,
        p_entity_type: "user",
        p_entity_id: user.id,
      })
    } catch (notifErr) {
      log.warn({ err: String(notifErr) }, "Failed to write in-app notification for password change")
    }

    // Write audit log
    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "auth_user",
        entityId: user.id,
        context: { actorId: user.id, source: "api" },
        metadata: { action: "password_change", ipAddress },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true, message: "Password updated successfully" })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Password change handler error")
    return NextResponse.json({ error: "An unexpected error occurred while updating password" }, { status: 500 })
  }
}
