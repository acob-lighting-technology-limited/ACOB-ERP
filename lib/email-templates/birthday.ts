import { escapeHtml } from "./utils"

interface BirthdayEmailProps {
  firstName: string
}

/** Celebratory birthday email sent automatically on an employee's birthday. */
export function renderBirthdayEmail({ firstName }: BirthdayEmailProps) {
  const name = escapeHtml((firstName || "").trim()) || "there"

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Happy Birthday from ACOB Lighting</title>
    <style>
        body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
        .email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }
        .wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 36px 28px; text-align: center; }
        .title { font-size: 26px; font-weight: 700; color: #111827; margin: 0 0 4px 0; }
        .subtitle { font-size: 15px; color: #16a34a; font-weight: 600; margin: 0 0 22px 0; letter-spacing: .04em; text-transform: uppercase; }
        .text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; text-align: left; }
        .card { margin-top: 8px; border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 10px; padding: 22px 24px; }
        .card .text { margin: 0; color: #166534; text-align: center; font-size: 16px; font-style: italic; line-height: 1.6; }
        .footer { background: #000; padding: 20px; text-align: center; font-size: 11px; color: #d1d5db; }
    </style>
</head>
<body>
    <div class="email-shell">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
      <tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">
        <img src="https://erp.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="65">
      </td></tr>
    </table>
    <div class="wrapper">
        <div class="title">Happy Birthday, ${name}! &#127881;</div>
        <div class="subtitle">From all of us at ACOB Lighting</div>

        <p class="text">Dear ${name},</p>
        <p class="text">On behalf of the entire ACOB Lighting Technology family, we wish you a very happy birthday! Today is all about you &mdash; we hope it is filled with joy, laughter, and the company of the people you love.</p>
        <p class="text">Thank you for the energy, dedication, and spirit you bring to our team every single day. We are grateful to have you with us, and we look forward to celebrating many more milestones together.</p>

        <div class="card">
            <p class="text">Wishing you a year ahead full of good health, happiness, and success. Enjoy your special day!</p>
        </div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
      <tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">
        <span style="color:#f3f4f6;">With warm wishes,</span><br>
        <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
        <span style="color:#16a34a;font-weight:600;">Admin &amp; HR Department</span>
        <br><br>
        <i style="color:#9ca3af;font-style:italic;">This is an automated message. Please do not reply directly to this email.</i>
      </td></tr>
    </table>
    </div>
</body>
</html>
  `
}
