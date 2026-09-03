import { escapeHtml } from "./utils"

export interface OnboardingSubmissionEmailProps {
  applicant: {
    first_name: string
    last_name: string
    department?: string | null
    designation: string
    personal_email: string
    phone_number: string
    employment_type?: string | null
  }
  reviewUrl?: string
}

export function renderOnboardingSubmissionEmail({ applicant, reviewUrl }: OnboardingSubmissionEmailProps): string {
  const firstName = escapeHtml(applicant.first_name)
  const lastName = escapeHtml(applicant.last_name)
  const dept = escapeHtml(applicant.department || "N/A")
  const designation = escapeHtml(applicant.designation)
  const personalEmail = escapeHtml(applicant.personal_email)
  const phoneNumber = escapeHtml(applicant.phone_number)
  const rawType = applicant.employment_type || "full_time"
  const employmentType = escapeHtml(rawType.replace("_", " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
  const actionUrl =
    reviewUrl || `${process.env.NEXT_PUBLIC_PORTAL_URL || "https://matrix.acoblighting.com"}/admin/hr/employees`

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Onboarding Submission</title>
    <style>
        body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
    </style>
</head>
<body>
    <div style="max-width: 600px; margin: 0 auto; overflow: hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
        <tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">
            <img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="65">
        </td></tr>
    </table>
    <div style="max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px;">
        <div style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 12px;">New Onboarding Submission</div>
        <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 16px 0;">Dear HR Team,</p>
        <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">A new employee onboarding form has been submitted and is pending your review and approval in the Admin Console.</p>
        
        <div style="margin-top: 20px; border: 1px solid #e5e7eb; overflow: hidden; background: #fbfbfb; border-radius: 6px;">
            <div style="padding: 12px 18px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #e5e7eb; background: #f8fafc; color: #64748b;">Applicant Details</div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Full Name</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${firstName} ${lastName}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Department</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${dept}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Designation</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${designation}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Personal Email</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${personalEmail}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Phone Number</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid #e5e7eb;">${phoneNumber}</td>
                </tr>
                <tr>
                    <td style="width: 35%; color: #64748b; font-weight: 500; border-right: 1px solid #e5e7eb; padding: 12px 18px; font-size: 13px;">Employment Type</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 12px 18px; font-size: 13px;">${employmentType}</td>
                </tr>
            </table>
        </div>

        <div style="text-align: center; margin-top: 28px; margin-bottom: 8px;">
            <a href="${actionUrl}" 
               style="display: inline-block; background: #000000; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                Review Application
            </a>
        </div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
        <tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">
            <span style="color:#d1d5db;">Admin &amp; HR Department</span><br>
            <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
            <span style="color:#16a34a; font-weight:600;">Employee Management System</span>
            <br><br>
            <i style="color:#9ca3af; font-style:italic;">This is an automated notification, but replies are read — reply to this email to reach the HR team.</i>
        </td></tr>
    </table>
    </div>
</body>
</html>
`
}
