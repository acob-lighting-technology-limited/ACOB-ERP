import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { ORG_PRIMARY_DOMAIN } from "@/lib/org-config"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"

export interface LeaveWorkflowEmailPayload {
  to: string[]
  subject: string
  title: string
  message: string
  ctaPath?: string
}

function buildEmailHtml(payload: Omit<LeaveWorkflowEmailPayload, "to" | "subject">) {
  const ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://erp.acoblighting.com"}${payload.ctaPath || "/leave"}`

  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;">
    <h2 style="margin:0 0 12px;color:#0f172a;">${payload.title}</h2>
    <p style="margin:0 0 16px;color:#334155;line-height:1.6;">${payload.message}</p>
    <a href="${ctaUrl}" style="display:inline-block;background:#166534;color:#fff;padding:10px 14px;text-decoration:none;border-radius:8px;">Open Leave Portal</a>
  </div>
  `
}

export async function sendLeaveWorkflowEmail(payload: LeaveWorkflowEmailPayload) {
  const emailEnabled = process.env.LEAVE_EMAIL_NOTIFICATIONS_ENABLED === "true"
  if (!emailEnabled) return

  const recipients = Array.from(new Set(payload.to.map((email) => email.trim().toLowerCase()).filter(Boolean)))
  if (!recipients.length) return

  await sendNotificationEmail({
    from: `ACOB HR System <notifications@${ORG_PRIMARY_DOMAIN}>`,
    to: recipients,
    subject: withSubjectPrefix("Leave", payload.subject),
    html: buildEmailHtml({ title: payload.title, message: payload.message, ctaPath: payload.ctaPath }),
  })
}
