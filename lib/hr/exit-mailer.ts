import { sendNotificationEmailsIndividuallyWithRetry } from "@/lib/notifications/email-gateway"
import { ORG_EMAIL_SENDERS } from "@/lib/org-config"
import { logger } from "@/lib/logger"

const log = logger("hr-exit-mailer")

export interface ExitedEmployee {
  fullName: string
  firstName: string
  department: string
  exitDate?: string // ISO date string e.g. "2026-05-29"
}

export interface ExitNotificationPayload {
  employees: ExitedEmployee[]
  recipients: string[]
  deptLeadEmail?: string
  hrLeadName?: string
  hrLeadDesignation?: string
  hrLeadEmail?: string
  from?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  } catch {
    return iso
  }
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildExitEmailHtml(payload: ExitNotificationPayload): string {
  const { employees, deptLeadEmail, hrLeadName, hrLeadDesignation, hrLeadEmail } = payload
  const isBulk = employees.length > 1

  const hodLink = deptLeadEmail
    ? `<a href="mailto:${deptLeadEmail}" style="color:#166534;font-weight:600;text-decoration:underline;">Head of Department</a>`
    : "Head of Department"
  const hrLink = hrLeadEmail
    ? `<a href="mailto:${hrLeadEmail}" style="color:#166534;font-weight:600;text-decoration:underline;">HR Department</a>`
    : "HR Department"
  const preparedBy = hrLeadName?.trim() || "HR Department"
  const designation = hrLeadDesignation?.trim() || ""

  // ── Opening sentence ──
  let openingSentence: string
  if (isBulk) {
    openingSentence = `<p class="text">Management wishes to inform all staff that the following individuals are no longer members of staff of <strong>ACOB Lighting Technology Limited</strong>.</p>`
  } else {
    openingSentence = `<p class="text">Management wishes to inform all staff that <strong>${employees[0].fullName}</strong> is no longer a member of staff of <strong>ACOB Lighting Technology Limited</strong>.</p>`
  }

  // ── Staff table (always shown for bulk; hidden for single) ──
  let staffTable = ""
  if (isBulk) {
    const rows = employees
      .map(
        (e) =>
          `<tr>` +
          `<td style="padding:10px 14px;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">${e.fullName}</td>` +
          `<td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">${e.department}</td>` +
          `</tr>`
      )
      .join("")

    staffTable =
      `<div style="margin:24px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#f9fafb;">` +
      `<div style="padding:10px 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:#fef2f2;color:#991b1b;border-bottom:1px solid #fecaca;">Exited Staff</div>` +
      `<table style="width:100%;border-collapse:collapse;">` +
      `<thead><tr>` +
      `<th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#f3f4f6;">Name</th>` +
      `<th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;background:#f3f4f6;">Department</th>` +
      `</tr></thead>` +
      `<tbody>${rows}</tbody>` +
      `</table></div>`
  }

  // ── Body paragraphs ──
  let body2: string
  let body3: string
  if (isBulk) {
    body2 = `<p class="text">Accordingly, they are not authorised to act on behalf of the organisation in any capacity. All staff are advised to <strong>cease any work-related engagement</strong> with them immediately and direct any outstanding official matters to the appropriate ${hodLink} or the ${hrLink}.</p>`
    body3 = `<p class="text">We wish them well in their future endeavours.</p>`
  } else {
    const { firstName } = employees[0]
    body2 = `<p class="text">Accordingly, ${firstName} is not authorised to act on behalf of the organisation in any capacity. All staff are advised to <strong>cease any work-related engagement</strong> with ${firstName} immediately and direct any outstanding official matters to the appropriate ${hodLink} or the ${hrLink}.</p>`
    body3 = `<p class="text">We wish ${firstName} well in future endeavours.</p>`
  }

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Staff Exit Notification</title>" +
    "<style>" +
    'body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }" +
    ".wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }" +
    ".notice-badge { display: inline-block; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 5px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 20px; }" +
    ".title { font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 20px 0; }" +
    ".text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; }" +
    ".divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="email-shell">' +
    // Header
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    // Body
    '<div class="wrapper">' +
    '<div class="notice-badge">Staff Notice</div>' +
    '<div class="title">Staff Exit Notification</div>' +
    '<p class="text">Dear All,</p>' +
    openingSentence +
    staffTable +
    body2 +
    body3 +
    '<hr class="divider">' +
    '<p class="text" style="margin:0;font-size:14px;color:#6b7280;">This notice is issued by the HR Department on behalf of Management.</p>' +
    "</div>" +
    // Footer
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    `<span style="color:#f3f4f6;">Prepared by ${preparedBy}</span><br>` +
    (designation ? `${designation}<br>` : "") +
    "Admin &amp; HR Department<br>" +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">HR Department</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

// ─── Public function ──────────────────────────────────────────────────────────

export async function sendExitNotificationEmail(payload: ExitNotificationPayload): Promise<void> {
  const { employees, recipients } = payload

  if (!recipients.length) {
    log.warn("sendExitNotificationEmail called with no recipients — skipping")
    return
  }

  const names = employees.map((e) => e.fullName).join(", ")
  const isBulk = employees.length > 1
  const html = buildExitEmailHtml(payload)
  const subject = isBulk
    ? `Staff Exit Notification (${employees.length} staff) — ACOB Lighting Technology Limited`
    : "Staff Exit Notification — ACOB Lighting Technology Limited"

  try {
    const result = await sendNotificationEmailsIndividuallyWithRetry({
      from: payload.from ?? ORG_EMAIL_SENDERS.hr,
      to: recipients,
      subject,
      html,
    })
    log.info(
      { names, delivered: result.deliveredRecipients.length, failed: result.failedRecipients.length },
      "Exit notification emails sent"
    )
    if (result.failedRecipients.length > 0) {
      log.warn({ failed: result.failedRecipients }, "Some exit notification emails failed to deliver")
    }
  } catch (error) {
    log.error({ error, names }, "Failed to send exit notification emails")
  }
}
