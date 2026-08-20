import { Users, Package, ClipboardList, FileText, MessageSquare, ScrollText, Briefcase, CreditCard } from "lucide-react"
import { formatName } from "@/lib/utils"
import type { ModuleAction, RecentActivityItem } from "./dashboard-types"

export type AdminDomain = "hr" | "finance" | "assets" | "reports" | "tasks" | "communications"
export const ADMIN_DOMAINS: AdminDomain[] = ["hr", "finance", "assets", "reports", "tasks", "communications"]

export function normalizeAdminDomains(domains: string[] | null | undefined): AdminDomain[] {
  if (!Array.isArray(domains)) return []
  return Array.from(
    new Set(
      domains
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).filter((value): value is AdminDomain => ADMIN_DOMAINS.includes(value as AdminDomain))
}

export function getDomainForAdminPath(path: string): AdminDomain | null {
  if (path.startsWith("/admin/hr")) return "hr"
  if (path.startsWith("/admin/accounts") || path.startsWith("/admin/finance") || path.startsWith("/admin/purchasing"))
    return "finance"
  if (path.startsWith("/admin/assets") || path.startsWith("/admin/inventory")) return "assets"
  if (path.startsWith("/admin/reports") || path.startsWith("/admin/audit-logs")) return "reports"
  if (path.startsWith("/admin/tasks")) return "tasks"
  if (
    path.startsWith("/admin/documentation") ||
    path.startsWith("/admin/feedback") ||
    path.startsWith("/admin/notifications") ||
    path.startsWith("/admin/communications") ||
    path.startsWith("/admin/correspondence") ||
    path.startsWith("/admin/tools") ||
    path.startsWith("/admin/help-desk")
  ) {
    return "communications"
  }
  return null
}

export function normalizeToken(value?: string | null): string {
  if (!value) return ""
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

export function humanizeToken(value?: string | null, fallback = "System"): string {
  if (!value) return fallback
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickObject(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractChangedFields(item: any): string[] {
  const directFields = Array.isArray(item.changed_fields) ? item.changed_fields : []
  const metadataFields = Array.isArray(item?.metadata?.changed_fields) ? item.metadata.changed_fields : []
  const newValues = pickObject(item.new_values || item?.metadata?.new_values)
  const oldValues = pickObject(item.old_values || item?.metadata?.old_values)
  const fromValues = Array.from(new Set([...Object.keys(newValues), ...Object.keys(oldValues)]))

  const ignored = new Set([
    "id",
    "created_at",
    "updated_at",
    "user_id",
    "entity_id",
    "record_id",
    "table_name",
    "action",
    "operation",
  ])

  const merged = [...directFields, ...metadataFields, ...fromValues]
  return Array.from(
    new Set(
      merged
        .map((field: string) => String(field || "").trim())
        .filter((field: string) => field.length > 0 && !ignored.has(field))
    )
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractTargetLabel(item: any): string | null {
  const newValues = pickObject(item.new_values || item?.metadata?.new_values)
  const oldValues = pickObject(item.old_values || item?.metadata?.old_values)

  const fullNameFromNew =
    newValues.first_name && newValues.last_name ? `${newValues.first_name} ${newValues.last_name}` : null
  const fullNameFromOld =
    oldValues.first_name && oldValues.last_name ? `${oldValues.first_name} ${oldValues.last_name}` : null

  if (fullNameFromNew) return fullNameFromNew
  if (fullNameFromOld) return fullNameFromOld

  const candidates = [
    newValues.title,
    newValues.name,
    newValues.project_name,
    newValues.asset_name,
    newValues.ticket_number,
    oldValues.title,
    oldValues.name,
    oldValues.project_name,
    oldValues.asset_name,
    oldValues.ticket_number,
  ]

  const label = candidates.find((value) => typeof value === "string" && value.trim().length > 0)
  if (label) return String(label).trim()

  if (typeof item.entity_id === "string" && item.entity_id.length > 0) {
    return `#${item.entity_id.slice(0, 8)}`
  }

  return null
}

export function actionVerb(value: string): string {
  const token = normalizeToken(value)
  if (["insert", "create", "created", "add", "added"].includes(token)) return "Created"
  if (["delete", "deleted", "remove", "removed"].includes(token)) return "Deleted"
  if (["assign", "assigned", "reassign", "reassigned"].includes(token)) return "Assigned"
  if (["approve", "approved"].includes(token)) return "Approved"
  if (["reject", "rejected"].includes(token)) return "Rejected"
  if (["status_change", "update", "updated", "edit", "edited", "modify", "modified"].includes(token)) return "Updated"
  return humanizeToken(value, "Updated")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRecentActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filteredRawActivity: any[],
  actorMap: Map<string, { first_name?: string; last_name?: string; company_email?: string }>
): RecentActivityItem[] {
  return filteredRawActivity.map((item) => {
    const actor = actorMap.get(item.user_id)
    const actorName =
      actor?.first_name && actor?.last_name
        ? `${formatName(actor.first_name)} ${formatName(actor.last_name)}`
        : actor?.company_email || "System"

    const rawAction = item.action || item.operation || "updated"
    const moduleKey = normalizeToken(item.entity_type || item.table_name || "system")
    const moduleLabel = humanizeToken(item.entity_type || item.table_name, "System")
    const target = extractTargetLabel(item)
    const changedFields = extractChangedFields(item)
      .slice(0, 3)
      .map((field) => humanizeToken(field, field))
    const changedSummary = changedFields.length > 0 ? ` (${changedFields.join(", ")})` : ""

    return {
      id: item.id,
      actorName,
      actionLabel: `${actionVerb(rawAction)} ${moduleLabel}${target ? `: ${target}` : ""}${changedSummary}`,
      moduleLabel,
      moduleKey,
      createdAt: item.created_at,
    }
  })
}

export const primaryModules: ModuleAction[] = [
  {
    title: "HR Administration",
    description: "Manage leave, attendance, and performance",
    href: "/admin/hr",
    icon: Users,
    color: "bg-teal-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Task Management",
    description: "Create and assign tasks to employees",
    href: "/admin/tasks",
    icon: ClipboardList,
    color: "bg-green-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Help Desk",
    description: "Manage support tickets, approvals, and SLA tracking",
    href: "/admin/help-desk",
    icon: ClipboardList,
    color: "bg-emerald-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Correspondence",
    description: "Track incoming/outgoing correspondence and approval workflow",
    href: "/admin/correspondence",
    icon: FileText,
    color: "bg-violet-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Reports",
    description: "Monitor performance, delivery, and operational outputs",
    href: "/admin/reports",
    icon: FileText,
    color: "bg-orange-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Accounts",
    description: "Review accounts modules and payment operations",
    href: "/admin/accounts",
    icon: CreditCard,
    color: "bg-indigo-500",
    roles: ["developer", "super_admin", "admin"],
  },
]

export const secondaryModules: ModuleAction[] = [
  {
    title: "Employee Management",
    description: "View and manage all employees",
    href: "/admin/hr/employees",
    icon: Users,
    color: "bg-blue-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Asset Management",
    description: "Manage asset inventory and assignments",
    href: "/admin/assets",
    icon: Package,
    color: "bg-purple-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Documentation",
    description: "View all employee documentation",
    href: "/admin/documentation",
    icon: FileText,
    color: "bg-orange-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Job Descriptions",
    description: "View employee job descriptions",
    href: "/admin/job-descriptions",
    icon: Briefcase,
    color: "bg-pink-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Feedback Management",
    description: "Review and respond to feedback",
    href: "/admin/feedback",
    icon: MessageSquare,
    color: "bg-cyan-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Audit Logs",
    description: "View system activity logs",
    href: "/admin/audit-logs",
    icon: ScrollText,
    color: "bg-red-500",
    roles: ["developer", "super_admin", "admin"],
  },
  {
    title: "Payments",
    description: "Manage department payments",
    href: "/admin/accounts/payments",
    icon: CreditCard,
    color: "bg-indigo-500",
    roles: ["developer", "super_admin", "admin"],
  },
]
