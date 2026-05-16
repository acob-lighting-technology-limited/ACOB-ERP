import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3"
import { canEdgeUserReceiveEmail, normalizeRecipientEmails } from "../_shared/notification-gateway.ts"
import { sendEmail } from "../_shared/email.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const NOTIFICATION_SENDER_EMAIL = Deno.env.get("NOTIFICATION_SENDER_EMAIL") || "notifications@acoblighting.com"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type PaymentRow = {
  id: string
  title: string | null
  amount: number | null
  category: string | null
  next_payment_due: string | null
  status: "due" | "paid" | "overdue" | "cancelled"
  created_by: string | null
  due_notified_at: string | null
  overdue_notified_at: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
}

type PaymentEvent = {
  event: "due" | "overdue"
  payment: PaymentRow
  creatorId: string
}

function toLocalISODate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return toLocalISODate(date)
}

function buildPaymentEmailHtml(params: {
  recipientName: string
  event: "due" | "overdue"
  paymentTitle: string
  category: string
  amount: number | null
  dueDate: string
  paymentId: string
  appUrl: string
}): string {
  const heading = params.event === "due" ? "Payment Due Reminder" : "Payment Overdue Alert"
  const statusColor = params.event === "due" ? "#92400e" : "#991b1b"
  const statusLabel = params.event === "due" ? "DUE TODAY" : "OVERDUE"
  const amountText = params.amount == null ? "N/A" : `NGN ${Number(params.amount).toLocaleString("en-NG")}`

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;background:#111827;color:#fff;">
          <h2 style="margin:0;font-size:18px;">${heading}</h2>
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 12px;">Hello ${params.recipientName},</p>
          <p style="margin:0 0 16px;">A payment you created now requires your attention.</p>
          <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#fef2f2;color:${statusColor};font-size:12px;font-weight:700;">
            ${statusLabel}
          </div>
          <table style="width:100%;margin-top:16px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#64748b;">Payment</td><td style="padding:8px 0;font-weight:600;">${params.paymentTitle}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;">Category</td><td style="padding:8px 0;font-weight:600;">${params.category}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;">Amount</td><td style="padding:8px 0;font-weight:600;">${amountText}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;">Due Date</td><td style="padding:8px 0;font-weight:600;">${params.dueDate}</td></tr>
          </table>
          <p style="margin-top:18px;">
            <a href="${params.appUrl}/payments/${params.paymentId}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">
              View Payment
            </a>
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">This is an automated system notification. Please do not reply directly to this email.</p>
        </div>
      </div>
    </div>
  `
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
      throw new Error("Missing Supabase configuration")
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const appUrl = Deno.env.get("APP_BASE_URL") || Deno.env.get("NEXT_PUBLIC_APP_URL") || SUPABASE_URL
    const todayKey = toLocalISODate()

    console.log("Checking payment statuses...")

    const { error: rpcError } = await supabase.rpc("check_payment_status")
    if (rpcError) {
      console.warn("check_payment_status RPC failed, continuing with built-in processing:", rpcError.message)
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("department_payments")
      .select("id, title, amount, category, next_payment_due, status, created_by, due_notified_at, overdue_notified_at")
      .eq("payment_type", "recurring")
      .not("next_payment_due", "is", null)
      .in("status", ["due", "overdue"])

    if (paymentsError) throw paymentsError

    const paymentRows = (payments || []) as PaymentRow[]
    const dueEvents: PaymentEvent[] = []
    const overdueEvents: PaymentEvent[] = []
    const overdueIdsToMark = new Set<string>()

    for (const payment of paymentRows) {
      if (!payment.created_by) continue
      const dueDateKey = toDateKey(payment.next_payment_due)
      if (!dueDateKey) continue
      const dueNotifiedKey = toDateKey(payment.due_notified_at)
      const overdueNotifiedKey = toDateKey(payment.overdue_notified_at)

      if (dueDateKey === todayKey && payment.status === "due" && dueNotifiedKey !== dueDateKey) {
        dueEvents.push({ event: "due", payment, creatorId: payment.created_by })
      }

      if (dueDateKey < todayKey && (!overdueNotifiedKey || overdueNotifiedKey < dueDateKey)) {
        overdueEvents.push({ event: "overdue", payment, creatorId: payment.created_by })
        if (payment.status === "due") overdueIdsToMark.add(payment.id)
      }
    }

    if (overdueIdsToMark.size > 0) {
      const { error: markError } = await supabase
        .from("department_payments")
        .update({ status: "overdue" })
        .in("id", Array.from(overdueIdsToMark))
      if (markError) {
        console.error("Failed to mark payments overdue:", markError.message)
      }
    }

    const allEvents = [...dueEvents, ...overdueEvents]
    if (allEvents.length === 0) {
      return new Response(
        JSON.stringify({ message: "Payment status check completed", dueNotified: 0, overdueNotified: 0, updated: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      )
    }

    const creatorIds = Array.from(new Set(allEvents.map((event) => event.creatorId)))
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, company_email, additional_email")
      .in("id", creatorIds)

    if (profileError) throw profileError

    const profileMap = new Map<string, ProfileRow>(
      (profileRows || []).map((profile) => [profile.id, profile as ProfileRow])
    )

    let dueNotified = 0
    let overdueNotified = 0

    for (const event of allEvents) {
      try {
        const profile = profileMap.get(event.creatorId)
        const recipientEmails = normalizeRecipientEmails([
          profile?.company_email || null,
          profile?.additional_email || null,
        ])

        if (recipientEmails.length === 0) continue

        const canReceiveEmail = await canEdgeUserReceiveEmail(supabase, event.creatorId, "system")
        if (!canReceiveEmail) continue

        const dueDateText = new Date(event.payment.next_payment_due as string).toLocaleDateString("en-GB")
        const paymentTitle = event.payment.title || event.payment.category || "Recurring Payment"
        const category = event.payment.category || "N/A"
        const subject =
          event.event === "due"
            ? `System: Payment Due Today - ${paymentTitle}`
            : `System: Payment Overdue - ${paymentTitle}`
        const html = buildPaymentEmailHtml({
          recipientName:
            profile?.full_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Team Member",
          event: event.event,
          paymentTitle,
          category,
          amount: event.payment.amount,
          dueDate: dueDateText,
          paymentId: event.payment.id,
          appUrl,
        })

        await sendEmail({
          from: `ACOB Internal Systems <${NOTIFICATION_SENDER_EMAIL}>`,
          to: recipientEmails,
          subject,
          html,
          traceLabel: `check-payment-status:${event.event}:${event.payment.id}`,
        })

        const notificationTitle = event.event === "due" ? "Payment Due Today" : "Payment Overdue"
        const notificationMessage =
          event.event === "due"
            ? `A payment you created (${paymentTitle}) is due today.`
            : `A payment you created (${paymentTitle}) is now overdue.`

        await supabase.from("notifications").insert({
          user_id: event.creatorId,
          type: "system",
          title: notificationTitle,
          message: notificationMessage,
          action_url: `/payments/${event.payment.id}`,
          priority: event.event === "overdue" ? "high" : "normal",
          data: {
            module: "payments",
            event: event.event,
            payment_id: event.payment.id,
            due_date: event.payment.next_payment_due,
          },
        })

        if (event.event === "due") {
          dueNotified += 1
          await supabase
            .from("department_payments")
            .update({ due_notified_at: new Date().toISOString() })
            .eq("id", event.payment.id)
        } else {
          overdueNotified += 1
          await supabase
            .from("department_payments")
            .update({ overdue_notified_at: new Date().toISOString(), status: "overdue" })
            .eq("id", event.payment.id)
        }
      } catch (eventError) {
        console.error("Failed processing payment event", {
          paymentId: event.payment.id,
          creatorId: event.creatorId,
          event: event.event,
          error: eventError instanceof Error ? eventError.message : String(eventError),
        })
      }
    }

    console.log("Payment status check completed.")

    return new Response(
      JSON.stringify({
        message: "Payment status check completed",
        dueNotified,
        overdueNotified,
        updated: overdueIdsToMark.size,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    )
  } catch (error) {
    console.error("Error checking payment status:", error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
