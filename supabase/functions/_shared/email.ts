import { Resend } from "npm:resend@2.0.0"
import { EDGE_SENDERS } from "./senders.ts"

type EmailAttachment = {
  filename: string
  content: string
}

type SendEmailOptions = {
  to: string | string[]
  cc?: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
  /** RFC 2919 List-Id, e.g. "<assets.acoblighting.com>". Invisible to readers. */
  listId?: string
  attachments?: EmailAttachment[]
  traceLabel?: string
}

type SendEmailResult = {
  id: string
  attempts: number
  totalDurationMs: number
  rateLimitWaitMs: number
  resendApiDurationMs: number
  retryBackoffMs: number
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const DEFAULT_FROM = EDGE_SENDERS.system
const RATE_LIMIT_INTERVAL_MS = 500
const MAX_ATTEMPTS = 3
let nextAvailableSendTime = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRateLimit(): Promise<number> {
  const now = Date.now()
  const waitMs = Math.max(0, nextAvailableSendTime - now)
  if (waitMs > 0) {
    await sleep(waitMs)
  }
  nextAvailableSendTime = Math.max(now, nextAvailableSendTime) + RATE_LIMIT_INTERVAL_MS
  return waitMs
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Failed to send email"
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured")
  }

  const resend = new Resend(RESEND_API_KEY)
  const ccList = options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined
  const payload = {
    from: options.from || DEFAULT_FROM,
    to: Array.isArray(options.to) ? options.to : [options.to],
    ...(ccList && ccList.length ? { cc: ccList } : {}),
    subject: options.subject,
    html: options.html,
    replyTo: options.replyTo,
    reply_to: options.replyTo, // Ensure compatibility with Resend API snake_case format
    ...(options.listId ? { headers: { "List-Id": options.listId } } : {}),
    attachments: options.attachments,
  } as any
  const traceLabel = options.traceLabel || payload.subject
  const recipientsCount = payload.to.length
  const attachmentsCount = options.attachments?.length || 0
  const totalStartedAt = Date.now()
  let totalRateLimitWaitMs = 0
  let totalResendApiDurationMs = 0
  let totalRetryBackoffMs = 0

  let attempt = 0
  while (attempt < MAX_ATTEMPTS) {
    const attemptNumber = attempt + 1
    const attemptStartedAt = Date.now()
    const waitMs = await waitForRateLimit()
    totalRateLimitWaitMs += waitMs

    if (waitMs > 0) {
      console.log(
        `[email][${traceLabel}] rate-limit wait`,
        JSON.stringify({
          attempt: attemptNumber,
          wait_ms: waitMs,
          next_available_send_time: nextAvailableSendTime,
        })
      )
    }

    const resendStartedAt = Date.now()
    const { data, error } = await resend.emails.send(payload)
    const resendApiDurationMs = Date.now() - resendStartedAt
    totalResendApiDurationMs += resendApiDurationMs
    const attemptDurationMs = Date.now() - attemptStartedAt

    if (!error && data?.id) {
      const totalDurationMs = Date.now() - totalStartedAt
      console.log(
        `[email][${traceLabel}] send success`,
        JSON.stringify({
          recipients_count: recipientsCount,
          attachments_count: attachmentsCount,
          attempt: attemptNumber,
          attempt_duration_ms: attemptDurationMs,
          resend_api_duration_ms: resendApiDurationMs,
          total_duration_ms: totalDurationMs,
          total_rate_limit_wait_ms: totalRateLimitWaitMs,
          total_retry_backoff_ms: totalRetryBackoffMs,
          email_id: data.id,
        })
      )

      return {
        id: data.id,
        attempts: attemptNumber,
        totalDurationMs,
        rateLimitWaitMs: totalRateLimitWaitMs,
        resendApiDurationMs: totalResendApiDurationMs,
        retryBackoffMs: totalRetryBackoffMs,
      }
    }

    attempt += 1
    if (attempt >= MAX_ATTEMPTS) {
      console.error(
        `[email][${traceLabel}] send failed`,
        JSON.stringify({
          recipients_count: recipientsCount,
          attachments_count: attachmentsCount,
          attempts: attempt,
          attempt_duration_ms: attemptDurationMs,
          resend_api_duration_ms: resendApiDurationMs,
          total_duration_ms: Date.now() - totalStartedAt,
          total_rate_limit_wait_ms: totalRateLimitWaitMs,
          total_retry_backoff_ms: totalRetryBackoffMs,
          error: getErrorMessage(error),
        })
      )
      throw new Error(getErrorMessage(error))
    }

    const retryBackoffMs = 500 * 2 ** (attempt - 1)
    totalRetryBackoffMs += retryBackoffMs
    console.warn(
      `[email][${traceLabel}] retry scheduled`,
      JSON.stringify({
        next_attempt: attempt + 1,
        retry_backoff_ms: retryBackoffMs,
        resend_api_duration_ms: resendApiDurationMs,
        error: getErrorMessage(error),
      })
    )
    await sleep(retryBackoffMs)
  }

  throw new Error("Failed to send email")
}

