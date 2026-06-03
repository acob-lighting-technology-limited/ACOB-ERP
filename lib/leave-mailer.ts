import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { ORG_EMAIL_SENDERS } from "@/lib/org-config"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"

export interface LeaveWorkflowEmailPayload {
  to: string[]
  subject: string
  title: string
  message: string
  ctaPath?: string
}

function buildEmailHtml(payload: Omit<LeaveWorkflowEmailPayload, "to" | "subject">) {
  const ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://erp.acoblighting.com"}${payload.ctaPath || "/leave"}`

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Leave Notification</title>" +
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
    '<div class="cta">' +
    `<a href="${ctaUrl}" class="button" style="color:#fff;">Open Leave Portal</a>` +
    "</div>" +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Admin &amp; HR Department</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

export async function sendLeaveWorkflowEmail(payload: LeaveWorkflowEmailPayload) {
  const emailEnabled = process.env.LEAVE_EMAIL_NOTIFICATIONS_ENABLED === "true"
  if (!emailEnabled) return

  const recipients = Array.from(new Set(payload.to.map((email) => email.trim().toLowerCase()).filter(Boolean)))
  if (!recipients.length) return

  await sendNotificationEmail({
    from: ORG_EMAIL_SENDERS.hr,
    to: recipients,
    subject: withSubjectPrefix("Leave", payload.subject),
    html: buildEmailHtml({ title: payload.title, message: payload.message, ctaPath: payload.ctaPath }),
  })
}
