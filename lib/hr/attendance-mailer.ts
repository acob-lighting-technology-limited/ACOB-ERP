import { sendNotificationEmailsIndividuallyWithRetry } from "@/lib/notifications/email-gateway"
import { ORG_EMAIL_SENDERS } from "@/lib/org-config"

export interface AttendanceMailDetail {
  label: string
  value: string
}

export interface AttendanceMailPayload {
  to: string[]
  subject: string
  title: string
  message: string
  detailsTitle?: string
  details?: AttendanceMailDetail[]
  ctaPath?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildDetailsCard(title: string, details: AttendanceMailDetail[]): string {
  if (!details.length) return ""
  const rows = details
    .map(
      (detail) =>
        "<tr>" +
        `<td style="padding:10px 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#f3f4f6;width:38%;vertical-align:top;">${escapeHtml(
          detail.label
        )}</td>` +
        `<td style="padding:10px 18px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;vertical-align:top;line-height:1.5;">${escapeHtml(
          detail.value
        )}</td>` +
        "</tr>"
    )
    .join("")

  return (
    '<div style="margin:22px 0;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;background:#f9fafb;">' +
    `<div style="padding:12px 18px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:#f0fdf4;color:#166534;border-bottom:1px solid #d1d5db;">${escapeHtml(
      title
    )}</div>` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' +
    rows +
    "</table>" +
    "</div>"
  )
}

function buildEmailHtml(payload: Omit<AttendanceMailPayload, "to" | "subject">) {
  const ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://erp.acoblighting.com"}${payload.ctaPath || "/attendance"}`

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Attendance Notification</title>" +
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
    `<div class="title">${escapeHtml(payload.title)}</div>` +
    `<p class="text">${escapeHtml(payload.message)}</p>` +
    buildDetailsCard(payload.detailsTitle ?? "Details", payload.details ?? []) +
    '<div class="cta">' +
    `<a href="${ctaUrl}" class="button" style="color:#fff;">Open Attendance Portal</a>` +
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

export async function sendAttendanceMail(payload: AttendanceMailPayload) {
  const recipients = Array.from(new Set(payload.to.map((email) => email.trim().toLowerCase()).filter(Boolean)))
  if (!recipients.length) return

  await sendNotificationEmailsIndividuallyWithRetry({
    from: ORG_EMAIL_SENDERS.hr,
    to: recipients,
    subject: payload.subject,
    html: buildEmailHtml({
      title: payload.title,
      message: payload.message,
      detailsTitle: payload.detailsTitle,
      details: payload.details,
      ctaPath: payload.ctaPath,
    }),
  })
}
