import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { writeEdgeAuditLog } from "../_shared/audit.ts"
import { sendEmail } from "../_shared/email.ts"
import { EDGE_MAIL_ROUTING, EDGE_SENDERS, SENDER_ADDRESS } from "../_shared/senders.ts"
import {
  getCurrentOfficeWeek,
  getOfficeWeekFromDate,
  initOfficeYearAnchors,
  resolveEffectiveMeetingDateIso,
} from "../_shared/meeting-date.ts"
import { isEdgeSystemEmailEnabled } from "../_shared/notification-gateway.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type ReminderType = "meeting" | "knowledge_sharing"

type KnowledgePresenter = {
  id?: string
  full_name?: string
  presenter_name?: string
  name?: string
  department?: string | null
}

const DEFAULT_TIME_ZONE = "Africa/Lagos"
const DEFAULT_SENDER = EDGE_SENDERS.system
// Configurable contact for meeting questions. Falls back to the shared
// notifications mailbox (never a specific person, who may exit).
const MEETING_CONTACT_EMAIL = Deno.env.get("MEETING_CONTACT_EMAIL") || SENDER_ADDRESS

type ReminderRequestBody = {
  type: ReminderType
  recipients: string[]
  meetingDate?: string
  meetingWeek?: number
  meetingYear?: number
  meetingTime?: string
  teamsLink?: string
  agenda?: string[]
  meetingPreparedByName?: string
  meetingPreparedByDesignation?: string
  meetingPreparedByDepartment?: string
  sessionDate?: string
  sessionTime?: string
  duration?: string
  knowledgeSharingDepartment?: string
  knowledgeSharingPresenter?: KnowledgePresenter
  kssRosterStatus?: string
  requestedByUserId?: string
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Unknown error"
}

function withSubjectPrefix(moduleName: string, subject: string): string {
  return String(subject || "").trim() || "Notification"
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
}

function getKnowledgePresenterName(value?: KnowledgePresenter): string | null {
  const fullName = String(value?.full_name || value?.presenter_name || value?.name || "").trim()
  return fullName || null
}

function isKnowledgeSharingAgendaItem(item: string): boolean {
  return /knowledge\s*sharing\s*session/i.test(String(item || ""))
}

async function createInAppMeetingNotifications(params: {
  supabase: ReturnType<typeof createClient>
  recipients: string[]
  successfulResults: DeliveryResult[]
  subject: string
  reminderType: ReminderType
  requestedByUserId?: string
  meetingDate?: string
  meetingTime?: string
  knowledgeSharingDepartment?: string
  knowledgeSharingPresenter?: KnowledgePresenter
}) {
  const {
    supabase,
    recipients,
    successfulResults,
    subject,
    reminderType,
    requestedByUserId,
    meetingDate,
    meetingTime,
    knowledgeSharingDepartment,
    knowledgeSharingPresenter,
  } = params
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

  const notificationTitle = reminderType === "meeting" ? "General Meeting Reminder" : "Knowledge Sharing Reminder"
  let notificationRows: Array<Record<string, unknown>> = Array.from(userIds).map((userId) => ({
    user_id: userId,
    type: "system",
    category: "meetings",
    priority: "normal",
    title: notificationTitle,
    message: subject,
    action_url: "/notifications",
    actor_id: requestedByUserId || null,
    data: {
      module: "meetings",
      event: reminderType === "meeting" ? "meeting_reminder" : "knowledge_sharing_reminder",
      meeting_date: meetingDate || null,
      meeting_time: meetingTime || null,
      knowledge_sharing_department: knowledgeSharingDepartment || null,
      knowledge_sharing_presenter: getKnowledgePresenterName(knowledgeSharingPresenter),
      recipient_email_count: successfulEmailSet.size,
      sent_at: new Date().toISOString(),
    },
  }))

  // Handle schema drift safely: retry insert by removing unknown columns reported by PostgREST.
  const maxInsertAttempts = 4
  for (let attempt = 1; attempt <= maxInsertAttempts; attempt++) {
    const { error: insertError } = await supabase.from("notifications").insert(notificationRows)
    if (!insertError) {
      return
    }

    const missingColumnMatch = insertError.message.match(/Could not find the '([^']+)' column/i)
    const missingColumn = missingColumnMatch?.[1]
    if (!missingColumn) {
      throw new Error(`Failed to create in-app notifications: ${insertError.message}`)
    }

    const hasColumnInRows = notificationRows.some((row) => Object.prototype.hasOwnProperty.call(row, missingColumn))
    if (!hasColumnInRows || attempt === maxInsertAttempts) {
      throw new Error(`Failed to create in-app notifications: ${insertError.message}`)
    }

    console.warn(`[meeting-reminder] notifications schema drift detected; retrying without column '${missingColumn}'`)
    notificationRows = notificationRows.map((row) => {
      const { [missingColumn]: _, ...rest } = row
      return rest
    })
  }
}

