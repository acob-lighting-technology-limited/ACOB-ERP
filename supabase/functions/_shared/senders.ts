// SINGLE SOURCE OF TRUTH for edge-function email sender identities ("From"
// display names). Edge functions run in Deno and cannot import the Next app's
// lib/org-config.ts, so this module mirrors ORG_EMAIL_SENDERS for the edge
// runtime. Never hardcode a sender string in an edge function — pick it here.

const ORG_CODE = "ACOB"

/** Shared notifications mailbox all subsystem senders send from. */
export const SENDER_ADDRESS = Deno.env.get("NOTIFICATION_SENDER_EMAIL") || "notifications@acoblighting.com"

/** Compose a "Label <address>" sender string. */
export function edgeSender(label: string): string {
  return `${label} <${SENDER_ADDRESS}>`
}

export const EDGE_SENDERS = {
  /** Generic system notifications (shared default). */
  notification: edgeSender(`${ORG_CODE} Notification System`),
  /** Payment status alerts. */
  payments: edgeSender(`${ORG_CODE} Payments System`),
  /** Weekly reports. */
  reporting: edgeSender(`${ORG_CODE} Reporting System`),
  /** Meeting reminders. */
  meeting: edgeSender(`${ORG_CODE} Meeting System`),
  /** Birthday greetings (company identity). */
  birthday: edgeSender(`${ORG_CODE} Lighting Technology Limited`),
  /** Admin & HR department mail. */
  hr: edgeSender(`${ORG_CODE} Admin & HR Department`),
} as const

/** Dynamic department sender, e.g. "ACOB Admin & HR Department". */
export function edgeDepartmentSender(departmentLabel: string): string {
  return edgeSender(`${ORG_CODE} ${departmentLabel} Department`)
}

/** Dynamic department sender without the "Department" suffix, e.g. "ACOB Admin & HR". */
export function edgeDepartmentSenderBare(departmentLabel: string): string {
  return edgeSender(`${ORG_CODE} ${departmentLabel}`)
}
