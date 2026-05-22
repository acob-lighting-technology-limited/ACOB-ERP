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

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Help Desk Notification</title>" +
    "<style>" +
    'body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }" +
    ".wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }" +
    ".title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 14px; }" +
    ".text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; }" +
    ".cta { text-align: center; margin: 28px 0; }" +
    ".button { display: inline-block; background: #166534; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; }" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="email-shell">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    '<div class="wrapper">' +
    `<div class="title">${payload.title}</div>` +
    `<p class="text">${payload.message}</p>` +
    `<p class="text"><strong>Ticket:</strong> ${payload.ticketNumber}</p>` +
    '<div class="cta">' +
    `<a href="${ctaUrl}" class="button" style="color:#fff;">Open Help Desk</a>` +
    "</div>" +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Help Desk System</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
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
