import { escapeHtml } from "./utils"

const ICT_SUPPORT_EMAIL = process.env.ICT_SUPPORT_EMAIL || "ict@acoblighting.com"

export interface PendingUser {
  first_name: string
  last_name: string
  department: string
  designation: string
  company_email: string
  personal_email: string
  phone_number?: string
  office_location?: string
  residential_address?: string
}

interface WelcomeEmailProps {
  pendingUser: PendingUser
  tempPassword: string
  portalUrl: string
  preparedBy?: {
    name?: string | null
    designation?: string | null
    department?: string | null
  }
}

export function renderWelcomeEmail({ pendingUser, tempPassword, portalUrl, preparedBy }: WelcomeEmailProps) {
  const firstName = escapeHtml(pendingUser.first_name)
  const lastName = escapeHtml(pendingUser.last_name)
  const dept = escapeHtml(pendingUser.department)
  const role = escapeHtml(pendingUser.designation)
  const email = escapeHtml(pendingUser.company_email)
  const officeLoc = pendingUser.office_location ? escapeHtml(pendingUser.office_location) : "N/A"
  const safeTempPassword = escapeHtml(tempPassword)
  const safePortalUrl = escapeHtml(portalUrl)
  const preparedByName = escapeHtml((preparedBy?.name || "Admin & HR").trim())
  const preparedByDesignation = escapeHtml((preparedBy?.designation || "").trim())
  const preparedByDepartment = escapeHtml((preparedBy?.department || "Admin & HR").trim())

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to ACOB Lighting</title>
    <style>
        body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
        .email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }
        .outer-header { background: #000; padding: 20px 0; text-align: center; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }
        .wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }
        .title { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 14px; }
        .text { font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 18px 0; }
        .card { margin-top: 22px; border: 1px solid #d1d5db; overflow: hidden; background: #f9fafb; }
        .card-header { padding: 12px 18px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #d1d5db; }
        .status-header-neutral { background: #eff6ff; color: #1e40af; border-bottom-color: #bfdbfe; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 12px 18px; font-size: 14px; border-bottom: 1px solid #d1d5db; }
        tr:last-child td { border-bottom: none; }
        .label { width: 40%; color: #4b5563; font-weight: 500; border-right: 1px solid #d1d5db; }
        .value { color: #111827; font-weight: 600; }
        .credential { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; border: 1px solid #d1d5db; }
        .cta { text-align: center; margin-top: 32px; }
        .button { display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .support { text-align: center; font-size: 14px; color: #4b5563; margin-top: 24px; line-height: 1.5; }
        .support a { color: #16a34a; font-weight: 600; text-decoration: none; }
        .footer { background: #000; padding: 20px; text-align: center; font-size: 11px; color: #d1d5db; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }
        .footer strong { color: #fff; }
        .footer-system { color: #16a34a; font-weight: 600; }
        .footer-note { color: #9ca3af; font-style: italic; }
    </style>
</head>
<body>
    <div class="email-shell">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
      <tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">
        <img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="65">
      </td></tr>
    </table>
    <div class="wrapper">
        <div class="title">Welcome to the Team</div>
        <p class="text">Dear ${firstName},</p>
        <p class="text">We are thrilled to welcome you to the team at ACOB Lighting Technology Limited.</p>
        <p class="text">An official employee account has been created for you. Please find your login credentials and details below.</p>
        
        <div class="card">
            <div class="card-header status-header-neutral">Employee Profile</div>
            <table>
                <tr>
                    <td class="label">Full Name</td>
                    <td class="value">${firstName} ${lastName}</td>
                </tr>
                <tr>
                    <td class="label">Department</td>
                    <td class="value">${dept}</td>
                </tr>
                <tr>
                    <td class="label">Designation</td>
                    <td class="value">${role}</td>
                </tr>
                <tr>
                    <td class="label">Office Location</td>
                    <td class="value">${officeLoc}</td>
                </tr>
            </table>
        </div>

        <div class="card" style="margin-top: 20px;">
            <div class="card-header status-header-neutral" style="background: #f0fdf4; color: #15803d; border-bottom-color: #bbf7d0;">Login Credentials</div>
            <table>
                <tr>
                    <td class="label">Portal URL</td>
                    <td class="value"><a href="${safePortalUrl}" style="color: #16a34a; text-decoration: none;">Webmail Login</a></td>
                </tr>
                <tr>
                    <td class="label">Company Email</td>
                    <td class="value"><span class="credential">${email}</span></td>
                </tr>
                <tr>
                    <td class="label">Temporary Password</td>
                    <td class="value"><span class="credential">${safeTempPassword}</span></td>
                </tr>
            </table>
        </div>

        <div class="cta">
            <a href="${safePortalUrl}" class="button">Login to Portal</a>
        </div>
        <div class="support">
            Please log in and change your password immediately.<br>
            If you have any questions, contact <a href="mailto:${ICT_SUPPORT_EMAIL}">${ICT_SUPPORT_EMAIL}</a>
        </div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
      <tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">
        <span style="color:#f3f4f6;">Prepared by ${preparedByName}</span><br>
        ${preparedByDesignation ? `${preparedByDesignation}<br>` : ""}
        ${preparedByDepartment}<br>
        <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
        <span style="color:#16a34a;font-weight:600;">Employee Management System</span>
        <br><br>
        <i style="color:#9ca3af;font-style:italic;">This is an automated system notification. Please do not reply directly to this email.</i>
      </td></tr>
    </table>
    </div>
</body>
</html>
  `
}
