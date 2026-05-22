import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { ORG_PRIMARY_DOMAIN } from "@/lib/org-config"
import { logger } from "@/lib/logger"

const log = logger("hr-exit-mailer")

export interface ExitNotificationPayload {
  employeeFullName: string
  employeeFirstName: string
  department: string
  recipients: string[]
  deptLeadEmail?: string
  hrLeadName?: string
  hrLeadDesignation?: string
  hrLeadEmail?: string
}

function buildExitEmailHtml(payload: ExitNotificationPayload): string {
  const {
    employeeFullName: employeeName,
    employeeFirstName,
    department,
    deptLeadEmail,
    hrLeadName,
    hrLeadDesignation,
    hrLeadEmail,
  } = payload
  const hodLink = deptLeadEmail
    ? `<a href="mailto:${deptLeadEmail}" style="color:#166534;font-weight:600;text-decoration:underline;">Head of Department</a>`
    : "Head of Department"
  const hrLink = hrLeadEmail
    ? `<a href="mailto:${hrLeadEmail}" style="color:#166534;font-weight:600;text-decoration:underline;">HR Department</a>`
    : "HR Department"
  const preparedBy = hrLeadName?.trim() || "HR Department"
  const designation = hrLeadDesignation?.trim() || ""
  return buildExitEmailHtmlInner(employeeName, employeeFirstName, hodLink, hrLink, preparedBy, designation)
}

function buildExitEmailHtmlInner(
  employeeName: string,
  employeeFirstName: string,
  hodLink: string,
  hrLink: string,
  preparedBy: string,
  designation: string
): string {
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
    '<img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    // Body
    '<div class="wrapper">' +
    '<div class="notice-badge">Urgent Notice</div>' +
    '<div class="title">Staff Exit Notification</div>' +
    '<p class="text">Dear All,</p>' +
    `<p class="text">Management wishes to inform all staff that <strong>${employeeName}</strong> is no longer a member of staff of <strong>ACOB Lighting Technology Limited</strong>.</p>` +
    `<p class="text">Accordingly, ${employeeFirstName} is not authorised to act on behalf of the organisation in any capacity. All staff are advised to <strong>cease any work-related engagement</strong> with ${employeeFirstName} immediately and direct any outstanding official matters to the appropriate ${hodLink} or the ${hrLink}.</p>` +
    `<p class="text">We wish ${employeeFirstName} well in future endeavours.</p>` +
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

export async function sendExitNotificationEmail(payload: ExitNotificationPayload): Promise<void> {
  const { employeeFullName, recipients } = payload

  if (!recipients.length) {
    log.warn("sendExitNotificationEmail called with no recipients — skipping")
    return
  }

  try {
    await sendNotificationEmail({
      from: `ACOB HR Department <notifications@${ORG_PRIMARY_DOMAIN}>`,
      to: recipients,
      subject: "Staff Exit Notification — ACOB Lighting Technology Limited",
      html: buildExitEmailHtml(payload),
    })
    log.info({ employeeFullName, recipientCount: recipients.length }, "Exit notification email sent")
  } catch (error) {
    log.error({ error, employeeFullName }, "Failed to send exit notification email")
  }
}
