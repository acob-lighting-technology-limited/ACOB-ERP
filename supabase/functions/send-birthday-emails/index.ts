import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { sendEmail } from "../_shared/email.ts"
import { writeEdgeAuditLog } from "../_shared/audit.ts"
import { EDGE_SENDERS } from "../_shared/senders.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const DEFAULT_SENDER = EDGE_SENDERS.birthday
const TIME_ZONE = "Africa/Lagos"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Unknown error"
}

/** Today in Africa/Lagos as { mmdd: "MM-DD", year }. */
function lagosToday(now: Date): { mmdd: string; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return { mmdd: `${get("month")}-${get("day")}`, year: Number(get("year")) }
}

function normEmail(value?: string | null): string | null {
  const email = String(value || "")
    .trim()
    .toLowerCase()
  return email.includes("@") ? email : null
}

function escapeHtml(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildBirthdayHtml(firstName: string): string {
  const name = escapeHtml((firstName || "").trim()) || "there"
  return (
    "<!DOCTYPE html>" +
    '<html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Happy Birthday from ACOB Lighting</title><style>" +
    'body{margin:0;padding:0;background:#fff;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif}' +
    ".email-shell{max-width:600px;margin:0 auto;overflow:hidden}" +
    ".wrapper{max-width:600px;margin:0 auto;background:#fff;padding:36px 28px;text-align:center}" +
    ".title{font-size:26px;font-weight:700;color:#111827;margin:0 0 4px 0}" +
    ".subtitle{font-size:15px;color:#16a34a;font-weight:600;margin:0 0 22px 0;letter-spacing:.04em;text-transform:uppercase}" +
    ".text{font-size:15px;color:#374151;line-height:1.7;margin:0 0 18px 0;text-align:left}" +
    ".card{margin-top:8px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:22px 24px}" +
    ".card .text{margin:0;color:#166534;text-align:center;font-size:16px;font-style:italic;line-height:1.6}" +
    '</style></head><body><div class="email-shell">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://erp.acoblighting.com/images/acob-logo-dark.png" alt="ACOB Lighting" height="65"></td></tr></table>' +
    '<div class="wrapper">' +
    `<div class="title">Happy Birthday, ${name}! &#127881;</div>` +
    '<div class="subtitle">From all of us at ACOB Lighting</div>' +
    `<p class="text">Dear ${name},</p>` +
    '<p class="text">On behalf of the entire ACOB Lighting Technology Limited family, we wish you a very happy birthday! Today is all about you &mdash; we hope it is filled with joy, laughter, and the company of the people you love.</p>' +
    '<p class="text">Thank you for the energy, dedication, and spirit you bring to our team every single day. We are grateful to have you with us, and we look forward to celebrating many more milestones together.</p>' +
    '<div class="card"><p class="text">Wishing you a year ahead full of good health, happiness, and success. Enjoy your special day!</p></div>' +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<span style="color:#f3f4f6;">Admin &amp; HR Department</span><br>' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Employee Management System</span><br><br>' +
    '<i style="color:#9ca3af;font-style:italic;">This is an automated message. Please do not reply directly to this email.</i>' +
    "</td></tr></table></div></body></html>"
  )
}

type BirthdayProfile = {
  id: string
  first_name: string | null
  company_email: string | null
  additional_email: string | null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return new Response("Unauthorized", { status: 401 })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Optional test override: { testEmail, testName } sends a single preview and skips logging.
    const body = await req.json().catch(() => ({}))
    const testEmail = normEmail(body?.testEmail)
    if (testEmail) {
      const data = await sendEmail({
        from: DEFAULT_SENDER,
        to: testEmail,
        cc: normEmail(body?.testCc) || undefined,
        subject: "Happy Birthday from ACOB Lighting!",
        html: buildBirthdayHtml(body?.testName || "Friend"),
        traceLabel: `birthday-test:${testEmail}`,
      })
      return new Response(JSON.stringify({ success: true, test: true, emailId: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      })
    }

    const { mmdd, year } = lagosToday(new Date())

    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, first_name, company_email, additional_email")
      .eq("birthday", mmdd)
      .eq("employment_status", "active")
    if (error) throw new Error(`Failed to load birthday profiles: ${error.message}`)

    // Dedup key: (user_id, sent_year, birthday). If someone's birthday is corrected
    // after an earlier send, the old log row has a different `birthday` value and
    // will not block the send on their real birthday.
    const { data: alreadySent } = await supabase
      .from("birthday_email_log")
      .select("user_id")
      .eq("sent_year", year)
      .eq("birthday", mmdd)
    const sentUserIds = new Set((alreadySent || []).map((r: { user_id: string }) => r.user_id))

    const results: Array<{ user_id: string; to: string; success: boolean; error?: string }> = []

    for (const p of (profiles || []) as BirthdayProfile[]) {
      if (sentUserIds.has(p.id)) continue
      const primary = normEmail(p.company_email)
      const cc = normEmail(p.additional_email)
      const recipient = primary || cc
      if (!recipient) continue
      const ccAddr = cc && cc !== recipient ? cc : undefined

      try {
        const data = await sendEmail({
          from: DEFAULT_SENDER,
          to: recipient,
          cc: ccAddr,
          subject: "Happy Birthday from ACOB Lighting!",
          html: buildBirthdayHtml(p.first_name || ""),
          traceLabel: `birthday:${recipient}`,
        })
        await supabase.from("birthday_email_log").insert({ user_id: p.id, sent_year: year, birthday: mmdd, recipient })

        // Mirror the email as an in-app notification. Every mail a user receives
        // externally must also land in their ERP notification bell.
        const { error: notifyError } = await supabase.from("notifications").insert({
          user_id: p.id,
          type: "announcement",
          category: "system",
          priority: "normal",
          title: "Happy Birthday from ACOB Lighting! 🎉",
          message: "On behalf of the entire ACOB Lighting family, we wish you a very happy birthday!",
          link_url: null,
        })
        if (notifyError) console.error(`[birthday] in-app notification failed for ${p.id}: ${notifyError.message}`)

        results.push({ user_id: p.id, to: recipient, success: true })
        console.log(`[birthday] sent to ${recipient} (id ${data.id})`)
      } catch (err) {
        results.push({ user_id: p.id, to: recipient, success: false, error: getErrorMessage(err) })
        console.error(`[birthday] failed for ${recipient}: ${getErrorMessage(err)}`)
      }
    }

    const successCount = results.filter((r) => r.success).length
    if (successCount > 0) {
      try {
        await writeEdgeAuditLog(supabase, {
          action: "birthday_emails_sent",
          entityType: "birthday_email",
          entityId: crypto.randomUUID(),
          department: "Admin & HR",
          source: "edge",
          route: "/functions/send-birthday-emails",
          metadata: { date: mmdd, year, candidates: profiles?.length ?? 0, sent: successCount },
        })
      } catch (auditErr) {
        console.error("[birthday] audit log failed:", auditErr)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: mmdd,
        year,
        candidates: profiles?.length ?? 0,
        sent: successCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )
  } catch (err) {
    console.error("[send-birthday-emails] Error:", err)
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