export type BatchEmailItemOptions = {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
  listId?: string
  attachments?: EmailAttachment[]
}

export type BatchDeliveryResult = {
  to: string
  success: boolean
  emailId?: string | null
  error?: unknown
}

export async function sendBatchEmails(
  items: BatchEmailItemOptions[],
  batchChunkSize = 50
): Promise<BatchDeliveryResult[]> {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured")
  }
  if (items.length === 0) return []

  const hasAttachments = items.some((item) => item.attachments && item.attachments.length > 0)
  if (hasAttachments) {
    // Resend's batch endpoint (/emails/batch) does NOT support attachments and silently drops them.
    // When attachments are present, fan out using individual sendEmail calls in concurrent batches of 2.
    const results: BatchDeliveryResult[] = []
    const concurrency = 2

    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency)
      const chunkResults = await Promise.all(
        chunk.map(async (item, idx): Promise<BatchDeliveryResult> => {
          try {
            const data = await sendEmail({
              from: item.from || DEFAULT_FROM,
              to: item.to,
              subject: item.subject,
              html: item.html,
              replyTo: item.replyTo,
              listId: item.listId,
              attachments: item.attachments,
              traceLabel: `batch-email:${i + idx + 1}/${items.length}:${item.to}`,
            })
            return { to: item.to, success: true, emailId: data.id }
          } catch (error) {
            console.error(`[email][batch-individual] Failed to send to ${item.to}:`, error)
            return { to: item.to, success: false, error }
          }
        })
      )
      results.push(...chunkResults)
    }

    return results
  }

  const resend = new Resend(RESEND_API_KEY)
  const results: BatchDeliveryResult[] = []

  for (let i = 0; i < items.length; i += batchChunkSize) {
    const chunk = items.slice(i, i + batchChunkSize)
    await waitForRateLimit()

    const payload = chunk.map((item) => ({
      from: item.from || DEFAULT_FROM,
      to: [item.to],
      subject: item.subject,
      html: item.html,
      replyTo: item.replyTo,
      ...(item.listId ? { headers: { "List-Id": item.listId } } : {}),
      attachments: item.attachments,
    }))

    try {
      const res = await resend.batch.send(payload)
      const resendData = res.data?.data || []
      const resendError = res.error

      if (resendError) {
        console.error(`[email][batch] Batch send failed for chunk starting at index ${i}:`, resendError)
        for (const item of chunk) {
          results.push({ to: item.to, success: false, error: resendError })
        }
      } else {
        chunk.forEach((item, idx) => {
          const emailId = resendData[idx]?.id ?? null
          results.push({ to: item.to, success: true, emailId })
        })
      }
    } catch (err) {
      console.error(`[email][batch] Exception during batch send at index ${i}:`, err)
      for (const item of chunk) {
        results.push({ to: item.to, success: false, error: err })
      }
    }
  }

  return results
}
