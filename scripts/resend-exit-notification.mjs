// One-off: resend the 30-May-2026 exit notification to the 6 additional emails that were missed.
// Usage: node scripts/resend-exit-notification.mjs
import fs from "node:fs"
import path from "node:path"
import { Resend } from "resend"

const envPath = path.join(process.cwd(), ".env.local")
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const ADDITIONAL_EMAILS = [
  "legal@acoblighting.com",
  "businessgrowth@acoblighting.com",
  "ict@acoblighting.com",
  "infoacob@gmail.com",
  "acobacct@gmail.com",
  "acobhrdesk@gmail.com",
]

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Staff Exit Notification</title><style>body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }.email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }.wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }.notice-badge { display: inline-block; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 5px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 20px; }.title { font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 20px 0; }.text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; }.divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }</style></head><body><div class="email-shell"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;"><tr><td align="center" bgcolor="#000000" style="padding:20px 0;background:#000000 !important;"><img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting"></td></tr></table><div class="wrapper"><div class="notice-badge">Staff Notice</div><div class="title">Staff Exit Notification</div><p class="text">Dear All,</p><p class="text">Management wishes to inform all staff that the following individuals are no longer members of staff of <strong>ACOB Lighting Technology Limited</strong>.</p><div style="margin:24px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#f9fafb;"><div style="padding:10px 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:#fef2f2;color:#991b1b;border-bottom:1px solid #fecaca;">Exited Staff</div><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#f3f4f6;">Name</th><th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;background:#f3f4f6;">Department</th></tr></thead><tbody><tr><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">Oluwatobi Oladele</td><td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">Project</td></tr><tr><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">Taiwo Peter</td><td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">Regulatory and Compliance</td></tr><tr><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">Kennedy Odenigbo</td><td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">Technical</td></tr></tbody></table></div><p class="text">Accordingly, they are not authorised to act on behalf of the organisation in any capacity. All staff are advised to <strong>cease any work-related engagement</strong> with them immediately and direct any outstanding official matters to the appropriate Head of Department or the <a href="mailto:a.onyekachukwu@org.acoblighting.com" style="color:#166534;font-weight:600;text-decoration:underline;">HR Department</a>.</p><p class="text">We wish them well in their future endeavours.</p><hr class="divider"><p class="text" style="margin:0;font-size:14px;color:#6b7280;">This notice is issued by the HR Department on behalf of Management.</p></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;"><tr><td align="center" bgcolor="#000000" style="padding:20px;background:#000000 !important;font-size:11px;color:#d1d5db;"><span style="color:#f3f4f6;">Prepared by Onyekachukwu Atishie</span><br>Senior Admin/HR<br>Admin &amp; HR Department<br><strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br><span style="color:#16a34a;font-weight:600;">HR Department</span><br><br><i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i></td></tr></table></div></body></html>`

const resend = new Resend(process.env.RESEND_API_KEY)
const from = "ACOB HR Department <notifications@acoblighting.com>"
const subject = "Staff Exit Notification (3 staff) — ACOB Lighting Technology Limited"

for (const to of ADDITIONAL_EMAILS) {
  const { data, error } = await resend.emails.send({ from, to: [to], subject, html: HTML })
  if (error) {
    console.error(`FAILED  ${to}:`, error.message)
  } else {
    console.log(`SENT    ${to} -> id: ${data?.id}`)
  }
}
