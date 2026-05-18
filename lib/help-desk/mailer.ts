import { createClient } from "@/lib/supabase/server"
import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { ORG_PRIMARY_DOMAIN } from "@/lib/org-config"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"
import { isSystemNotificationChannelEnabled, resolveChannelEligibleUserIds } from "@/lib/notifications/delivery-policy"

interface HelpDeskMailPayload {
  userIds: string[]
  subject: string
  title: string
  message: string
  ticketNumber: string
  ctaPath?: string
}

interface MailRecipientProfile {
  id: string
  company_email: string | null
  additional_email: string | null
}

function buildEmailHtml(payload: HelpDeskMailPayload) {
  const ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://erp.acoblighting.com"}${payload.ctaPath || "/help-desk"}`

  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;">
    <h2 style="margin:0 0 12px;color:#0f172a;">${payload.title}</h2>
    <p style="margin:0 0 16px;color:#334155;line-height:1.6;">${payload.message}</p>
    <p style="margin:0 0 20px;color:#0f172a;"><strong>Ticket:</strong> ${payload.ticketNumber}</p>
    <a href="${ctaUrl}" style="display:inline-block;background:#166534;color:#fff;padding:10px 14px;text-decoration:none;border-radius:8px;">Open Help Desk</a>
  </div>
  `
}

export async function sendHelpDeskMail(payload: HelpDeskMailPayload) {
  // Temporarily disabled during ERP stabilization/testing.
  if (process.env.HELP_DESK_EMAIL_ENABLED !== "true") return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const overrideRecipient = process.env.HELP_DESK_TEST_RECIPIENT?.trim().toLowerCase()
  if (overrideRecipient) {
    const supabase = await createClient()
    const systemEnabled = await isSystemNotificationChannelEnabled(supabase, "help_desk", "email")
    if (!systemEnabled) return

    await sendNotificationEmail({
      from: `ACOB Help Desk <notifications@${ORG_PRIMARY_DOMAIN}>`,
      to: [overrideRecipient],
      subject: withSubjectPrefix("Help Desk", payload.subject),
      html: buildEmailHtml(payload),
    })
    return
  }

  const uniqueIds = Array.from(new Set(payload.userIds.filter(Boolean)))
  if (!uniqueIds.length) return

  const supabase = await createClient()
  const allowedUserIds = await resolveChannelEligibleUserIds(supabase, {
    userIds: uniqueIds,
    notificationKey: "help_desk",
    channel: "email",
  })
  if (!allowedUserIds.length) return

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, company_email, additional_email")
    .in("id", allowedUserIds)

  const recipients = Array.from(
    new Set(
      (profiles || [])
        .flatMap((profile: MailRecipientProfile) => [profile.company_email, profile.additional_email])
        .filter((email): email is string => typeof email === "string" && email.trim().length > 0)
        .map((email: string) => email.toLowerCase())
    )
  )

  if (!recipients.length) return

  await sendNotificationEmail({
    from: `ACOB Help Desk <notifications@${ORG_PRIMARY_DOMAIN}>`,
    to: recipients,
    subject: withSubjectPrefix("Help Desk", payload.subject),
    html: buildEmailHtml(payload),
  })
}
