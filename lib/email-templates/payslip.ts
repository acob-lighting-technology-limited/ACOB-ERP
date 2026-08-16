import { escapeHtml } from "./utils"

const ACCOUNTS_EMAIL = process.env.ORG_ACCOUNTS_EMAIL || "accounts@acoblighting.com"

export interface PayslipEmailProps {
  fullName: string
  periodName: string
  payDate: string
  /** Whether the attached PDF is password-protected. When true, the body explains the format — never the literal value. */
  protected?: boolean
}

/**
 * Cover note for the payslip email.
 *
 * Deliberately carries NO salary figures and NO literal password. The
 * breakdown lives in the attached PDF; the password (the recipient's own staff
 * ID) is something they already know, so the body only states the format —
 * printing the value again just gives a second place for it to leak from.
 */
export function renderPayslipEmail({
  fullName,
  periodName,
  payDate,
  protected: isProtected,
}: PayslipEmailProps): string {
  const name = escapeHtml((fullName || "").split(" ")[0] || "Colleague")
  const period = escapeHtml(periodName)
  const date = escapeHtml(payDate)
  const accounts = escapeHtml(ACCOUNTS_EMAIL)

  const passwordBlock = isProtected
    ? `
        <div class="card">
            <div class="card-header">Opening the attachment</div>
            <table>
                <tr>
                    <td class="label">Password</td>
                    <td class="value">Your Staff ID (as shown on your ID card / payslip)</td>
                </tr>
            </table>
        </div>
        <p class="note">Enter it exactly as printed, including the slashes — e.g. ACOB/2025/038.</p>`
    : ""

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payslip - ${period}</title>
    <style>
        body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
        .email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }
        .wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }
        .title { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 14px; }
        .text { font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 18px 0; }
        .card { margin-top: 22px; border: 1px solid #d1d5db; overflow: hidden; background: #f9fafb; }
        .card-header { padding: 12px 18px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; background: #eff6ff; color: #1e40af; border-bottom: 1px solid #bfdbfe; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 12px 18px; font-size: 14px; border-bottom: 1px solid #d1d5db; }
        tr:last-child td { border-bottom: none; }
        .label { width: 40%; color: #4b5563; font-weight: 500; border-right: 1px solid #d1d5db; }
        .value { color: #111827; font-weight: 600; }
        .note { font-size: 13px; color: #4b5563; line-height: 1.5; margin-top: 14px; }
        .support { text-align: center; font-size: 14px; color: #4b5563; margin-top: 28px; line-height: 1.5; }
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
        <div class="title">Your Payslip is Ready</div>
        <p class="text">Dear ${name},</p>
        <p class="text">Please find attached your payslip for <strong>${period}</strong>. It sets out your earnings, statutory deductions and net pay for the period.</p>

        <div class="card">
            <div class="card-header">Payslip Details</div>
            <table>
                <tr>
                    <td class="label">Pay Period</td>
                    <td class="value">${period}</td>
                </tr>
                <tr>
                    <td class="label">Pay Date</td>
                    <td class="value">${date}</td>
                </tr>
            </table>
        </div>
        ${passwordBlock}

        <p class="note">Please keep this document confidential. If any detail appears incorrect, contact Accounts within seven (7) working days of receipt.</p>

        <div class="support">
            Questions about your payslip? Write to <a href="mailto:${accounts}">${accounts}</a>.
        </div>
    </div>
    <div class="footer">
        <strong>ACOB Lighting Technology Limited</strong><br>
        <span class="footer-system">Matrix</span> &mdash; Enterprise Resource Platform<br>
        <span class="footer-note">Replies to this message are routed to ${accounts}.</span>
    </div>
    </div>
</body>
</html>`
}
