/**
 * Canonical Tailwind class strings for each audit action.
 * Used in the audit-log table, Excel export, PDF export, and Word export.
 * Single source of truth — update here, not in the consumer files.
 */
export const AUDIT_ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-500 border-emerald-200",
  update: "bg-blue-500/10 text-blue-500 border-blue-200",
  delete: "bg-red-500/10 text-red-500 border-red-200",
  assign: "bg-purple-500/10 text-purple-500 border-purple-200",
  unassign: "bg-orange-500/10 text-orange-500 border-orange-200",
  approve: "bg-purple-500/10 text-purple-500 border-purple-200",
  reject: "bg-amber-500/10 text-amber-500 border-amber-200",
  dispatch: "bg-cyan-500/10 text-cyan-500 border-cyan-200",
  send: "bg-indigo-500/10 text-indigo-500 border-indigo-200",
  status_change: "bg-amber-500/10 text-amber-500 border-amber-200",
  default: "bg-muted text-muted-foreground",
}

/**
 * Returns the Tailwind color classes for a given audit action string.
 * Falls back to the `default` entry for unknown actions.
 */
export function getAuditActionColor(action: string): string {
  return AUDIT_ACTION_COLORS[action] ?? AUDIT_ACTION_COLORS.default
}
