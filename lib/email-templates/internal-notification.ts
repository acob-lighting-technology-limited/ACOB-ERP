import { escapeHtml } from "./utils"
import { type PendingUser } from "./welcome"

interface InternalNotificationEmailProps {
  pendingUser: PendingUser
  preparedBy?: {
    name?: string | null
    designation?: string | null
    department?: string | null
  }
}

export function renderInternalNotificationEmail({ pendingUser, preparedBy }: InternalNotificationEmailProps) {
  const firstName = escapeHtml(pendingUser.first_name)
  const lastName = escapeHtml(pendingUser.last_name)
  const dept = escapeHtml(pendingUser.department)
  const role = escapeHtml(pendingUser.designation)
  const email = escapeHtml(pendingUser.company_email)
  const officeLocation = pendingUser.office_location ? escapeHtml(pendingUser.office_location) : "N/A"
  const phoneNumber = pendingUser.phone_number ? escapeHtml(pendingUser.phone_number) : "N/A"
  const address = pendingUser.residential_address ? escapeHtml(pendingUser.residential_address) : "N/A"
  const preparedByName = escapeHtml((preparedBy?.name || "Admin & HR Lead").trim())
  const preparedByDesignation = escapeHtml((preparedBy?.designation || "").trim())
  const preparedByDepartment = escapeHtml((preparedBy?.department || "Admin & HR").trim())
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Employee Onboarding Notification</title>
    <style>
        body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
    </style>
</head>
<body>
    <div style="max-width: 600px; margin: 0 auto; overflow: hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
        <tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">
            <img src="https://erp.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="65">
        </td></tr>
    </table>
    <div style="max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px;">
        <div style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 20px;">New Employee Onboarded</div>
        <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 18px 0;">Dear Management,</p>
        <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 18px 0;">This is an automated notification that a new employee has been successfully approved and added to the system for your awareness.</p>
        
        <div style="margin-top: 22px; border: 1px solid #e5e7eb; overflow: hidden; background: #fbfbfb; border-radius: 6px;">
            <div style="padding: 12px 18px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #e5e7eb; background: #f8fafc; color: #64748b;">Onboarding Details</div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Employee Name</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${firstName} ${lastName}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Department</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${dept}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Office Location</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${officeLocation}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Official Email</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${email}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Designation</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${role}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px;">Phone Number</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px;">${phoneNumber}</td>
                </tr>
            </table>
        </div>


    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
        <tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">
            <span style="color:#f3f4f6;">Prepared by ${preparedByName}</span><br>
            ${preparedByDesignation ? `<span style="color:#d1d5db;">${preparedByDesignation}</span><br>` : ""}
            <span style="color:#d1d5db;">${preparedByDepartment}</span><br>
            <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
            <span style="color:#16a34a; font-weight:600;">Employee Management System</span>
            <br><br>
            <i style="color:#9ca3af; font-style:italic;">This is an automated system notification. Please do not reply directly to this email.</i>
        </td></tr>
    </table>
    </div>
</body>
</html>
  `
}
