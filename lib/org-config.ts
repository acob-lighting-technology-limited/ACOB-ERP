/**
 * Organisation-wide configuration.
 *
 * Values are read from environment variables so they can be changed per-environment
 * (staging vs production) without a code deploy.
 *
 * Defaults match the current production setup. Override by setting the corresponding
 * env vars in .env.local or Vercel's project settings.
 *
 * ADDING A NEW SETTING
 * 1. Add the env var name + default below.
 * 2. Export a typed constant.
 * 3. Update .env.example with the new key and its default.
 */

import type { NotificationModule } from "@/lib/notifications/subject-policy"

// ---------------------------------------------------------------------------
// Company identity
// ---------------------------------------------------------------------------

/** Primary domain for company email addresses (e.g. "acoblighting.com") */
export const ORG_PRIMARY_DOMAIN = process.env.NEXT_PUBLIC_ORG_PRIMARY_DOMAIN ?? "acoblighting.com"

/** Secondary domain used for staff email accounts */
export const ORG_STAFF_DOMAIN = process.env.NEXT_PUBLIC_ORG_STAFF_DOMAIN ?? "org.acoblighting.com"

/** All accepted inbound email domains — used for validation */
export const ORG_EMAIL_DOMAINS: readonly string[] = [ORG_PRIMARY_DOMAIN, ORG_STAFF_DOMAIN]

/** Short company code prefix used in employee numbers and asset IDs */
export const ORG_CODE = process.env.NEXT_PUBLIC_ORG_CODE ?? "ACOB"

/** IT/ICT contact email shown in system emails */
export const ORG_ICT_EMAIL = process.env.NEXT_PUBLIC_ORG_ICT_EMAIL ?? `ict@${ORG_PRIMARY_DOMAIN}`

/** Admin & HR department mailbox — replies to HR, leave, exit, attendance mail. */
export const ORG_HR_EMAIL = process.env.ORG_HR_EMAIL ?? `hradmin@${ORG_PRIMARY_DOMAIN}`

/** Accounts department mailbox — replies to payment mail. */
export const ORG_ACCOUNTS_EMAIL = process.env.ORG_ACCOUNTS_EMAIL ?? `accounts@${ORG_PRIMARY_DOMAIN}`

/**
 * Corporate Services contact for correspondence replies. Unlike the others this
 * is a named individual (the department lead) rather than a shared mailbox, so
 * it needs updating if the role changes hands — hence the env override.
 */
export const ORG_CORPORATE_SERVICES_EMAIL = process.env.ORG_CORPORATE_SERVICES_EMAIL ?? `a.peter@${ORG_PRIMARY_DOMAIN}`

/** Sender display name + address used for all outbound notification emails */
export const ORG_NOTIFICATION_SENDER =
  process.env.ORG_NOTIFICATION_SENDER ?? `${ORG_CODE} Lighting Technology Limited <notifications@${ORG_PRIMARY_DOMAIN}>`

// ---------------------------------------------------------------------------
// Outbound email sender identities ("From" display names)
//
// SINGLE SOURCE OF TRUTH — never hardcode a sender string in a mailer. Every
// outbound email in the Next app must pick its "From" from here so the names
// can never drift (e.g. "HR" vs "Admin & HR"). Edge functions live in a
// separate runtime and mirror these in supabase/functions/_shared/senders.ts.
// ---------------------------------------------------------------------------

/** Shared notifications mailbox all subsystem senders send from. */
export const ORG_SENDER_ADDRESS = process.env.ORG_SENDER_ADDRESS ?? `notifications@${ORG_PRIMARY_DOMAIN}`

/** Compose a "Label <address>" sender string from a display label. */
export function orgSender(label: string): string {
  return `${label} <${ORG_SENDER_ADDRESS}>`
}

// All automated mail sends under ONE identity. Recipients learn to trust a
// single sender; the subsystem is conveyed by the subject line, and replies are
// routed by Reply-To (see ORG_MAIL_ROUTING) rather than by the display name. Per-
// subsystem display names bought nothing — every one of them sent from the same
// address, which is what mail clients actually thread, filter, and score.
export const ORG_EMAIL_SENDERS = {
  /** The single identity for every automated notification (env-overridable). */
  system: ORG_NOTIFICATION_SENDER,
} as const

/** RFC 2919 List-Id for a module, e.g. "<leave.acoblighting.com>". */
function listId(stream: string): string {
  return `<${stream}.${ORG_PRIMARY_DOMAIN}>`
}

