import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { writeEdgeAuditLog } from "../_shared/audit.ts"
import { sendEmail } from "../_shared/email.ts"
import { isEdgeSystemEmailEnabled } from "../_shared/notification-gateway.ts"
import { sanitizeHtml } from "../_shared/sanitize-html.ts"
import { COMMUNICATIONS_LIST_ID, edgeDepartmentSenderBare } from "../_shared/senders.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type BroadcastRequestBody = {
  broadcastId?: string
  recipients?: string[]
  broadcastSubject?: string
  broadcastBodyHtml?: string
  broadcastDepartment?: string
  broadcastPreparedByName?: string
  broadcastPreparedByDesignation?: string
  broadcastPreparedByDepartment?: string
  broadcastPreparedByEmail?: string
  broadcastReplyToEmail?: string
  requestedByUserId?: string
  attachments?: {
    filename?: string
    content?: string
  }[]
}

type DeliveryResult = {
  to: string
  success: boolean
  emailId?: string | null
  error?: unknown
}

type ProfileRecipientRow = {
  id: string
  company_email: string | null
  additional_email: string | null
}

const DELIVERY_BATCH_SIZE = 2

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type EdgeRuntimeLike = { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }

type MailAttachment = {
  filename: string
  content: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Unknown error"
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function normalizeDepartmentLabel(input: string): string {
  return input.replace(/^ACOB\s+/i, "").trim() || "Admin & HR"
}

function buildBroadcastSender(department: string): string {
  return edgeDepartmentSenderBare(normalizeDepartmentLabel(department))
}

/**
 * Correspondence is written by a real person, so replies should reach that
 * person directly. Falls back to the department lead (resolved per send,
 * since it genuinely varies), then to the HR mailbox, if the sender has no
 * email on file.
 */
async function resolveDepartmentLeadReplyTo(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  department: string
): Promise<string> {
  const fallback = Deno.env.get("ORG_HR_EMAIL") || "hradmin@acoblighting.com"
  try {
    const { data: dept } = await supabase
      .from("departments")
      .select("department_head_id")
      .eq("name", normalizeDepartmentLabel(department))
      .maybeSingle()
    if (!dept?.department_head_id) return fallback

    const { data: lead } = await supabase
      .from("profiles")
      .select("company_email")
      .eq("id", dept.department_head_id)
      .maybeSingle()
    return normalizeEmail(lead?.company_email) || fallback
  } catch {
    return fallback
  }
}

async function resolveBroadcastReplyTo(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  department: string,
  replyToEmail: string | undefined,
  preparedByEmail: string | undefined
): Promise<string> {
  const selectedReplyTo = normalizeEmail(replyToEmail)
  if (selectedReplyTo) return selectedReplyTo
  const senderEmail = normalizeEmail(preparedByEmail)
  if (senderEmail) return senderEmail
  return resolveDepartmentLeadReplyTo(supabase, department)
}

function withSubjectPrefix(moduleName: string, subject: string): string {
  return String(subject || "").trim() || "Notification"
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
}

async function createInAppBroadcastNotifications(params: {
  supabase: ReturnType<typeof createClient>
  recipients: string[]
  successfulResults: DeliveryResult[]
  subject: string
  requestedByUserId: string | null
  department: string
  preparedBy: string
}) {
  const { supabase, recipients, successfulResults, subject, requestedByUserId, department, preparedBy } = params
  if (successfulResults.length === 0 || recipients.length === 0) return

  const normalizedRecipients = Array.from(new Set(recipients.map((email) => normalizeEmail(email)).filter(Boolean)))
  if (normalizedRecipients.length === 0) return

  const successfulEmailSet = new Set(successfulResults.map((result) => normalizeEmail(result.to)).filter(Boolean))
  if (successfulEmailSet.size === 0) return

  const [companyMatchResult, additionalMatchResult] = await Promise.all([
    supabase.from("profiles").select("id, company_email, additional_email").in("company_email", normalizedRecipients),
    supabase
      .from("profiles")
      .select("id, company_email, additional_email")
      .in("additional_email", normalizedRecipients),
  ])

  if (companyMatchResult.error) {
    throw new Error(`Failed to resolve company_email recipients: ${companyMatchResult.error.message}`)
  }
  if (additionalMatchResult.error) {
    throw new Error(`Failed to resolve additional_email recipients: ${additionalMatchResult.error.message}`)
  }

  const rows = [
    ...((companyMatchResult.data || []) as ProfileRecipientRow[]),
    ...((additionalMatchResult.data || []) as ProfileRecipientRow[]),
  ]

  const userIds = new Set<string>()
  for (const row of rows) {
    const companyEmail = normalizeEmail(row.company_email)
    const additionalEmail = normalizeEmail(row.additional_email)
    if (successfulEmailSet.has(companyEmail) || successfulEmailSet.has(additionalEmail)) {
      userIds.add(row.id)
    }
  }

  if (userIds.size === 0) return

  const notificationRows = Array.from(userIds).map((userId) => ({
    user_id: userId,
    type: "announcement",
    category: "communications",
    priority: "normal",
    title: "New ERP Email Broadcast",
    message: subject,
    action_url: "/notifications",
    actor_id: requestedByUserId,
    data: {
      module: "communications",
      event: "admin_broadcast",
      department,
      prepared_by: preparedBy,
      recipient_email_count: successfulEmailSet.size,
      sent_at: new Date().toISOString(),
    },
  }))

  const { error: insertError } = await supabase.from("notifications").insert(notificationRows)
  if (insertError) {
    throw new Error(`Failed to create in-app notifications: ${insertError.message}`)
  }
}

function buildAdminBroadcastHtml(
  title: string,
  bodyHtml: string,
  department: string,
  preparedByName: string,
  preparedByDesignation?: string | null,
  preparedByDepartment?: string | null
): string {
  const displayDepartment = normalizeDepartmentLabel(preparedByDepartment || department)
  const safeDepartment = escapeHtml(displayDepartment)
  const safeTitle = escapeHtml(title)
  const safePreparedBy = escapeHtml(preparedByName.trim() || "ACOB Team")
  const safeDesignation = escapeHtml((preparedByDesignation || "").trim())

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Admin Broadcast</title>" +
    "<style>" +
    'body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }" +
    ".outer-header { background:#000 !important; background-color:#000 !important; background-image:linear-gradient(#000,#000) !important; border-top:3px solid #16a34a; border-bottom:3px solid #16a34a; }" +
    ".outer-footer { background:#000 !important; background-color:#000 !important; background-image:linear-gradient(#000,#000) !important; border-top:3px solid #16a34a; border-bottom:3px solid #16a34a; }" +
    ".wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }" +
    ".title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 14px; }" +
    ".body-content { font-size: 15px; color: #374151; line-height: 1.7; }" +
    ".body-content p { margin: 0 0 12px 0; }" +
    ".body-content ul, .body-content ol { margin: 0 0 12px 20px; }" +
    ".body-content a { color: #1e40af; text-decoration: underline; }" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="email-shell">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" class="outer-header" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    '<div class="wrapper">' +
    '<div class="title">' +
    safeTitle +
    "</div>" +
    '<div class="body-content">' +
    bodyHtml +
    "</div>" +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" class="outer-footer" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" bgcolor="#000000" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<span style="color:#f3f4f6;">Prepared by ' +
    safePreparedBy +
    "</span><br>" +
    (safeDesignation ? '<span style="color:#d1d5db;">' + safeDesignation + "</span><br>" : "") +
    '<span style="color:#d1d5db;">' +
    safeDepartment +
    "</span><br>" +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Communications Management System</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated notification, but replies are read — reply to this email and it reaches the team that sent it.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

async function processRecipientBatch<TInput, TResult>(
  items: TInput[],
  batchSize: number,
  worker: (item: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    const batchResults = await Promise.all(batch.map((item, batchIndex) => worker(item, index + batchIndex)))
    results.push(...batchResults)
  }

  return results
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const requestStartedAt = Date.now()
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return new Response("Unauthorized", { status: 401 })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const communicationsMailEnabled = await isEdgeSystemEmailEnabled(supabase, "communications")
    if (!communicationsMailEnabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "communications_email_disabled" }), {
        status: 200,
      })
    }

    const body = (await req.json()) as BroadcastRequestBody

    const broadcastId =
      typeof body.broadcastId === "string" && UUID_RE.test(body.broadcastId.trim()) ? body.broadcastId.trim() : null
    const recipients = body.recipients as string[] | undefined
    const broadcastSubject = body.broadcastSubject as string | undefined
    const broadcastBodyHtml = body.broadcastBodyHtml as string | undefined
    const broadcastDepartment = body.broadcastDepartment as string | undefined
    const broadcastPreparedByName = body.broadcastPreparedByName as string | undefined
    const broadcastPreparedByDesignation = body.broadcastPreparedByDesignation as string | undefined
    const broadcastPreparedByDepartment = body.broadcastPreparedByDepartment as string | undefined
    const broadcastPreparedByEmail = body.broadcastPreparedByEmail as string | undefined
    const broadcastReplyToEmail = body.broadcastReplyToEmail as string | undefined
    const requestedByUserId = (body.requestedByUserId as string | undefined) || null
    const attachments = Array.isArray(body.attachments)
      ? body.attachments
          .map((attachment) => ({
            filename: String(attachment?.filename || "").trim(),
            content: String(attachment?.content || "").trim(),
          }))
          .filter((attachment): attachment is MailAttachment => Boolean(attachment.filename && attachment.content))
      : []

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No recipients" }), { status: 400 })
    }

    const cleanBody = sanitizeHtml(broadcastBodyHtml || "")
    if (!cleanBody) {
      return new Response(JSON.stringify({ error: "Broadcast body is required" }), { status: 400 })
    }

    const department = (broadcastDepartment || "Admin & HR").trim() || "Admin & HR"
    const preparedBy = (broadcastPreparedByName || "").trim() || "ACOB Team"
    const subject = withSubjectPrefix(
      "Communications",
      (broadcastSubject || "Administrative Notice").trim() || "Administrative Notice"
    )
    const html = buildAdminBroadcastHtml(
      subject,
      cleanBody,
      department,
      preparedBy,
      broadcastPreparedByDesignation,
      broadcastPreparedByDepartment
    )
    const from = buildBroadcastSender(department)
    const replyTo = await resolveBroadcastReplyTo(supabase, department, broadcastReplyToEmail, broadcastPreparedByEmail)

    // ── Idempotency claim ────────────────────────────────────────────────────
    // Claim this broadcast before sending. A retry (or concurrent duplicate)
    // reuses the same broadcastId and hits the primary-key constraint, so it is
    // skipped instead of sending to everyone a second time.
    if (broadcastId) {
      const { error: claimError } = await supabase.from("broadcast_dispatches").insert({
        broadcast_id: broadcastId,
        subject,
        department,
        requested_by: requestedByUserId,
        recipient_count: recipients.length,
        status: "processing",
      })
      if (claimError) {
        const claimCode = (claimError as { code?: string }).code
        if (claimCode === "23505") {
          console.log("[communications-mail] duplicate broadcast claim skipped: " + broadcastId)
          return new Response(JSON.stringify({ success: true, duplicate: true, broadcastId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          })
        }
        // Non-conflict errors fail open: a ledger problem must not block delivery.
        console.error("[communications-mail] broadcast claim failed (continuing):", JSON.stringify(claimError))
      }
    }

    console.log("[communications-mail] Sending admin_broadcast to " + recipients.length + " recipients")
    console.log(
      "[communications-mail] request summary",
      JSON.stringify({
        elapsed_ms: Date.now() - requestStartedAt,
        recipient_count: recipients.length,
        attachment_count: attachments.length,
        subject,
        broadcast_id: broadcastId,
      })
    )

    // The actual fan-out is slow (rate-limited, one email at a time). Run it in
    // the background and return immediately so the HTTP request can't time out
    // and trigger a retry mid-send.
    const runSend = async (): Promise<void> => {
      const results = await processRecipientBatch(
        recipients,
        DELIVERY_BATCH_SIZE,
        async (to, index): Promise<DeliveryResult> => {
          const recipientStartedAt = Date.now()
          try {
            const data = await sendEmail({
              from,
              replyTo,
              listId: COMMUNICATIONS_LIST_ID,
              to,
              subject,
              html,
              attachments,
              traceLabel: `communications-mail:${index + 1}/${recipients.length}:${to}`,
            })
            console.log("[communications-mail] Sent to " + to + ". ID: " + data.id)
            console.log(
              "[communications-mail] recipient send completed",
              JSON.stringify({
                recipient: to,
                recipient_index: index + 1,
                recipient_elapsed_ms: Date.now() - recipientStartedAt,
                send_total_duration_ms: data.totalDurationMs,
                rate_limit_wait_ms: data.rateLimitWaitMs,
                resend_api_duration_ms: data.resendApiDurationMs,
                retry_backoff_ms: data.retryBackoffMs,
              })
            )
            return { to, success: true, emailId: data.id }
          } catch (error) {
            console.error("[communications-mail] Failed to send to " + to + ":", JSON.stringify(error))
            return { to, success: false, error }
          }
        }
      )

      const successfulResults = results.filter((result) => result.success)
      const successCount = successfulResults.length
      const failureCount = results.length - successCount

      console.log(
        "[communications-mail] send cycle completed",
        JSON.stringify({
          total_elapsed_ms: Date.now() - requestStartedAt,
          recipient_count: recipients.length,
          success_count: successCount,
          failure_count: failureCount,
        })
      )

      try {
        await createInAppBroadcastNotifications({
          supabase,
          recipients,
          successfulResults,
          subject,
          requestedByUserId,
          department,
          preparedBy,
        })
      } catch (notificationError) {
        console.error("[communications-mail] Failed to create in-app notifications:", notificationError)
      }

      try {
        const auditEntityId = broadcastId || crypto.randomUUID()
        await writeEdgeAuditLog(supabase, {
          action: "communications_broadcast_sent",
          entityType: "communications_mail",
          entityId: auditEntityId,
          actorId: requestedByUserId,
          department,
          source: "edge",
          route: "/functions/send-communications-mail",
          metadata: {
            reminder_type: "admin_broadcast",
            recipient_count: recipients.length,
            success_count: successCount,
            failure_count: failureCount,
            subject,
            prepared_by: preparedBy,
            prepared_by_designation: broadcastPreparedByDesignation || null,
            prepared_by_department: broadcastPreparedByDepartment || department,
            attachment_count: attachments.length,
            broadcast_id: broadcastId,
          },
        })
      } catch (auditErr) {
        console.error("[communications-mail] Failed to write audit log:", auditErr)
      }

      if (broadcastId) {
        const { error: updateError } = await supabase
          .from("broadcast_dispatches")
          .update({
            status: failureCount > 0 ? "completed_with_errors" : "completed",
            success_count: successCount,
            failure_count: failureCount,
            completed_at: new Date().toISOString(),
          })
          .eq("broadcast_id", broadcastId)
        if (updateError) {
          console.error("[communications-mail] Failed to finalize broadcast dispatch:", JSON.stringify(updateError))
        }
      }
    }

    const waitUntil = (globalThis as EdgeRuntimeLike).EdgeRuntime?.waitUntil
    if (typeof waitUntil === "function") {
      waitUntil(runSend())
    } else {
      // Older runtimes without background tasks: fall back to inline execution.
      await runSend()
    }

    return new Response(
      JSON.stringify({
        success: true,
        accepted: true,
        type: "admin_broadcast",
        broadcastId,
        recipientCount: recipients.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 202,
      }
    )
  } catch (err: unknown) {
    console.error("[send-communications-mail] Error:", err)
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