function normalizeMeetingAgenda(agendaInput: string[] | string | undefined): string[] {
  const parsedAgenda = Array.isArray(agendaInput)
    ? agendaInput
    : typeof agendaInput === "string"
      ? agendaInput
          .split(/\r?\n/)
          .map((line) => line.replace(/^\d+\.\s*/, "").trim())
          .filter(Boolean)
      : []

  return parsedAgenda
}

function buildMeetingReminderHtml(
  meetingDate: string | undefined,
  meetingTime: string,
  teamsLink: string,
  agenda: string[],
  preparedByName?: string,
  preparedByDesignation?: string,
  preparedByDepartment?: string,
  kssPresenter?: KnowledgePresenter,
  kssDepartment?: string
): string {
  const { timingPhrase, effectiveDate } = getMeetingReminderDescriptor(meetingDate, meetingTime)
  const displayTime = formatTimeWithMeridiem(meetingTime)
  const preparedBy = escapeHtml(preparedByName?.trim() || "ACOB Team")
  const designation = escapeHtml(preparedByDesignation?.trim() || "")
  const department = escapeHtml(preparedByDepartment?.trim() || "Admin and HR")
  const presenterName = getKnowledgePresenterName(kssPresenter)
  const isGuestPresenter = Boolean(presenterName) && !kssPresenter?.id
  const presenterDisplayText = presenterName ? `${presenterName}${isGuestPresenter ? " (Guest)" : ""}` : ""
  const kssDepartmentLabel = (kssDepartment || kssPresenter?.department || "").trim()
  const agendaRows = [...agenda]
  const kssAgendaIndex = agendaRows.findIndex((item) => isKnowledgeSharingAgendaItem(item))
  if (kssAgendaIndex >= 0 && presenterDisplayText) {
    const departmentSuffix = !isGuestPresenter && kssDepartmentLabel ? ` (${kssDepartmentLabel})` : ""
    agendaRows[kssAgendaIndex] = `${agendaRows[kssAgendaIndex]} - ${presenterDisplayText}${departmentSuffix}`
  }

  let agendaHtml = ""
  for (let i = 0; i < agendaRows.length; i++) {
    agendaHtml +=
      '<tr><td style="padding: 10px 18px; font-size: 14px; color: #374151; border-bottom: 1px solid #e5e7eb;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td valign="top" style="width: 36px; padding: 0 12px 0 0;">' +
      '<span style="display: inline-block; background: #000; color: #16a34a; font-weight: 700; width: 24px; height: 24px; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px;">' +
      (i + 1) +
      "</span>" +
      "</td>" +
      '<td valign="top" style="padding: 2px 0 0 0; color: #374151; line-height: 1.5;">' +
      escapeHtml(agendaRows[i]) +
      "</td>" +
      "</tr></table>" +
      "</td></tr>"
  }

  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Meeting Reminder</title>" +
    "<style>" +
    'body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }" +
    ".outer-header { background: #000; padding: 20px 0; text-align: center; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }" +
    ".wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }" +
    ".title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 14px; }" +
    ".text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; }" +
    ".card { margin: 22px 0; border: 1px solid #d1d5db; overflow: hidden; background: #f9fafb; border-radius: 8px; }" +
    ".card-header { padding: 12px 18px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #d1d5db; background: #eff6ff; color: #1e40af; }" +
    ".cta { text-align: center; margin: 28px 0; }" +
    ".button { display: inline-block; background: #1e40af; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }" +
    ".note-box { background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 16px 20px; font-size: 14px; color: #92400e; margin: 20px 0; line-height: 1.6; }" +
    ".footer { background: #000; padding: 20px; text-align: center; font-size: 11px; color: #d1d5db; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }" +
    ".footer strong { color: #fff; }" +
    ".footer-system { color: #16a34a; font-weight: 600; }" +
    ".footer-note { color: #9ca3af; font-style: italic; }" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="email-shell">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    '<div class="wrapper">' +
    '<div class="title">Reminder for General Weekly Meeting</div>' +
    '<p class="text">Dear All,</p>' +
    '<p class="text">' +
    "Please find below the agenda for our general weekly meeting, scheduled to take place " +
    timingPhrase +
    " " +
    "<strong>" +
    effectiveDate +
    "</strong>, at <strong>" +
    displayTime +
    "</strong>. " +
    "You can access the meeting using the link below:" +
    "</p>" +
    '<div class="cta">' +
    '<a href="' +
    teamsLink +
    '" class="button" style="color: #fff;"><strong>🔗 Click to Join via Microsoft Teams</strong></a>' +
    "</div>" +
    '<div class="card">' +
    '<div class="card-header">Agenda</div>' +
    '<table style="width: 100%; border-collapse: collapse;">' +
    agendaHtml +
    "</table>" +
    "</div>" +
    '<div class="note-box">' +
    "<strong>Note:</strong> Your attendance is crucial to ensure we're all on the same page and can collaborate effectively. " +
    `Please join on time, and feel free to reach out to <a href="mailto:${MEETING_CONTACT_EMAIL}" style="color:#1e40af;font-weight:600;text-decoration:none;">me</a> or any team member if you have questions or concerns.` +
    "</div>" +
    '<p class="text" style="text-align: center; font-weight: 600; color: #16a34a;">Looking forward to seeing you there.</p>' +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<span style="color:#f3f4f6;">Prepared by ' +
    preparedBy +
    "</span><br>" +
    (designation ? designation + "<br>" : "") +
    department +
    "<br>" +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Meeting Management System</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated notification, but replies are read — reply to this email and it reaches the team that sent it.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

function formatTimeWithMeridiem(timeText: string): string {
  const value = String(timeText || "")
    .trim()
    .toLowerCase()
  const ampmMatch = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/)
  if (ampmMatch) {
    const hour = Number(ampmMatch[1])
    const minute = ampmMatch[2]
    const period = ampmMatch[3].toUpperCase()
    return `${hour}:${minute} ${period}`
  }
  const simpleMatch = value.match(/^(\d{1,2}):(\d{2})$/)
  if (simpleMatch) {
    const date = new Date(`2000-01-01T${simpleMatch[1].padStart(2, "0")}:${simpleMatch[2]}:00`)
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  }
  return "8:30 AM"
}

