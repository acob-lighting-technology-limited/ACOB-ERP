// Branded ACOB email shell for meeting-artifact emails, matching the visual
// language used by send-meeting-reminder (black header/footer, green borders,
// ACOB logo, 600px wrapper).

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function buildArtifactEmailHtml(params: {
  meetingLabel: string
  files: string[]
  intro?: string
}): string {
  const label = escapeHtml(params.meetingLabel)
  const intro =
    params.intro ||
    `Please find the attendance and transcript for the <strong>${label}</strong> attached to this email.`

  const fileRows = params.files
    .map(
      (f) =>
        '<tr><td style="padding:10px 18px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">' +
        `<span style="display:inline-block;margin-right:8px;">📎</span>${escapeHtml(f)}` +
        "</td></tr>"
    )
    .join("")

  return (
    "<!DOCTYPE html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<style>" +
    'body { margin:0; padding:0; background:#fff; font-family:"Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".wrapper { max-width:600px; margin:0 auto; background:#fff; padding:32px 28px; }" +
    ".title { font-size:20px; font-weight:700; color:#111827; margin:0 0 6px; }" +
    ".text { font-size:14px; color:#374151; line-height:1.6; margin:0 0 16px; }" +
    ".card { margin:22px 0; border:1px solid #d1d5db; overflow:hidden; background:#f9fafb; border-radius:8px; }" +
    ".card-header { padding:12px 18px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #d1d5db; background:#ecfdf5; color:#065f46; }" +
    "</style></head><body>" +
    '<div style="background:#f3f4f6;padding:24px 0;">' +
    // Header
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;">' +
    '<tr><td align="center" style="padding:20px 0;background:#000000 !important;">' +
    '<img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="60" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    // Body
    '<div class="wrapper">' +
    `<div class="title">${label}</div>` +
    `<p class="text">${intro}</p>` +
    '<div class="card">' +
    '<div class="card-header">Attached documents</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    fileRows +
    "</table></div>" +
    '<p class="text" style="color:#6b7280;font-size:13px;">These documents are also stored in the ERP under Reports &rsaquo; General Meeting &rsaquo; Meeting Records.</p>' +
    "</div>" +
    // Footer
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;">' +
    '<tr><td align="center" style="padding:20px;background:#000000 !important;font-size:11px;color:#d1d5db;">' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Meeting Records System</span><br><br>' +
    '<i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i>' +
    "</td></tr></table>" +
    "</div></body></html>"
  )
}
