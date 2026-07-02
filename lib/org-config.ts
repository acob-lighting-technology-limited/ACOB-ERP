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

/** Sender display name + address used for all outbound notification emails */
export const ORG_NOTIFICATION_SENDER =
  process.env.ORG_NOTIFICATION_SENDER ?? `${ORG_CODE} Internal Systems <notifications@${ORG_PRIMARY_DOMAIN}>`

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

export const ORG_EMAIL_SENDERS = {
  /** Generic system notifications / approvals (env-overridable). */
  notification: ORG_NOTIFICATION_SENDER,
  /** Admin & HR department mail — leave, exit notices, HR communications. */
  hr: orgSender(`${ORG_CODE} Admin & HR Department`),
  /** Help desk tickets. */
  helpDesk: orgSender(`${ORG_CODE} Help Desk`),
  /** Correspondence module. */
  correspondence: orgSender(`${ORG_CODE} Correspondence System`),
} as const

/** Dynamic department sender, e.g. "ACOB Admin & HR Department" (label resolved at runtime). */
export function orgDepartmentSender(departmentLabel: string): string {
  return orgSender(`${ORG_CODE} ${departmentLabel} Department`)
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
  startTime: string        // e.g. "08:00"
  endTime: string          // e.g. "17:00"
  lateCutoff: string       // e.g. "08:20"
  incompletePenalty: number // e.g. 1.0 (credits)
  totalCredits: number      // e.g. 10
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  startTime: "08:00",
  endTime: "17:00",
  lateCutoff: "08:20",
  incompletePenalty: 1.0,
  totalCredits: 10,
}
