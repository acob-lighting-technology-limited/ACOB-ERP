import { sendNotificationEmailsIndividuallyWithRetry } from "@/lib/notifications/email-gateway"
import { ORG_EMAIL_SENDERS, ORG_MAIL_ROUTING } from "@/lib/org-config"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"

export interface LeaveWorkflowDetail {
  label: string
  value: string
}

export type LeaveBadgeVariant = "success" | "warning" | "destructive" | "info" | "default"

export interface LeaveWorkflowEmailPayload {
  to: string[]
  subject: string
  title: string
  message: string
  badgeText?: string
  badgeVariant?: LeaveBadgeVariant
  detailsTitle?: string
  details?: LeaveWorkflowDetail[]
  ctaPath?: string
  ctaLabel?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getBadgeStyle(variant?: LeaveBadgeVariant): string {
  switch (variant) {
    case "success":
      return "background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;"
    case "destructive":
      return "background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;"
    case "warning":
      return "background: #fef3c7; color: #92400e; border: 1px solid #fde68a;"
    case "info":
      return "background: #e0f2fe; color: #075985; border: 1px solid #bae6fd;"
    default:
      return "background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb;"
  }
}

function buildDetailsCard(title: string, details?: LeaveWorkflowDetail[]): string {
  if (!details || !details.length) return ""

  const rows = details
    .map(
      (detail) =>
        "<tr>" +
        `<td style="padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#f9fafb;width:36%;vertical-align:top;">${escapeHtml(
          detail.label
        )}</td>` +
        `<td style="padding:10px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;vertical-align:top;line-height:1.5;">${escapeHtml(
          detail.value
        )}</td>` +
        "</tr>"
    )
    .join("")

  return (
    '<div style="margin:22px 0;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;background:#ffffff;">' +
    `<div style="padding:11px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:#f0fdf4;color:#166534;border-bottom:1px solid #d1d5db;">${escapeHtml(
      title
    )}</div>` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' +
    rows +
    "</table>" +
    "</div>"
  )
}

function buildEmailHtml(payload: Omit<LeaveWorkflowEmailPayload, "to" | "subject">) {
  const ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://matrix.acoblighting.com"}${payload.ctaPath || "/leave"}`
  const buttonLabel = payload.ctaLabel || "Open Leave Portal"

  const badgeHtml = payload.badgeText
    ? `<div style="display:inline-block;padding:4px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-radius:20px;margin-bottom:14px;${getBadgeStyle(
        payload.badgeVariant
      )}">${escapeHtml(payload.badgeText)}</div><br>`
    : ""

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
    '<img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    '<div class="wrapper">' +
    badgeHtml +
    `<div class="title">${escapeHtml(payload.title)}</div>` +
    `<p class="text">${escapeHtml(payload.message)}</p>` +
    buildDetailsCard(payload.detailsTitle || "Leave Details", payload.details) +
    '<div class="cta">' +
    `<a href="${ctaUrl}" class="button" style="color:#fff;">${escapeHtml(buttonLabel)}</a>` +
    "</div>" +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Admin &amp; HR Department</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated notification, but replies are read — reply to this email and it reaches the team that sent it.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

export async function sendLeaveWorkflowEmail(payload: LeaveWorkflowEmailPayload) {
  // Allow disabling via explicit 'false' setting; default is enabled when email service is configured
  if (process.env.LEAVE_EMAIL_NOTIFICATIONS_ENABLED === "false") return

  const recipients = Array.from(new Set(payload.to.map((email) => email.trim().toLowerCase()).filter(Boolean)))
  if (!recipients.length) return

  await sendNotificationEmailsIndividuallyWithRetry({
    from: ORG_EMAIL_SENDERS.system,
    ...ORG_MAIL_ROUTING["Leave"],
    to: recipients,
    subject: withSubjectPrefix("Leave", payload.subject),
    html: buildEmailHtml({
      title: payload.title,
      message: payload.message,
      badgeText: payload.badgeText,
      badgeVariant: payload.badgeVariant,
      detailsTitle: payload.detailsTitle,
      details: payload.details,
      ctaPath: payload.ctaPath,
      ctaLabel: payload.ctaLabel,
    }),
  })
}
