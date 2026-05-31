import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { logger } from "@/lib/logger"
import { renderBirthdayEmail } from "@/lib/email-templates/birthday"
import { ORG_NOTIFICATION_SENDER } from "@/lib/org-config"

const log = logger("cron-birthdays")

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Today's date in Africa/Lagos as { mmdd: "MM-DD", year: 2026 }. */
function lagosToday(): { mmdd: string; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return { mmdd: `${get("month")}-${get("day")}`, year: Number(get("year")) }
}

function normEmail(value?: string | null): string | null {
  const email = (value || "").trim().toLowerCase()
  return email.includes("@") ? email : null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`
  if (!safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY
  if (!supabaseUrl || !supabaseServiceKey || !resendKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const resend = new Resend(resendKey)

  const { mmdd, year } = lagosToday()

  // Active employees whose birthday (MM-DD) is today.
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, first_name, company_email, additional_email, employment_status")
    .eq("birthday", mmdd)
    .eq("employment_status", "active")

  if (error) {
    log.error({ err: String(error), mmdd }, "Failed to load birthday profiles")
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 })
  }

  // Skip anyone already emailed this calendar year.
  const { data: alreadySent } = await supabase.from("birthday_email_log").select("user_id").eq("sent_year", year)
  const sentUserIds = new Set((alreadySent || []).map((r) => r.user_id))

  let sent = 0
  const failures: Array<{ user_id: string; reason: string }> = []

  for (const p of profiles || []) {
    if (sentUserIds.has(p.id)) continue
    // Primary recipient is the employee's company email; their additional email is CC'd.
    // No one else receives the message.
    const primary = normEmail(p.company_email)
    const cc = normEmail(p.additional_email)
    const recipient = primary || cc
    if (!recipient) continue
    const ccList = cc && cc !== recipient ? [cc] : undefined

    try {
      const { error: sendError } = await resend.emails.send({
        from: ORG_NOTIFICATION_SENDER,
        to: [recipient],
        ...(ccList ? { cc: ccList } : {}),
        subject: "Happy Birthday from ACOB Lighting!",
        html: renderBirthdayEmail({ firstName: p.first_name || "" }),
      })
      if (sendError) throw new Error(sendError.message || "send_failed")

      await supabase.from("birthday_email_log").insert({ user_id: p.id, sent_year: year, recipient })
      sent++
    } catch (err) {
      failures.push({ user_id: p.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  log.info(
    { mmdd, year, candidates: profiles?.length ?? 0, sent, failed: failures.length },
    "Birthday emails processed"
  )
  return NextResponse.json({
    date: mmdd,
    year,
    candidates: profiles?.length ?? 0,
    sent,
    failed: failures.length,
    failures,
  })
}