/**
 * Per-module mail routing — mirrored for the edge runtime in
 * supabase/functions/_shared/senders.ts.
 *
 * `replyTo` is the knob that used to be (wrongly) expressed as a sender name.
 * Every address must be a monitored mailbox — a Reply-To nobody opens is worse
 * than none, because senders assume they were heard.
 *
 * `listId` is invisible to readers and exists so recipients can build durable
 * filters (Gmail: `list:leave.acoblighting.com`) without the subject line
 * having to carry a `[Leave]`-style prefix.
 *
 * `Communications` is absent by design: that mail is written by a real person,
 * so it replies to their own department lead, resolved per send.
 */
export const ORG_MAIL_ROUTING: Record<
  Exclude<NotificationModule, "Communications">,
  { replyTo: string; listId: string }
> = {
  Assets: { replyTo: ORG_ICT_EMAIL, listId: listId("assets") },
  "Help Desk": { replyTo: ORG_ICT_EMAIL, listId: listId("helpdesk") },
  Leave: { replyTo: ORG_HR_EMAIL, listId: listId("leave") },
  Onboarding: { replyTo: ORG_HR_EMAIL, listId: listId("onboarding") },
  Meetings: { replyTo: ORG_HR_EMAIL, listId: listId("meetings") },
  Reports: { replyTo: ORG_HR_EMAIL, listId: listId("reports") },
  Attendance: { replyTo: ORG_HR_EMAIL, listId: listId("attendance") },
  Exit: { replyTo: ORG_HR_EMAIL, listId: listId("exit") },
  Birthday: { replyTo: ORG_HR_EMAIL, listId: listId("birthday") },
  Payments: { replyTo: ORG_ACCOUNTS_EMAIL, listId: listId("payments") },
  Payroll: { replyTo: ORG_ACCOUNTS_EMAIL, listId: listId("payroll") },
  Correspondence: { replyTo: ORG_CORPORATE_SERVICES_EMAIL, listId: listId("correspondence") },
  Security: { replyTo: ORG_ICT_EMAIL, listId: listId("security") },
}

/** Dynamic department sender, e.g. "ACOB Finance Department" (label resolved at runtime). */
export function orgDepartmentSender(departmentLabel: string): string {
  return orgSender(`${ORG_CODE} ${departmentLabel} Department`)
}

/** Dynamic department sender without the "Department" suffix, e.g. "ACOB Admin & HR". */
export function orgDepartmentSenderBare(departmentLabel: string): string {
  return orgSender(`${ORG_CODE} ${departmentLabel}`)
}

// ---------------------------------------------------------------------------
// Business hours (used for SLA calculations)
// ---------------------------------------------------------------------------

/** First business hour of the day (24-h, inclusive). Default 09:00. */
export const BUSINESS_HOUR_START = Number(process.env.BUSINESS_HOUR_START ?? 9)

/** Last business hour of the day (24-h, exclusive). Default 18:00. */
export const BUSINESS_HOUR_END = Number(process.env.BUSINESS_HOUR_END ?? 18)

// ---------------------------------------------------------------------------
// Help-desk SLA targets (in business-hours or business-days)
// ---------------------------------------------------------------------------

export interface SlaBudget {
  unit: "business_hours" | "business_days"
  value: number
}

export const HELP_DESK_SLA: Record<"urgent" | "high" | "medium" | "low", SlaBudget> = {
  urgent: {
    unit: "business_hours",
    value: Number(process.env.SLA_URGENT_HOURS ?? 4),
  },
  high: {
    unit: "business_hours",
    value: Number(process.env.SLA_HIGH_HOURS ?? 24),
  },
  medium: {
    unit: "business_days",
    value: Number(process.env.SLA_MEDIUM_DAYS ?? 3),
  },
  low: {
    unit: "business_days",
    value: Number(process.env.SLA_LOW_DAYS ?? 7),
  },
}

// ---------------------------------------------------------------------------
// Attendance and Timeliness policy
// ---------------------------------------------------------------------------

export interface AttendancePolicy {
  startTime: string // e.g. "08:00"
  endTime: string // e.g. "17:00"
  /** End of the arrival grace period. Clock-ins after this are late. e.g. "08:20" */
  lateCutoff: string
  /** Hours charged when one punch is missing, on top of the side that was recorded. */
  incompletePenalty: number // e.g. 1.0 (hours)
  /** Unpaid lunch break deducted from a qualifying day. */
  lunchMinutes: number // e.g. 30
  /** Shortest day, in hours, that earns the lunch break. */
  lunchQualifyingHours: number // e.g. 5
  /** When true, manual alterations and appeal decisions email the employee + Admin & HR lead. */
  emailNotificationsEnabled: boolean
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  startTime: "08:00",
  endTime: "17:00",
  lateCutoff: "08:20",
  incompletePenalty: 1.0,
  lunchMinutes: 30,
  lunchQualifyingHours: 5,
  emailNotificationsEnabled: true,
}
