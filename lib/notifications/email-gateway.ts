import { Resend } from "resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import { applyAssignableStatusFilter } from "@/lib/workforce/assignment-policy"
import { ORG_NOTIFICATION_SENDER } from "@/lib/org-config"
import type { Database } from "@/types/database"

export const DEFAULT_NOTIFICATION_SENDER = ORG_NOTIFICATION_SENDER

interface SendEmailInput {
  to: string[]
  subject: string
  html: string
  from?: string
  /** Where a reply lands. Must be a monitored mailbox — see ORG_MAIL_ROUTING. */
  replyTo?: string
  /** RFC 2919 List-Id so recipients can filter this stream. Invisible to readers. */
  listId?: string
}

export type SendNotificationEmailResult =
  | {
      sent: true
      recipients: string[]
    }
  | {
      sent: false
      reason: "missing_resend_key" | "no_recipients" | "send_failed"
      recipients?: string[]
      error?: string
    }

function normalizeRecipientEmails(emails: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      emails
        .map((email) => (email || "").trim().toLowerCase())
        .filter((email) => email.length > 0 && email.includes("@"))
    )
  )
}

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  return new Resend(apiKey)
}

export async function sendNotificationEmail(input: SendEmailInput): Promise<SendNotificationEmailResult> {
  const resend = getResendClient()
  if (!resend) return { sent: false as const, reason: "missing_resend_key" as const }

  const recipients = normalizeRecipientEmails(input.to)
  if (!recipients.length) return { sent: false as const, reason: "no_recipients" as const }

  const { error } = await resend.emails.send({
    from: input.from || DEFAULT_NOTIFICATION_SENDER,
    to: recipients,
    subject: input.subject,
    html: input.html,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.listId ? { headers: { "List-Id": input.listId } } : {}),
  })

  if (error) throw new Error(error.message || "Failed to send email")
  return { sent: true as const, recipients }
}

export async function sendNotificationEmailWithRetry(
  input: SendEmailInput,
  maxAttempts = 2
): Promise<SendNotificationEmailResult> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await sendNotificationEmail(input)
      if (result.sent || result.reason === "missing_resend_key" || result.reason === "no_recipients") {
        return result
      }
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        continue
      }
    }
  }

  return {
    sent: false,
    reason: "send_failed",
    recipients: normalizeRecipientEmails(input.to),
    error: lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error"),
  }
}

export async function sendNotificationEmailsIndividuallyWithRetry(
  input: SendEmailInput,
  maxAttempts = 2
): Promise<{
  sent: boolean
  deliveredRecipients: string[]
  failedRecipients: Array<{ recipient: string; reason: string }>
}> {
  const recipients = normalizeRecipientEmails(input.to)
  const deliveredRecipients: string[] = []
  const failedRecipients: Array<{ recipient: string; reason: string }> = []

  for (const recipient of recipients) {
    const result = await sendNotificationEmailWithRetry(
      {
        ...input,
        to: [recipient],
      },
      maxAttempts
    )

    if (result.sent) {
      deliveredRecipients.push(recipient)
      continue
    }

    failedRecipients.push({
      recipient,
      reason: result.error || result.reason,
    })
  }

  return {
    sent: failedRecipients.length === 0,
    deliveredRecipients,
    failedRecipients,
  }
}

export async function resolveActiveLeadRecipientEmails(supabaseClient: SupabaseClient<Database>) {
  const recipients = await resolveActiveLeadRecipients(supabaseClient)
  return recipients.flatMap((lead) => lead.emails)
}

export async function resolveActiveLeadRecipients(supabaseClient: SupabaseClient<Database>) {
  const { data: leadProfiles, error } = await applyAssignableStatusFilter(
    supabaseClient
      .from("profiles")
      .select("id, company_email, additional_email, is_department_lead")
      .eq("is_department_lead", true),
    { allowLegacyNullStatus: false }
  )

  if (error) throw new Error(error.message || "Failed to load lead recipients")

  return (
    (leadProfiles || []) as Array<{ id: string; company_email?: string | null; additional_email?: string | null }>
  )
    .map((lead) => ({
      id: lead.id,
      emails: normalizeRecipientEmails([lead.company_email, lead.additional_email]),
    }))
    .filter((lead) => lead.emails.length > 0)
}