function buildKnowledgeSharingHtml(sessionDate: string, sessionTime: string, duration: string): string {
  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Knowledge Sharing Reminder</title>" +
    "<style>" +
    'body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }' +
    ".email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }" +
    ".outer-header { background: #000; padding: 20px 0; text-align: center; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }" +
    ".wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }" +
    ".title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 14px; }" +
    ".text { font-size: 15px; color: #374151; line-height: 1.7; margin: 0 0 18px 0; }" +
    ".note-box { background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px 20px; font-size: 14px; color: #92400e; margin: 20px 0; line-height: 1.6; text-align: center; }" +
    ".alert-badge { display: inline-block; background: #dc2626; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; }" +
    ".footer { background: #000; padding: 20px; text-align: center; font-size: 11px; color: #d1d5db; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }" +
    ".footer strong { color: #fff; }" +
    ".footer-system { color: #16a34a; font-weight: 600; }" +
    ".footer-note { color: #9ca3af; font-style: italic; }" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="email-shell">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">' +
    '<img src="https://matrix.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">' +
    "</td></tr></table>" +
    '<div class="wrapper">' +
    '<div class="title">Reminder: Knowledge Sharing Session</div>' +
    '<p class="text">Dear Team,</p>' +
    '<p class="text">' +
    "This is a reminder that the <strong>Knowledge Sharing Session</strong> will hold on " +
    "<strong>" +
    sessionDate +
    "</strong>, commencing promptly at " +
    "<strong>" +
    sessionTime +
    "</strong> and will run for <strong>" +
    duration +
    "</strong>." +
    "</p>" +
    '<p class="text">Immediately after, the <strong>General Meeting</strong> will commence.</p>' +
    '<p class="text">Kindly ensure you are seated and ready on time.</p>' +
    '<div class="note-box">' +
    '<span class="alert-badge">Mandatory</span><br><br>' +
    "Attendance is mandatory for all team members." +
    "</div>" +
    "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">' +
    '<tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">' +
    '<span style="color:#f3f4f6;">Prepared by Admin &amp; HR</span><br>' +
    "Administrative Team<br>" +
    "Admin &amp; HR Department<br>" +
    '<strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>' +
    '<span style="color:#16a34a;font-weight:600;">Meeting Management System</span>' +
    "<br><br>" +
    '<i style="color:#9ca3af;">This is an automated notification, but replies are read — reply to this email and it reaches the team that sent it.</i>' +
    "</td></tr></table>" +
    "</div>" +
    "</body>" +
    "</html>"
  )
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getLagosNowParts(now: Date): {
  weekday: number
  year: number
  month: number
  day: number
  hour: number
  minute: number
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now)

  const getPart = (type: string): string => parts.find((p) => p.type === type)?.value || ""
  const weekdayRaw = getPart("weekday").toLowerCase()
  const weekdayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

  return {
    weekday: weekdayMap[weekdayRaw.slice(0, 3)] ?? 0,
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
  }
}

