import { Resend } from "resend"
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { resolve } from "path"

// Load .env.local without requiring dotenv as a dep
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // .env.local not found — rely on shell environment
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
  console.error("Missing env vars. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const resend = new Resend(RESEND_API_KEY)

// ACOB/2025/042 — Oluwatobi Oladele, Project dept (not exiting, test only)
const employeeName = "Oluwatobi Oladele"
const employeeFirstName = "Oluwatobi"
const department = "Project"

// Fetch dept lead for the employee's department
const { data: deptLeads } = await supabase
  .from("profiles")
  .select("company_email")
  .eq("is_department_lead", true)
  .contains("lead_departments", [department])
  .eq("employment_status", "active")
  .limit(1)
const deptLeadEmail = deptLeads?.[0]?.company_email ?? undefined
console.log("Dept lead email:", deptLeadEmail)

// Fetch Admin & HR lead
const { data: hrLeads } = await supabase
  .from("profiles")
  .select("first_name, last_name, designation, company_email")
  .eq("is_department_lead", true)
  .contains("lead_departments", ["Admin & HR"])
  .eq("employment_status", "active")
  .limit(1)
const hrLead = hrLeads?.[0]
console.log("HR lead:", hrLead ? `${hrLead.first_name} ${hrLead.last_name} — ${hrLead.designation}` : "not found")

const hodLink = deptLeadEmail
  ? `<a href="mailto:${deptLeadEmail}" style="color:#166534;font-weight:600;text-decoration:underline;">Head of Department</a>`
  : "Head of Department"
const hrLinkEl = hrLead?.company_email
  ? `<a href="mailto:${hrLead.company_email}" style="color:#166534;font-weight:600;text-decoration:underline;">HR Department</a>`
  : "HR Department"
const preparedBy = hrLead ? `${hrLead.first_name} ${hrLead.last_name}`.trim() : "HR Department"
const designation = hrLead?.designation?.trim() || ""

const html =
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

  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
  '<tr><td align="center" bgcolor="#000000" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
  '<img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
  "</td></tr></table>" +

  '<div class="wrapper">' +
  '<div class="notice-badge">Urgent Notice</div>' +
  '<div class="title">Staff Exit Notification</div>' +
  '<p class="text">Dear All,</p>' +
  `<p class="text">Management wishes to inform all staff that <strong>${employeeName}</strong> is no longer a member of staff of <strong>ACOB Lighting Technology Limited</strong>.</p>` +
  `<p class="text">Accordingly, ${employeeFirstName} is not authorised to act on behalf of the organisation in any capacity. All staff are advised to <strong>cease any work-related engagement</strong> with ${employeeFirstName} immediately and direct any outstanding official matters to the appropriate ${hodLink} or the ${hrLinkEl}.</p>` +
  `<p class="text">We wish ${employeeFirstName} well in future endeavours.</p>` +
  '<hr class="divider">' +
  '<p class="text" style="margin:0;font-size:14px;color:#6b7280;">This notice is issued by the HR Department on behalf of Management.</p>' +
  "</div>" +

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

const { data, error } = await resend.emails.send({
  from: "ACOB Admin & HR Department <notifications@acoblighting.com>",
  to: ["justilonze@gmail.com"],
  subject: "Staff Exit Notification — ACOB Lighting Technology Limited",
  html,
})

if (error) {
  console.error("Failed to send:", JSON.stringify(error, null, 2))
} else {
  console.log("Sent successfully. ID:", data?.id)
}
