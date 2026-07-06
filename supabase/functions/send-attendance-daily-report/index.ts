import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { sendEmail } from "../_shared/email.ts"
import { EDGE_SENDERS } from "../_shared/senders.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TIME_ZONE = "Africa/Lagos"
const SETTINGS_KEY = "attendance_daily_report_config"
const DEFAULT_POLICY = { endTime: "17:00", lateCutoff: "08:20" }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const STATUS_LABELS: Record<string, string> = {
  early: "Early",
  present: "Present",
  late: "Late",
  lateness_with_permission: "LWP",
  incomplete: "Incomplete",
  absent: "Absent",
  absent_with_permission: "AWP",
  out_of_station: "OOS",
  waiver: "Waiver",
  exempted: "Exempted",
  on_leave: "On Leave",
  holiday: "Holiday",
}

const STATUS_COLORS: Record<string, string> = {
  early: "#16a34a",
  present: "#2563eb",
  late: "#ca8a04",
  lateness_with_permission: "#16a34a",
  incomplete: "#0891b2",
  absent: "#dc2626",
  absent_with_permission: "#16a34a",
  out_of_station: "#4f46e5",
  waiver: "#2563eb",
  exempted: "#7c3aed",
  on_leave: "#9333ea",
  holiday: "#0284c7",
}

const DB_WRITABLE_STATUSES = new Set([
  "early",
  "present",
  "late",
  "absent",
  "incomplete",
  "waiver",
  "lateness_with_permission",
  "absent_with_permission",
  "out_of_station",
])
const PERMISSION_STATUSES = new Set(["lateness_with_permission", "absent_with_permission", "out_of_station"])

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Unknown error"
}

/** "now" resolved in Africa/Lagos as date/time/day-of-week parts. */
function lagosNow(now: Date = new Date()): { dateIso: string; hhmm: string; dow: number } {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const get = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const dateIso = `${get(dateParts, "year")}-${get(dateParts, "month")}-${get(dateParts, "day")}`
  const hhmm = `${get(timeParts, "hour")}:${get(timeParts, "minute")}`
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay()
  return { dateIso, hhmm, dow }
}

function timeToMinutes(value?: string | null): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function isLateWithPolicy(clockIn: string | null | undefined, lateCutoff: string): boolean {
  const inMin = timeToMinutes(clockIn)
  const cutoffMin = timeToMinutes(lateCutoff)
  if (inMin === null || cutoffMin === null) return false
  return inMin > cutoffMin
}

function isEarlyDeparture(clockOut: string, endTime: string): boolean {
  const outMin = timeToMinutes(clockOut)
  const endMin = timeToMinutes(endTime)
  if (outMin === null || endMin === null) return false
  return outMin < endMin
}

type AttendanceRecordRow = {
  status: string | null
  total_hours: number | null
  clock_in: string | null
  clock_out: string | null
  waived: boolean | null
}

