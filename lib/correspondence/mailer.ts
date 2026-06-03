import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { ORG_EMAIL_SENDERS } from "@/lib/org-config"

export interface CorrespondenceApprovalEmailPayload {
  to: string[]
  referenceNumber: string
  subject: string
  approverName: string
  letterType?: string | null
  ctaPath?: string
}

export type CorrespondenceDecision = "approved" | "rejected" | "returned_for_correction"

export interface CorrespondenceDecisionEmailPayload extends CorrespondenceApprovalEmailPayload {
  decision: CorrespondenceDecision
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getTypeLabel(letterType?: string | null) {
  return (letterType || "external").toLowerCase() === "internal" ? "Internal" : "External"
}

function getDecisionLabel(decision: CorrespondenceDecision) {
  if (decision === "returned_for_correction") return "Returned for Correction"
  return decision.charAt(0).toUpperCase() + decision.slice(1)
}

function getDecisionMessage(decision: CorrespondenceDecision) {
  if (decision === "approved") return "approved"
  if (decision === "rejected") return "rejected"
  return "returned for correction"
}

function getDecisionHeaderStyle(decision: CorrespondenceDecision) {
  if (decision === "approved") return "background: #f0fdf4; color: #166534;"
  if (decision === "rejected") return "background: #fef2f2; color: #991b1b;"
  return "background: #fffbeb; color: #92400e;"
}

function getDecisionButtonColor(decision: CorrespondenceDecision) {
  if (decision === "approved") return "#16a34a"
  if (decision === "rejected") return "#dc2626"
  return "#d97706"
}

function buildHtml(payload: Omit<CorrespondenceDecisionEmailPayload, "to">) {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL || "https://erp.acoblighting.com"}${payload.ctaPath || "/correspondence"}`
  const ref = escapeHtml(payload.referenceNumber)
  const subj = escapeHtml(payload.subject)
  const approver = escapeHtml(payload.approverName)
  const typeLabel = getTypeLabel(payload.letterType)
  const decisionLabel = getDecisionLabel(payload.decision)
  const decisionMessage = getDecisionMessage(payload.decision)
  const decisionHeaderStyle = getDecisionHeaderStyle(payload.decision)
  const decisionButtonColor = getDecisionButtonColor(payload.decision)

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    `<title>Correspondence ${decisionLabel}</title>` +
    "<style>" +
    'body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }" +
    ".wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }" +
    ".title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 14px; }" +
    ".text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; }" +
    ".card { margin: 22px 0; border: 1px solid #d1d5db; overflow: hidden; background: #f9fafb; border-radius: 8px; }" +
    ".card-header { padding: 12px 18px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #d1d5db; }" +
    ".card-row { padding: 12px 18px; font-size: 14px; color: #374151; border-bottom: 1px solid #e5e7eb; }" +
    ".card-row:last-child { border-bottom: none; }" +
    ".card-label { font-weight: 600; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }" +
    ".cta { text-align: center; margin: 28px 0; }" +
    ".button { display: inline-block; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; }" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="email-shell">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    '<div class="wrapper">' +
    '<div class="title">' +
    typeLabel +
    " Correspondence " +
    decisionLabel +
    "</div>" +
    '<p class="text">Your correspondence has been reviewed and <strong>' +
    decisionMessage +
    "</strong> by <strong>" +
    approver +
    "</strong>. Your <strong>" +
    typeLabel.toLowerCase() +
    "</strong> correspondence is now ready to proceed.</p>" +
    '<div class="card">' +
    `<div class="card-header" style="${decisionHeaderStyle}">Reference Details</div>` +
    '<div class="card-row"><div class="card-label">Reference Number</div>' +
    ref +
    "</div>" +
    '<div class="card-row"><div class="card-label">Subject</div>' +
    subj +
    "</div>" +
    '<div class="card-row"><div class="card-label">Reviewed By</div>' +
    approver +
    "</div>" +
    "</div>" +
    '<div class="cta">' +
    '<a href="' +
    url +
    `" class="button" style="background: ${decisionButtonColor}; color: #fff;">Open Correspondence Portal</a>` +
    "</div>" +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Correspondence Management System</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated notification. Please do not reply directly to this email.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

export async function sendCorrespondenceApprovalEmail(payload: CorrespondenceApprovalEmailPayload) {
  await sendCorrespondenceDecisionEmail({ ...payload, decision: "approved" })
}

export async function sendCorrespondenceDecisionEmail(payload: CorrespondenceDecisionEmailPayload) {
  const recipients = Array.from(new Set(payload.to.map((e) => e.trim().toLowerCase()).filter(Boolean)))
  if (!recipients.length) return
  const typeLabel = getTypeLabel(payload.letterType)
  const decisionLabel = getDecisionLabel(payload.decision)
  await sendNotificationEmail({
    from: ORG_EMAIL_SENDERS.correspondence,
    to: recipients,
    subject: `${typeLabel} Correspondence ${decisionLabel}: ${payload.referenceNumber}`,
    html: buildHtml(payload),
  })
}
