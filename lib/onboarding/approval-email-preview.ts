import crypto from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ORG } from "@/config/constants"
import { renderInternalNotificationEmail } from "@/lib/email-templates/internal-notification"
import { renderWelcomeEmail } from "@/lib/email-templates/welcome"
import { isSystemNotificationChannelEnabled, resolveChannelEligibleUserIds } from "@/lib/notifications/delivery-policy"
import { resolveActiveLeadRecipients } from "@/lib/notifications/email-gateway"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"
import type { Database } from "@/types/database"

export interface ApprovalPreviewPendingUser {
  first_name: string
  last_name: string
  department: string
  designation: string
  company_email: string
  personal_email: string
  phone_number?: string | null
  office_location?: string | null
  residential_address?: string | null
}

interface ApprovalEmailPreviewParams {
  supabase: SupabaseClient<Database>
  pendingUser: ApprovalPreviewPendingUser
  preparedBy?: {
    name?: string | null
    designation?: string | null
    department?: string | null
  }
}

interface ApprovalPreviewEmail {
  enabled: boolean
  subject: string
  recipients: string[]
  html: string
}

export interface ApprovalEmailPreview {
  welcome: ApprovalPreviewEmail
  internal: ApprovalPreviewEmail
  tempPassword: string
  portalUrl: string
}

function normalizeEmails(emails: string[]) {
  return Array.from(
    new Set(
      emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0 && email.includes("@"))
    )
  )
}

export async function buildApprovalEmailPreview({
  supabase,
  pendingUser,
  preparedBy,
}: ApprovalEmailPreviewParams): Promise<ApprovalEmailPreview> {
  const normalizedPendingUser = {
    ...pendingUser,
    phone_number: pendingUser.phone_number || undefined,
    office_location: pendingUser.office_location || undefined,
    residential_address: pendingUser.residential_address || undefined,
  }
  const tempPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16)
  const portalUrl = ORG.MAIL_PORTAL_URL
  const onboardingMailEnabled = await isSystemNotificationChannelEnabled(supabase, "onboarding", "email")

  const welcomeRecipients = onboardingMailEnabled ? normalizeEmails([pendingUser.personal_email]) : []
  const welcomeSubject = withSubjectPrefix("Onboarding", "Welcome to ACOB - Login Credentials")
  const welcomeHtml = renderWelcomeEmail({
    pendingUser: normalizedPendingUser,
    tempPassword,
    portalUrl,
    preparedBy,
  })

  let internalRecipients: string[] = []
  const internalSubject = withSubjectPrefix(
    "Onboarding",
    `New Employee Onboarded - ${pendingUser.first_name.replace(/[\r\n]/g, "")} ${pendingUser.last_name.replace(/[\r\n]/g, "")}`
  )
  const internalHtml = renderInternalNotificationEmail({ pendingUser: normalizedPendingUser, preparedBy })

  if (onboardingMailEnabled) {
    const leadRecipients = await resolveActiveLeadRecipients(supabase)
    const leadIds = leadRecipients.map((lead) => lead.id)
    const allowedLeadIds = await resolveChannelEligibleUserIds(supabase, {
      userIds: leadIds,
      notificationKey: "onboarding",
      channel: "email",
    })
    const allowedIdSet = new Set(allowedLeadIds)
    internalRecipients = normalizeEmails(
      leadRecipients.filter((lead) => allowedIdSet.has(lead.id)).flatMap((lead) => lead.emails)
    )
  }

  return {
    welcome: {
      enabled: onboardingMailEnabled,
      subject: welcomeSubject,
      recipients: welcomeRecipients,
      html: welcomeHtml,
    },
    internal: {
      enabled: onboardingMailEnabled,
      subject: internalSubject,
      recipients: internalRecipients,
      html: internalHtml,
    },
    tempPassword,
    portalUrl,
  }
}
