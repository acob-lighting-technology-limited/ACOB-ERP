import { escapeHtml } from "./utils"

const ICT_SUPPORT_EMAIL = process.env.ICT_SUPPORT_EMAIL || "ict@acoblighting.com"
const WEBMAIL_LOGIN_URL = "https://webmail-p21.web-hosting.com/"
const MATRIX_PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "https://matrix.acoblighting.com"

export interface PendingUser {
  first_name: string
  last_name: string
  department: string
  designation: string
  company_email: string
  personal_email: string
  employee_number?: string
  phone_number?: string
  office_location?: string
  residential_address?: string
}

interface WelcomeEmailProps {
  pendingUser: PendingUser
  tempPassword: string
  portalUrl?: string
  webmailUrl?: string
  preparedBy?: {
    name?: string | null
    designation?: string | null
    department?: string | null
  }
}

export function renderWelcomeEmail({
  pendingUser,
  tempPassword,
  portalUrl = MATRIX_PORTAL_URL,
  webmailUrl = WEBMAIL_LOGIN_URL,
  preparedBy,
}: WelcomeEmailProps) {
  const firstName = escapeHtml(pendingUser.first_name)
  const lastName = escapeHtml(pendingUser.last_name)
  const dept = escapeHtml(pendingUser.department)
  const role = escapeHtml(pendingUser.designation)
  const email = escapeHtml(pendingUser.company_email)
  const staffId = pendingUser.employee_number ? escapeHtml(pendingUser.employee_number) : null
  const officeLoc = pendingUser.office_location ? escapeHtml(pendingUser.office_location) : "N/A"
  const safeTempPassword = escapeHtml(tempPassword)
  const safeWebmailUrl = escapeHtml(webmailUrl)
  const safePortalUrl = escapeHtml(portalUrl)
  const safeSetupUrl = escapeHtml(`${portalUrl}/auth/setup-account`)
  const safeLoginUrl = escapeHtml(`${portalUrl}/auth/login`)
  const preparedByName = escapeHtml((preparedBy?.name || "Admin & IT Team").trim())
  const preparedByDesignation = escapeHtml((preparedBy?.designation || "").trim())
  const preparedByDepartment = escapeHtml((preparedBy?.department || "Admin and HR").trim())

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to ACOB Lighting - Account Onboarding</title>
    <style>
        body { margin: 0; padding: 0; background: #f3f4f6; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
        .email-shell { max-width: 620px; margin: 20px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .wrapper { padding: 32px 28px; }
        .title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 12px; }
        .text { font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 16px 0; }
        
        .card { margin-top: 18px; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; background: #ffffff; }
        .card-header { padding: 10px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
        .card-header-neutral { background: #f8fafc; color: #475569; border-bottom: 1px solid #e2e8f0; }
        .card-header-step1 { background: #eff6ff; color: #1e40af; border-bottom: 1px solid #bfdbfe; }
        .card-header-step2 { background: #f0fdf4; color: #166534; border-bottom: 1px solid #bbf7d0; }
        
        table { width: 100%; border-collapse: collapse; }
        td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        tr:last-child td { border-bottom: none; }
        .label { width: 38%; color: #64748b; font-weight: 500; border-right: 1px solid #f1f5f9; }
        .value { color: #0f172a; font-weight: 600; }
        .credential { background: #f1f5f9; padding: 3px 8px; border-radius: 4px; font-family: monospace; font-size: 13px; border: 1px solid #cbd5e1; color: #0f172a; }
        
        .step-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase; margin-right: 6px; }
        .tag-blue { background: #dbeafe; color: #1e40af; }
        .tag-green { background: #dcfce7; color: #15803d; }
        
        .cta-btn { display: inline-block; background: #16a34a; color: #ffffff !important; text-decoration: none; padding: 10px 22px; border-radius: 6px; font-weight: 600; font-size: 13px; margin-top: 10px; }
        .cta-btn-dark { display: inline-block; background: #0f172a; color: #ffffff !important; text-decoration: none; padding: 10px 22px; border-radius: 6px; font-weight: 600; font-size: 13px; margin-top: 10px; }
        
        .instruction-list { margin: 10px 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6; }
        .instruction-list li { margin-bottom: 6px; }
        
        .quick-links { margin-top: 24px; padding: 16px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; }
        .quick-links-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .links-grid { font-size: 12px; color: #475569; line-height: 1.8; }
        .links-grid a { color: #16a34a; text-decoration: none; font-weight: 600; }
        
        .support { text-align: center; font-size: 13px; color: #64748b; margin-top: 24px; line-height: 1.5; }
        .support a { color: #16a34a; font-weight: 600; text-decoration: none; }
        
        .footer { background: #000000; padding: 22px 20px; text-align: center; font-size: 11px; color: #d1d5db; border-top: 3px solid #16a34a; }
        .footer strong { color: #ffffff; }
        .footer-system { color: #16a34a; font-weight: 600; }
        .footer-note { color: #9ca3af; font-style: italic; margin-top: 10px; display: block; }
    </style>
</head>
<body>
    <div class="email-shell">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;">
          <tr><td align="center" style="padding:22px 0;background:#000000 !important;">
            <img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="60">
          </td></tr>
        </table>

        <div class="wrapper">
            <div class="title">Welcome to the Team!</div>
            <p class="text">Dear <strong>${firstName}</strong>,</p>
            <p class="text">We are excited to welcome you to <strong>ACOB Lighting Technology Limited</strong>. Your official company profile has been created.</p>
            <p class="text">Please follow the <strong>two steps below</strong> in order to access your company email and activate your Matrix ERP account.</p>
            
            <!-- Employee Profile Summary -->
            <div class="card">
                <div class="card-header card-header-neutral">Employee Profile</div>
                <table>
                    <tr>
                        <td class="label">Full Name</td>
                        <td class="value">${firstName} ${lastName}</td>
                    </tr>
                    ${staffId ? `<tr><td class="label">Staff ID</td><td class="value">${staffId}</td></tr>` : ""}
                    <tr>
                        <td class="label">Department</td>
                        <td class="value">${dept}</td>
                    </tr>
                    <tr>
                        <td class="label">Designation</td>
                        <td class="value">${role}</td>
                    </tr>
                    <tr>
                        <td class="label">Office / Room</td>
                        <td class="value">${officeLoc}</td>
                    </tr>
                </table>
            </div>

            <!-- STEP 1: Webmail Login -->
            <div class="card" style="margin-top: 20px; border-color: #bfdbfe;">
                <div class="card-header card-header-step1">
                    <span class="step-tag tag-blue">Step 1</span> Access Your Official Company Webmail (Do this first)
                </div>
                <div style="padding: 14px 16px;">
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #334155; line-height: 1.5;">
                        Your official corporate mailbox has been provisioned. <strong>Log in here first</strong>, as your Matrix ERP activation verification code and company announcements will be delivered to this inbox:
                    </p>
                    <table>
                        <tr>
                            <td class="label">Webmail URL</td>
                            <td class="value"><a href="${safeWebmailUrl}" style="color: #1e40af; text-decoration: none;">${safeWebmailUrl}</a></td>
                        </tr>
                        <tr>
                            <td class="label">Company Email</td>
                            <td class="value"><span class="credential">${email}</span></td>
                        </tr>
                        <tr>
                            <td class="label">Initial Password</td>
                            <td class="value"><span class="credential">${safeTempPassword}</span></td>
                        </tr>
                    </table>
                    <div style="text-align: center; margin-top: 14px;">
                        <a href="${safeWebmailUrl}" class="cta-btn-dark">👉 Log into Webmail</a>
                    </div>
                    <p style="margin: 10px 0 0 0; font-size: 11px; color: #64748b; font-style: italic; text-align: center;">
                        * Please update your Webmail password upon your initial login.
                    </p>
                </div>
            </div>

            <!-- STEP 2: Matrix ERP Activation -->
            <div class="card" style="margin-top: 20px; border-color: #bbf7d0;">
                <div class="card-header card-header-step2">
                    <span class="step-tag tag-green">Step 2</span> Activate Your Matrix ERP Account
                </div>
                <div style="padding: 14px 16px;">
                    <p style="margin: 0 0 10px 0; font-size: 13px; color: #334155; line-height: 1.5;">
                        Once you have accessed your Webmail, activate your account on the Matrix ERP employee portal:
                    </p>
                    <ol class="instruction-list">
                        <li>Visit the Setup Link: <a href="${safeSetupUrl}" style="color: #16a34a; font-weight: 600; text-decoration: none;">${safeSetupUrl}</a></li>
                        <li>Enter your company email: <code style="background: #f1f5f9; padding: 1px 5px; border-radius: 3px;">${email}</code> and click <strong>Set Up</strong>.</li>
                        <li>Check your <strong>Webmail</strong> (from Step 1) for the <strong>6-digit verification code</strong>.</li>
                        <li>Enter the 6-digit code on screen, click <strong>Verify and Continue</strong>, and set your new secure password.</li>
                        <li>Log in to Matrix anytime at <a href="${safeLoginUrl}" style="color: #16a34a; text-decoration: none;">${safeLoginUrl}</a>.</li>
                    </ol>
                    <div style="text-align: center; margin-top: 14px;">
                        <a href="${safeSetupUrl}" class="cta-btn">👉 Activate Matrix Account</a>
                    </div>
                </div>
            </div>

            <!-- Quick Access Links -->
            <div class="quick-links">
                <div class="quick-links-title">📌 Quick Access: Key Routes</div>
                <div class="links-grid">
                    • <strong>Welcome & Launch Presentation:</strong> <a href="${safePortalUrl}/launch">${safePortalUrl}/launch</a><br>
                    • <strong>Biometric Attendance Logs:</strong> <a href="${safePortalUrl}/attendance">${safePortalUrl}/attendance</a><br>
                    • <strong>Leave Management:</strong> <a href="${safePortalUrl}/leave">${safePortalUrl}/leave</a><br>
                    • <strong>Task Board:</strong> <a href="${safePortalUrl}/tasks">${safePortalUrl}/tasks</a><br>
                    • <strong>Weekly Reports:</strong> <a href="${safePortalUrl}/reports/weekly-reports">${safePortalUrl}/reports/weekly-reports</a><br>
                    • <strong>Knowledge Sharing Session (KSS):</strong> <a href="${safePortalUrl}/reports/general-meeting/kss">${safePortalUrl}/reports/general-meeting/kss</a>
                </div>
            </div>

            <div class="support">
                If you experience any difficulties setting up your account, contact ICT Support at <a href="mailto:${ICT_SUPPORT_EMAIL}">${ICT_SUPPORT_EMAIL}</a>.
            </div>
        </div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;border-top:3px solid #16a34a;">
          <tr><td align="center" style="padding:20px;background:#000000 !important;font-size:11px;color:#d1d5db;">
            <span style="color:#f3f4f6;">Dispatched by ${preparedByName}</span><br>
            ${preparedByDesignation ? `${preparedByDesignation}<br>` : ""}
            ${preparedByDepartment}<br>
            <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
            <span style="color:#16a34a;font-weight:600;">Employee Management System</span>
            <br>
            <span class="footer-note">This is an automated notification, but replies are read — reply to this email to reach the ICT team.</span>
          </td></tr>
        </table>
    </div>
</body>
</html>
  `
}
