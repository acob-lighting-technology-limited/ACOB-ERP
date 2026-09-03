/**
 * Render-time safety net for AcoBot answers.
 *
 * The model is told to format pages as markdown links ([Leave](/leave)), but it
 * sometimes slips and emits a bare path (`/leave`), a backticked path (`` `/leave` ``),
 * or just a bold page name (**Leave**). This converts all of those into proper
 * clickable markdown links so navigation always works — without double-wrapping
 * paths that are already linked.
 */

// Ordered longest-first so e.g. /help-desk is handled before any shorter prefix.
const ROUTE_LABELS: Array<[path: string, label: string]> = [
  ["/help-desk", "Help Desk"],
  ["/notifications", "Notifications"],
  ["/correspondence", "Correspondence"],
  ["/documentation", "Documentation"],
  ["/attendance", "Attendance"],
  ["/signature", "Signature"],
  ["/resources", "Resources"],
  ["/payments", "Payments"],
  ["/settings", "Settings"],
  ["/reviews", "Reviews"],
  ["/reports", "Reports"],
  ["/directory", "Directory"],
  ["/profile", "Profile"],
  ["/assets", "Assets"],
  ["/leave", "Leave"],
  ["/tasks", "Tasks"],
  ["/goals", "Goals"],
  ["/fleet", "Resource Booking"],
  ["/admin", "Admin"],
  ["/accounts", "Accounts"],
  ["/dept", "Department console"],
  ["/pms", "PMS"],
  ["/cbt", "CBT"],
  ["/hr", "HR"],
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")
}

export function linkifyRoutes(input: string): string {
  let text = input

  // Pass 1 — bare or backticked paths → links, leaving existing [label](/path) intact.
  for (const [path, label] of ROUTE_LABELS) {
    const esc = escapeRegExp(path)
    // group 1: an existing markdown-link tail "](/path)" — keep untouched.
    // otherwise: a backticked `/path` or a standalone /path (with word boundaries).
    const re = new RegExp(`(\\]\\(${esc}\\))|\`${esc}\`|(?<![\\w/-])${esc}(?![\\w/-])`, "g")
    text = text.replace(re, (match, existingLinkTail) => (existingLinkTail ? match : `[${label}](${path})`))
  }

  // Pass 2 — bold page names (**Leave**) → links, but only if that route isn't
  // already linked somewhere in the answer (avoids duplicate links).
  for (const [path, label] of ROUTE_LABELS) {
    if (text.includes(`](${path})`)) continue
    const re = new RegExp(`\\*\\*${escapeRegExp(label)}\\*\\*`, "g")
    text = text.replace(re, `[${label}](${path})`)
  }

  return text
}
