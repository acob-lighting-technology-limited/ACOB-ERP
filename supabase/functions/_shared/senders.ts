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

// All automated mail sends under ONE identity — mirrors ORG_EMAIL_SENDERS in
// lib/org-config.ts. Per-subsystem display names bought nothing: every one of
// them sent from the same address, which is what mail clients actually thread,
// filter, and score. The subsystem belongs in the subject; where a reply goes
// belongs in Reply-To (see EDGE_REPLY_TO).
export const EDGE_SENDERS = {
  /** The single identity for every automated notification. */
  system: edgeSender(`${ORG_CODE} Lighting Technology Limited`),
} as const

/** Monitored mailboxes replies are routed to, per module. */
const ICT_MAILBOX = Deno.env.get("ORG_ICT_EMAIL") || "ict@acoblighting.com"
const HR_MAILBOX = Deno.env.get("ORG_HR_EMAIL") || "hradmin@acoblighting.com"
const ACCOUNTS_MAILBOX = Deno.env.get("ORG_ACCOUNTS_EMAIL") || "accounts@acoblighting.com"

const LIST_DOMAIN = Deno.env.get("ORG_PRIMARY_DOMAIN") || "acoblighting.com"

/**
 * Per-module mail routing — mirrors ORG_MAIL_ROUTING in lib/org-config.ts.
 *
 * `replyTo` must be a monitored mailbox; a Reply-To nobody opens is worse than
 * none, because senders assume they were heard.
 *
 * `listId` is the RFC 2919 List-Id header. It is invisible to readers and
 * exists so recipients can build durable filters (Gmail: `list:assets.…`)
 * without the subject line having to carry a `[Assets]`-style prefix.
 *
 * Communications is absent by design: that mail is written by a real person,
 * so it replies to their own department lead, resolved per send.
 */
export const EDGE_MAIL_ROUTING = {
  assets: { replyTo: ICT_MAILBOX, listId: `<assets.${LIST_DOMAIN}>` },
  helpDesk: { replyTo: ICT_MAILBOX, listId: `<helpdesk.${LIST_DOMAIN}>` },
  attendance: { replyTo: HR_MAILBOX, listId: `<attendance.${LIST_DOMAIN}>` },
  birthday: { replyTo: HR_MAILBOX, listId: `<birthday.${LIST_DOMAIN}>` },
  meetings: { replyTo: HR_MAILBOX, listId: `<meetings.${LIST_DOMAIN}>` },
  reports: { replyTo: HR_MAILBOX, listId: `<reports.${LIST_DOMAIN}>` },
  payments: { replyTo: ACCOUNTS_MAILBOX, listId: `<payments.${LIST_DOMAIN}>` },
} as const

/** List-Id for correspondence, whose Reply-To is resolved per send. */
export const COMMUNICATIONS_LIST_ID = `<communications.${LIST_DOMAIN}>`

/** Dynamic department sender, e.g. "ACOB Finance Department". */
export function edgeDepartmentSender(departmentLabel: string): string {
  return edgeSender(`${ORG_CODE} ${departmentLabel} Department`)
}

/** Dynamic department sender without the "Department" suffix, e.g. "ACOB Admin & HR". */
export function edgeDepartmentSenderBare(departmentLabel: string): string {
  return edgeSender(`${ORG_CODE} ${departmentLabel}`)
}