function parseTimeToMinutes(timeText: string): number {
  const value = String(timeText || "")
    .trim()
    .toLowerCase()
  const ampmMatch = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/)
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]) % 12
    const minute = Number(ampmMatch[2])
    if (ampmMatch[3] === "pm") hour += 12
    return hour * 60 + minute
  }
  const simpleMatch = value.match(/^(\d{1,2}):(\d{2})$/)
  if (simpleMatch) {
    return Number(simpleMatch[1]) * 60 + Number(simpleMatch[2])
  }
  return 8 * 60 + 30
}

function formatDateWithOrdinal(date: Date): string {
  const day = date.getUTCDate()
  const suffix = [1, 21, 31].includes(day) ? "st" : [2, 22].includes(day) ? "nd" : [3, 23].includes(day) ? "rd" : "th"
  const month = date.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })
  const year = date.getUTCFullYear()
  return `${day}${suffix} ${month}, ${year}`
}

function parseMeetingDateInput(meetingDate: string | undefined): Date | null {
  if (!meetingDate) return null
  const raw = String(meetingDate).trim()

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])))
  }

  const normalized = raw
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return null

  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))
}

function formatWeekday(date: Date): string {
  return date.toLocaleString("en-GB", { weekday: "long", timeZone: "UTC" })
}