/** Mirrors lib/hr/attendance-status.ts#deriveUnifiedAttendanceStatus for a single "today" record. */
function deriveStatus(
  input: {
    record: AttendanceRecordRow | null
    isHoliday: boolean
    isOnLeave: boolean
    isExempted: boolean
  },
  policy: { endTime: string; lateCutoff: string }
): string {
  if (input.isHoliday) return "holiday"
  if (input.isOnLeave) return "on_leave"
  if (input.isExempted) return "exempted"
  const rec = input.record
  if (!rec) return "absent"

  const rawStatus = rec.status
  const explicitStatus =
    rawStatus === "waived"
      ? "waiver"
      : rawStatus === "half_day"
        ? "late"
        : rawStatus && DB_WRITABLE_STATUSES.has(rawStatus)
          ? rawStatus
          : null
  if (explicitStatus && PERMISSION_STATUSES.has(explicitStatus)) return explicitStatus
  if (rec.waived) return "waiver"
  if (explicitStatus === "waiver") return "waiver"
  if (!rec.clock_in && !rec.clock_out) return "absent"

  // The report only ever covers "today", so a still-open punch is scored optimistically
  // (early/late) rather than "incomplete" — matches the Next.js app's live-day behaviour.
  if (rec.clock_in && !rec.clock_out) {
    return isLateWithPolicy(rec.clock_in, policy.lateCutoff) ? "late" : "early"
  }
  if (!rec.clock_in) return "incomplete"
  if (rec.clock_out && rec.clock_out <= rec.clock_in) return "incomplete"
  if (rec.clock_out && isEarlyDeparture(rec.clock_out, policy.endTime)) return "late"
  return isLateWithPolicy(rec.clock_in, policy.lateCutoff) ? "late" : "early"
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function formatDateLabel(dateIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateIso}T00:00:00Z`))
}

type ReportRow = {
  user_name: string
  department: string
  status: string
  clock_in: string | null
  clock_out: string | null
}

// Branded ACOB email shell — matches _shared/artifact-email.ts (black header/footer,
// green borders, ACOB logo, 600px wrapper) so this looks consistent with every other
// system email instead of inventing a one-off style.
function renderReportHtml(dateIso: string, rows: ReportRow[], summary: Record<string, number>): string {
  const dateLabel = formatDateLabel(dateIso)

  const summaryCells = Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([status, count]) => `
        <td style="padding:10px 14px;text-align:center;border:1px solid #d1d5db;background:#f9fafb;">
          <div style="font-size:20px;font-weight:700;color:${STATUS_COLORS[status] ?? "#6b7280"};">${count}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.02em;">${
            STATUS_LABELS[status] ?? status
          }</div>
        </td>`
    )
    .join("")

  const bodyRows = rows
    .map(
      (r) => `
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.user_name)}</td>
          <td style="padding:8px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.department)}</td>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e5e7eb;">
            <span style="color:${STATUS_COLORS[r.status] ?? "#6b7280"};font-weight:600;">${
              STATUS_LABELS[r.status] ?? r.status
            }</span>
          </td>
          <td style="padding:8px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">${r.clock_in ? r.clock_in.substring(0, 5) : "—"}</td>
          <td style="padding:8px 12px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">${r.clock_out ? r.clock_out.substring(0, 5) : "—"}</td>
        </tr>`
    )
    .join("")

  return (
    "<!DOCTYPE html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<style>" +
    'body { margin:0; padding:0; background:#fff; font-family:"Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".wrapper { max-width:680px; margin:0 auto; background:#fff; padding:32px 28px; }" +
    ".title { font-size:20px; font-weight:700; color:#111827; margin:0 0 6px; }" +
    ".text { font-size:14px; color:#374151; line-height:1.6; margin:0 0 16px; }" +
    ".card { margin:22px 0; border:1px solid #d1d5db; overflow:hidden; background:#f9fafb; border-radius:8px; }" +
    ".card-header { padding:12px 18px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #d1d5db; background:#ecfdf5; color:#065f46; }" +
    "</style></head><body>" +
    '<div style="background:#f3f4f6;padding:24px 0;">' +
    // Header — background-color + linear-gradient(color,color) + mso-line-height-rule
    // together stop Gmail/Outlook dark mode from inverting this to a white bar.
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="60" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    // Body
    '<div class="wrapper">' +
    '<div class="title">Daily Attendance Report</div>' +
    `<p class="text">${escapeHtml(dateLabel)}</p>` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;">' +
    `<tr>${summaryCells}</tr>` +
    "</table>" +
    '<div class="card">' +
    '<div class="card-header">Employee Status</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    '<tr style="background:#f3f4f6;">' +
    '<th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;">Name</th>' +
    '<th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;">Department</th>' +
    '<th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;">Status</th>' +
    '<th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;">In</th>' +
    '<th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;">Out</th>' +
    "</tr>" +
    bodyRows +
    "</table></div>" +
    "</div>" +
    // Footer — same dark-mode lock as the header
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Attendance Reports System</span><br><br>' +
    '<i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i>' +
    "</td></tr></table>" +
    "</div></body></html>"
  )
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: settingRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle()

    const config = (settingRow?.value ?? {}) as {
      recipientUserIds?: string[]
      enabled?: boolean
      sendTimes?: string[]
      lastSentByTime?: Record<string, string>
    }

    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Ignore if no body provided (e.g. standard GET/POST from pg_cron)
    }

    const { testEmail, recipients: bodyRecipients, date: customDate, bypassChecks = false } = body
    const isTest = Boolean(testEmail || (bodyRecipients && bodyRecipients.length > 0) || bypassChecks)

    if (!isTest && !config.enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: "disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let today = lagosNow().dateIso
    const { hhmm: nowHHMM, dow } = lagosNow()
    if (customDate) {
      today = customDate
    }

    if (!isTest && (dow === 0 || dow === 6)) {
      return new Response(JSON.stringify({ skipped: true, reason: "weekend" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const sendTimes = Array.isArray(config.sendTimes) ? config.sendTimes : []
    const recipientUserIds = Array.isArray(config.recipientUserIds) ? config.recipientUserIds : []

    let dueTime = "manual"
    if (!isTest) {
      if (sendTimes.length === 0 || recipientUserIds.length === 0) {
        return new Response(JSON.stringify({ skipped: true, reason: "not_configured" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    const lastSentByTime = config.lastSentByTime ?? {}
    if (!isTest) {
      const foundDueTime = sendTimes.find((t) => nowHHMM >= t && lastSentByTime[t] !== today)
      if (!foundDueTime) {
        return new Response(JSON.stringify({ skipped: true, reason: "no_slot_due" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      dueTime = foundDueTime
    }

    let recipientEmails: string[] = []
    if (testEmail) {
      recipientEmails = [testEmail]
    } else if (Array.isArray(bodyRecipients) && bodyRecipients.length > 0) {
      recipientEmails = bodyRecipients
    }

    if (recipientEmails.length === 0) {
      if (recipientUserIds.length === 0) {
        return new Response(JSON.stringify({ skipped: true, reason: "no_recipients_configured" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: recipientProfiles } = await supabase
        .from("profiles")
        .select("id, company_email, additional_email")
        .in("id", recipientUserIds)
      recipientEmails = Array.from(
        new Set(
          (recipientProfiles ?? [])
            .map((p: { company_email: string | null; additional_email: string | null }) => p.company_email || p.additional_email)
            .filter((email: string | null): email is string => Boolean(email))
        )
      )
    }

    if (recipientEmails.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_recipient_emails" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: policyRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "attendance_policy")
      .maybeSingle()
    const policy = { ...DEFAULT_POLICY, ...((policyRow?.value as object) ?? {}) }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, department, attendance_exempt")
      .eq("employment_status", "active")
    const activeProfiles = (profiles ?? []) as Array<{
      id: string
      full_name: string | null
      first_name: string | null
      last_name: string | null
      department: string | null
      attendance_exempt: boolean | null
    }>
    const userIds = activeProfiles.map((p) => p.id)

    const [{ data: records }, { data: holidays }, { data: leaves }, { data: exemptPeriods }] = await Promise.all([
      supabase
        .from("attendance_records")
        .select("user_id, status, total_hours, clock_in, clock_out, waived")
        .eq("date", today)
        .in("user_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabase.from("holiday_calendar").select("holiday_date").eq("holiday_date", today),
      supabase
        .from("leave_requests")
        .select("user_id")
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today)
        .in("user_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabase
        .from("attendance_exempt_periods")
        .select("user_id")
        .lte("start_date", today)
        .gte("end_date", today)
        .in("user_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    ])

    const isHolidayToday = (holidays ?? []).length > 0
    const onLeaveSet = new Set((leaves ?? []).map((r: { user_id: string }) => r.user_id))
    const exemptSet = new Set((exemptPeriods ?? []).map((r: { user_id: string }) => r.user_id))
    const recordByUser = new Map<string, AttendanceRecordRow>()
    for (const r of (records ?? []) as Array<AttendanceRecordRow & { user_id: string }>) recordByUser.set(r.user_id, r)

    const summary: Record<string, number> = {}
    const rows: ReportRow[] = activeProfiles.map((profile) => {
      const rec = recordByUser.get(profile.id) ?? null
      const status = deriveStatus(
        {
          record: rec,
          isHoliday: isHolidayToday,
          isOnLeave: onLeaveSet.has(profile.id),
          isExempted: Boolean(profile.attendance_exempt) || exemptSet.has(profile.id),
        },
        policy
      )
      summary[status] = (summary[status] ?? 0) + 1
      const name =
        profile.full_name?.trim() || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Unknown"
      return {
        user_name: name,
        department: profile.department || "N/A",
        status,
        clock_in: rec?.clock_in ?? null,
        clock_out: rec?.clock_out ?? null,
      }
    })
    rows.sort((a, b) => a.department.localeCompare(b.department) || a.user_name.localeCompare(b.user_name))

    const html = renderReportHtml(today, rows, summary)
    const dateLabelShort = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${today}T00:00:00Z`))

    await sendEmail({
      to: recipientEmails,
      subject: `Daily Attendance Report — ${dateLabelShort}`,
      html,
      from: EDGE_SENDERS.hr,
      traceLabel: "attendance-daily-report",
    })

    if (!isTest) {
      await supabase.from("system_settings").upsert(
        { key: SETTINGS_KEY, value: { ...config, lastSentByTime: { ...lastSentByTime, [dueTime]: today } } },
        { onConflict: "key" }
      )
    }

    return new Response(
      JSON.stringify({ date: today, dueTime, recipients: recipientEmails.length, rowCount: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("Failed to send attendance daily report:", getErrorMessage(error))
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
