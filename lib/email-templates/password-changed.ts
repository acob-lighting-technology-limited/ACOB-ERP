import { escapeHtml } from "./utils"

interface PasswordChangedEmailProps {
  userName?: string | null
  userEmail: string
  changeTime: string
  ipAddress?: string | null
}

export function renderPasswordChangedEmail({ userName, userEmail, changeTime, ipAddress }: PasswordChangedEmailProps) {
  const name = escapeHtml((userName || userEmail || "Team Member").trim())
  const email = escapeHtml(userEmail)
  const time = escapeHtml(changeTime)
  const ip = ipAddress ? escapeHtml(ipAddress) : "Unknown IP"

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Alert: Password Changed</title>
</head>
<body style="margin: 0; padding: 0; background: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; overflow: hidden; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 20px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000; border-top:3px solid #16a34a; border-bottom:3px solid #16a34a;">
            <tr>
                <td align="center" style="padding: 20px 0;">
                    <img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="50" style="display: block;">
                </td>
            </tr>
        </table>
        <div style="padding: 32px 28px;">
            <div style="font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">
                Password Changed Successfully
            </div>
            <p style="font-size: 14px; color: #334155; line-height: 1.6; margin: 0 0 16px 0;">
                Hello ${name},
            </p>
            <p style="font-size: 14px; color: #334155; line-height: 1.6; margin: 0 0 16px 0;">
                This email confirms that the password for your <strong>ACOB ERP</strong> account was updated on <strong>${time}</strong>.
            </p>
            
            <div style="margin-top: 20px; margin-bottom: 20px; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 6px; padding: 16px;">
                <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.05em;">
                    Security Summary
                </div>
                <div style="font-size: 13px; color: #1e293b; margin-bottom: 4px;">
                    <strong>Account Email:</strong> ${email}
                </div>
                <div style="font-size: 13px; color: #1e293b; margin-bottom: 4px;">
                    <strong>Time of Change:</strong> ${time}
                </div>
                <div style="font-size: 13px; color: #1e293b;">
                    <strong>Device IP:</strong> ${ip}
                </div>
            </div>

            <div style="border-left: 4px solid #ef4444; background: #fef2f2; padding: 12px 16px; border-radius: 4px; margin-top: 20px;">
                <p style="font-size: 13px; color: #991b1b; margin: 0; font-weight: 600;">
                    Did you not request this change?
                </p>
                <p style="font-size: 13px; color: #b91c1c; margin: 4px 0 0 0; line-height: 1.4;">
                    If you did not make this change, your account may be compromised. Please contact IT Support or your System Administrator immediately to lock your account and reset your credentials.
                </p>
            </div>
            
            <p style="font-size: 13px; color: #64748b; margin-top: 24px; margin-bottom: 0;">
                Best regards,<br>
                <strong>ACOB Security & IT Team</strong>
            </p>
        </div>
    </div>
</body>
</html>
  `
}