function getMeetingReminderDescriptor(
  meetingDate: string | undefined,
  meetingTime: string
): { timingPhrase: string; effectiveDate: string } {
  const now = new Date()
  const lagos = getLagosNowParts(now)
  const threshold = parseTimeToMinutes(meetingTime)
  const currentMinutes = lagos.hour * 60 + lagos.minute

  const todayUtc = new Date(Date.UTC(lagos.year, lagos.month - 1, lagos.day))
  const targetDate = parseMeetingDateInput(meetingDate)

  // Fallback for older payloads: preserve Monday automation.
  let resolved = targetDate
  if (!resolved) {
    let daysUntilMonday = (8 - lagos.weekday) % 7
    if (lagos.weekday === 1 && currentMinutes >= threshold) daysUntilMonday = 7
    resolved = new Date(todayUtc)
    resolved.setUTCDate(resolved.getUTCDate() + daysUntilMonday)
  }

  let diffDays = Math.floor((resolved.getTime() - todayUtc.getTime()) / (24 * 60 * 60 * 1000))
  let effective = new Date(resolved)
  let timingPhrase = `on ${formatWeekday(effective)},`

  if (diffDays < 0) {
    effective = new Date(effective)
    effective.setUTCDate(effective.getUTCDate() + 7)
    diffDays = Math.floor((effective.getTime() - todayUtc.getTime()) / (24 * 60 * 60 * 1000))
  }

  if (diffDays === 0) {
    if (currentMinutes < threshold) {
      timingPhrase = "today,"
    } else {
      effective = new Date(effective)
      effective.setUTCDate(effective.getUTCDate() + 7)
      timingPhrase = `next week ${formatWeekday(effective)},`
    }
  } else if (diffDays === 1) {
    timingPhrase = "tomorrow,"
  } else if (diffDays === 2) {
    timingPhrase = "next tomorrow,"
  }

  return { timingPhrase, effectiveDate: formatDateWithOrdinal(effective) }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const requestStartedAt = Date.now()
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return new Response("Unauthorized", { status: 401 })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    await initOfficeYearAnchors(supabase)
    const meetingsMailEnabled = await isEdgeSystemEmailEnabled(supabase, "meetings")
    if (!meetingsMailEnabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "meetings_email_disabled" }), {
        status: 200,
      })
    }

    const body = (await req.json()) as ReminderRequestBody

    const {
      type,
      recipients,
      meetingTime,
      meetingDate,
      teamsLink,
      agenda,
      meetingPreparedByName,
      meetingPreparedByDesignation,
      meetingPreparedByDepartment,
      sessionDate,
      sessionTime,
      duration,
      knowledgeSharingDepartment,
      knowledgeSharingPresenter,
      kssRosterStatus,
      requestedByUserId,
    } = body

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No recipients" }), { status: 400 })
    }

    let html: string
    let subject: string
    let effectiveMeetingDate = meetingDate
    const from = DEFAULT_SENDER

    if (type === "meeting") {
      const parsedMeetingDate = parseMeetingDateInput(meetingDate)
      const dayDiffFromToday = parsedMeetingDate
        ? Math.floor((parsedMeetingDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null

      // Prefer the office week derived from the meeting date. The date is
      // regenerated on every recurring send, whereas an explicit
      // meetingWeek/meetingYear may be a stale value frozen into the schedule's
      // meeting_config at creation time. Trusting the stale week caused
      // reminders to announce meeting dates weeks in the past.
      const resolvedOfficeWeek =
        parsedMeetingDate && dayDiffFromToday !== null && Math.abs(dayDiffFromToday) <= 7
          ? getOfficeWeekFromDate(
              new Date(
                parsedMeetingDate.getUTCFullYear(),
                parsedMeetingDate.getUTCMonth(),
                parsedMeetingDate.getUTCDate()
              )
            )
          : typeof body?.meetingWeek === "number" && typeof body?.meetingYear === "number"
            ? { week: body.meetingWeek, year: body.meetingYear }
            : getCurrentOfficeWeek()

      effectiveMeetingDate = await resolveEffectiveMeetingDateIso(
        supabase,
        resolvedOfficeWeek.week,
        resolvedOfficeWeek.year
      )

      const normalizedAgenda = normalizeMeetingAgenda(agenda)
      if (kssRosterStatus === "missing") {
        console.warn("[meeting-reminder] KSS roster missing for recurring schedule; sending without roster enrichment")
      }

      subject = withSubjectPrefix("Meetings", "Meeting Reminder — General Weekly Meeting")
      html = buildMeetingReminderHtml(
        effectiveMeetingDate,
        meetingTime || "8:30 AM",
        teamsLink || "",
        normalizedAgenda,
        meetingPreparedByName,
        meetingPreparedByDesignation,
        meetingPreparedByDepartment,
        knowledgeSharingPresenter,
        knowledgeSharingDepartment
      )
    } else {
      subject = withSubjectPrefix("Meetings", "Meeting Reminder — Knowledge Sharing Session")
      html = buildKnowledgeSharingHtml(sessionDate || "Monday", sessionTime || "8:30am", duration || "30 minutes")
    }

    console.log("[meeting-reminder] Sending " + type + " to " + recipients.length + " recipients")
    console.log(
      "[meeting-reminder] request summary",
      JSON.stringify({
        elapsed_ms: Date.now() - requestStartedAt,
        type,
        recipient_count: recipients.length,
        meeting_date: effectiveMeetingDate || null,
        meeting_time: meetingTime || null,
      })
    )

    const results: DeliveryResult[] = []
    for (const [index, to] of recipients.entries()) {
      const recipientStartedAt = Date.now()
      try {
        const data = await sendEmail({
          from,
          ...EDGE_MAIL_ROUTING.meetings,
          to,
          subject,
          html,
          traceLabel: `meeting-reminder:${type}:${index + 1}/${recipients.length}:${to}`,
        })
        console.log("[meeting-reminder] Sent to " + to + ". ID: " + data.id)
        console.log(
          "[meeting-reminder] recipient send completed",
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
        results.push({ to, success: true, emailId: data.id })
      } catch (error) {
        console.error("[meeting-reminder] Failed to send to " + to + ":", JSON.stringify(error))
        results.push({ to, success: false, error })
      }
    }

    console.log(
      "[meeting-reminder] send cycle completed",
      JSON.stringify({
        total_elapsed_ms: Date.now() - requestStartedAt,
        type,
        recipient_count: recipients.length,
        success_count: results.filter((result) => result.success).length,
        failure_count: results.filter((result) => !result.success).length,
      })
    )

    const successfulResults = results.filter((result) => result.success)
    try {
      await createInAppMeetingNotifications({
        supabase,
        recipients,
        successfulResults,
        subject,
        reminderType: type,
        requestedByUserId,
        meetingDate: effectiveMeetingDate,
        meetingTime,
        knowledgeSharingDepartment,
        knowledgeSharingPresenter,
      })
    } catch (notificationError) {
      console.error("[meeting-reminder] Failed to create in-app notifications:", notificationError)
    }

    try {
      const successCount = successfulResults.length
      const failureCount = results.length - successCount
      const auditEntityId = crypto.randomUUID()
      await writeEdgeAuditLog(supabase, {
        action: "meeting_reminder_sent",
        entityType: "communications_mail",
        entityId: auditEntityId,
        actorId: requestedByUserId || null,
        department: "Admin and HR",
        source: "edge",
        route: "/functions/send-meeting-reminder",
        metadata: {
          reminder_type: type,
          recipient_count: recipients.length,
          success_count: successCount,
          failure_count: failureCount,
          subject,
          meeting_date: effectiveMeetingDate || null,
          meeting_time: meetingTime || null,
          knowledge_sharing_department: knowledgeSharingDepartment || null,
          knowledge_sharing_presenter: getKnowledgePresenterName(knowledgeSharingPresenter),
          kss_roster_status: kssRosterStatus || null,
          prepared_by: meetingPreparedByName || null,
          prepared_by_designation: meetingPreparedByDesignation || null,
          prepared_by_department: meetingPreparedByDepartment || "Admin and HR",
        },
      })
    } catch (auditErr) {
      console.error("[meeting-reminder] Failed to write audit log:", auditErr)
    }

    return new Response(JSON.stringify({ success: true, type, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (err: unknown) {
    console.error("[send-meeting-reminder] Error:", err)
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
