/**
 * Display helper functions for audit log rows.
 *
 * Extracted from admin-audit-logs-content.tsx so that table, card, detail
 * panel, and export functions all share one implementation.
 */

import { formatName } from "@/lib/utils"
import { ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import type { AuditLog } from "@/app/admin/audit-logs/types"

export const HIDDEN_ACTIONS = ["sync", "migrate", "update_schema", "migration"] as const

export const VISIBLE_AUDIT_ACTIONS = [
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "assign", label: "Assign" },
  { value: "unassign", label: "Unassign" },
  { value: "approve", label: "Approve" },
  { value: "reject", label: "Reject" },
  { value: "dispatch", label: "Dispatch" },
  { value: "send", label: "Send" },
  { value: "status_change", label: "Status Change" },
] as const

/** Safely read a string field from new_values / old_values (which are Record<string, unknown>) */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function statusLabel(v: unknown): string {
  const s = str(v)
  if (!s) return ""
  return (ATTENDANCE_STATUS_LABELS as Record<string, string>)[s] ?? formatName(s)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function metadataString(log: AuditLog, key: string): string | undefined {
  const value = log.metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

export function formatAuditFieldLabel(field: string): string {
  return field
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Empty"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    if (value.length === 0) return "Empty list"
    return value.map((item) => formatAuditValue(item)).join(", ")
  }
  if (isRecord(value)) return JSON.stringify(value)
  return String(value)
}

export interface AuditFieldDiff {
  field: string
  label: string
  before: string
  after: string
}

export function getAuditChangedFields(log: AuditLog): string[] {
  const configured = (log.changed_fields || []).filter(Boolean)
  if (configured.length > 0) return Array.from(new Set(configured))

  const fields = new Set<string>()
  for (const key of Object.keys(log.old_values || {})) fields.add(key)
  for (const key of Object.keys(log.new_values || {})) fields.add(key)
  return Array.from(fields)
}

export function getAuditChangedFieldsDisplay(log: AuditLog, maxFields = 3): string {
  const fields = getAuditChangedFields(log)
  if (fields.length === 0) return "No field diff captured"
  const shown = fields.slice(0, maxFields).map(formatAuditFieldLabel)
  const remaining = fields.length - shown.length
  return remaining > 0 ? `${shown.join(", ")} +${remaining}` : shown.join(", ")
}

export function getAuditFieldDiffs(log: AuditLog): AuditFieldDiff[] {
  return getAuditChangedFields(log).map((field) => ({
    field,
    label: formatAuditFieldLabel(field),
    before: formatAuditValue(log.old_values?.[field]),
    after: formatAuditValue(log.new_values?.[field]),
  }))
}

export function getAuditSource(log: AuditLog): string {
  const source = metadataString(log, "source")
  return source ? formatName(source) : "Not captured"
}

export function getAuditRoute(log: AuditLog): string {
  return metadataString(log, "route") || "Not captured"
}

export function getAuditRequestId(log: AuditLog): string {
  return metadataString(log, "request_id") || "Not captured"
}

export function getAuditIpAddress(log: AuditLog): string {
  return log.ip_address || metadataString(log, "ip_address") || "Not captured"
}

export function getAuditUserAgent(log: AuditLog): string {
  return log.user_agent || metadataString(log, "user_agent") || "Not captured"
}

export function getAuditSiteId(log: AuditLog): string {
  return log.site_id || metadataString(log, "site_id") || "Not captured"
}

export function getAuditLogSummary(log: AuditLog): string {
  if (log.metadata?.event) return String(log.metadata.event)
  if (log.task_info?.title) return `Task: ${log.task_info.title}`
  if (log.asset_info?.unique_code) return `Asset: ${log.asset_info.unique_code}`

  const entityType = (log.entity_type || "").toLowerCase()
  const nv = (log.new_values || {}) as Record<string, unknown>
  const ov = (log.old_values || {}) as Record<string, unknown>

  // ── Attendance / leave entities: build a readable summary from the captured values ──
  if (entityType === "attendance_record") {
    const date = str(nv.date) || str(ov.date)
    const parts: string[] = []
    const status = statusLabel(nv.status)
    if (status) parts.push(status)
    const ci = str(nv.clock_in)
    const co = str(nv.clock_out)
    if (ci) parts.push(`in ${ci.slice(0, 5)}`)
    if (co) parts.push(`out ${co.slice(0, 5)}`)
    const head = parts.length ? parts.join(" · ") : formatName(log.action || "update")
    const comment = str(nv.manual_comment)
    return `Attendance${date ? ` (${date})` : ""} — ${head}${comment ? ` · ${comment}` : ""}`
  }

  if (entityType === "attendance_record_bulk") {
    const status = statusLabel(nv.status)
    const s = str(nv.start_date)
    const e = str(nv.end_date)
    return `Bulk ${status || "grant"}${s && e ? ` ${s} → ${e}` : ""}`
  }

  if (entityType === "attendance_appeal") {
    const action = (log.action || "").toLowerCase()
    const requested = statusLabel(nv.requested_status)
    const note = str(nv.resolution_note)
    const verb = action === "approve" ? "Appeal approved" : action === "reject" ? "Appeal rejected" : "Appeal updated"
    return `${verb}${requested ? ` → ${requested}` : ""}${note ? ` · ${note}` : ""}`
  }

  if (entityType === "attendance_exemption") {
    const s = str(nv.start_date)
    const e = str(nv.end_date)
    const reason = str(nv.reason)
    return `Exemption ${formatName(log.action || "update")}${s && e ? ` ${s} → ${e}` : ""}${reason ? ` · ${reason}` : ""}`
  }

  if (["leave_request", "leave_request_manual", "leave_requests"].includes(entityType)) {
    const s = str(nv.start_date)
    const e = str(nv.end_date)
    const range = s && e ? ` ${s} → ${e}` : ""
    if (log.leave_request_info?.leave_type_name) return `${log.leave_request_info.leave_type_name}${range}`
    return `Leave${range || ` ${formatName(log.action || "update")}`}`
  }

  if (log.leave_request_info?.leave_type_name) return log.leave_request_info.leave_type_name
  return `Modified ${log.entity_type}`
}

export function getActionDisplay(log: AuditLog): string {
  const eventLabel =
    typeof log.metadata?.event === "string" && log.metadata.event.trim().length > 0
      ? log.metadata.event
      : log.action || "unknown"
  return eventLabel.toUpperCase()
}

export function formatAuditDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  })
}

export function getPerformedBy(log: AuditLog): string {
  if (log.entity_type === "feedback" && log.new_values?.is_anonymous) return "Anonymous"
  if (log.user) return `${formatName(log.user.first_name)} ${formatName(log.user.last_name)}`
  if ((metadataString(log, "source") || "").toLowerCase() === "system") return "System"
  return "Unknown actor"
}

export function getObjectIdentifier(log: AuditLog): string {
  const entityType = (log.entity_type || "unknown").toLowerCase()

  if (["asset", "assets", "asset_assignment", "asset_assignments"].includes(entityType)) {
    const uniqueCode =
      log.asset_info?.unique_code ||
      str(log.new_values?.unique_code) ||
      str(log.old_values?.unique_code) ||
      str(log.new_values?.asset_code) ||
      str(log.old_values?.asset_code)
    if (uniqueCode && uniqueCode !== "-" && uniqueCode !== "null" && uniqueCode !== "") return uniqueCode
    const assetName = log.asset_info?.asset_name || str(log.new_values?.asset_name) || str(log.old_values?.asset_name)
    if (assetName) return assetName
    return "No object captured"
  }

  if (["profile", "profiles", "user", "pending_user", "admin_action"].includes(entityType)) {
    const employeeNumber =
      str(log.new_values?.employee_number) || str(log.old_values?.employee_number) || log.target_user?.employee_number
    if (employeeNumber) return employeeNumber
    const companyEmail =
      str(log.new_values?.company_email) || str(log.old_values?.company_email) || log.target_user?.company_email
    if (companyEmail) return companyEmail.split("@")[0]
    if (log.target_user) return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    return "No object captured"
  }

  if (["task", "tasks"].includes(entityType)) {
    const title = str(log.new_values?.title) || str(log.old_values?.title) || log.task_info?.title
    if (title) return title.length > 30 ? title.substring(0, 30) + "..." : title
    return "No object captured"
  }

  if (entityType === "department_payments") {
    const title =
      str(log.new_values?.title) ||
      str(log.old_values?.title) ||
      log.payment_info?.title ||
      str(log.new_values?.payment_reference)
    if (title) return title.length > 50 ? title.substring(0, 50) + "..." : title
    return "No object captured"
  }

  if (entityType === "payment_documents") {
    const fileName = str(log.new_values?.file_name) || str(log.old_values?.file_name) || log.document_info?.file_name
    if (fileName) return fileName.length > 50 ? fileName.substring(0, 50) + "..." : fileName
    return "No object captured"
  }

  if (["device", "devices", "device_assignment", "device_assignments"].includes(entityType)) {
    const deviceName =
      str(log.new_values?.device_name) || str(log.old_values?.device_name) || log.device_info?.device_name
    if (deviceName) return deviceName
    return "No object captured"
  }

  if (["leave_requests", "leave_approvals"].includes(entityType)) {
    if (log.leave_request_info?.leave_type_name) return log.leave_request_info.leave_type_name
    return "No object captured"
  }

  if (entityType === "departments") {
    const name = str(log.new_values?.name) || str(log.old_values?.name) || log.department_info?.name
    if (name) return name
    return "No object captured"
  }

  if (entityType === "feedback") {
    const feedbackType = str(log.new_values?.feedback_type) || str(log.old_values?.feedback_type)
    if (feedbackType) return feedbackType.charAt(0).toUpperCase() + feedbackType.slice(1)
    return "No object captured"
  }

  return "No object captured"
}

export function getTargetDescription(log: AuditLog): string {
  const entityType = (log.entity_type || "unknown").toLowerCase()

  if (["asset", "assets", "asset_assignment", "asset_assignments"].includes(entityType)) {
    if (log.target_user?.first_name) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    const assignedToName = str(log.new_values?.assigned_to_name)
    if (assignedToName) return assignedToName
    const assignmentType =
      str(log.new_values?.assignment_type) ||
      str(log.old_values?.assignment_type) ||
      log.asset_info?.assignment_type ||
      (log.new_values?.assigned_to || log.old_values?.assigned_to ? "individual" : null)
    if (assignmentType === "individual") return "No target captured"
    const dept = str(log.new_values?.department) || str(log.old_values?.department)
    if (dept) return `${dept} (Dept)`
    const location = str(log.new_values?.office_location) || str(log.old_values?.office_location)
    if (location) return `${location} (Location)`
    return "No target captured"
  }

  if (["task", "tasks"].includes(entityType)) {
    if (log.task_info?.assigned_to_user) {
      return `${formatName(log.task_info.assigned_to_user.first_name)} ${formatName(log.task_info.assigned_to_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "No target captured"
  }

  if (["device", "devices", "device_assignment", "device_assignments"].includes(entityType)) {
    if (log.device_info?.assigned_to_user) {
      return `${formatName(log.device_info.assigned_to_user.first_name)} ${formatName(log.device_info.assigned_to_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "No target captured"
  }

  if (["profile", "profiles", "user", "pending_user", "admin_action"].includes(entityType)) {
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    const firstName = str(log.new_values?.first_name)
    const lastName = str(log.new_values?.last_name)
    if (firstName && lastName) return `${formatName(firstName)} ${formatName(lastName)}`
    return "No target captured"
  }

  if (entityType === "leave_requests") {
    if (log.leave_request_info?.requester_user) {
      return `${formatName(log.leave_request_info.requester_user.first_name)} ${formatName(log.leave_request_info.requester_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "No target captured"
  }

  if (entityType === "leave_approvals" || entityType === "leave_request" || entityType === "leave_request_manual") {
    if (log.leave_request_info?.requester_user) {
      return `${formatName(log.leave_request_info.requester_user.first_name)} ${formatName(log.leave_request_info.requester_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "No target captured"
  }

  if (
    ["attendance_record", "attendance_record_bulk", "attendance_appeal", "attendance_exemption"].includes(entityType)
  ) {
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "No target captured"
  }

  if (["department_payments", "payment_documents"].includes(entityType)) {
    const deptName =
      log.department_info?.name ||
      log.payment_info?.department_name ||
      str(log.new_values?.department_name) ||
      str(log.new_values?.department) ||
      str(log.old_values?.department)
    if (deptName) return deptName
    return "No target captured"
  }

  if (entityType === "departments") {
    if (log.department_info) return log.department_info.name
    const name = str(log.new_values?.name) || str(log.old_values?.name)
    if (name) return name
    return "No target captured"
  }

  if (entityType === "payment_categories") return "No target captured"

  if (entityType === "feedback") {
    if (log.user && !log.new_values?.is_anonymous) {
      return `${formatName(log.user.first_name)} ${formatName(log.user.last_name)}`
    }
    return log.new_values?.is_anonymous ? "Anonymous" : "No target captured"
  }

  if (["user_documentation", "documentation"].includes(entityType)) {
    if (log.user) return `${formatName(log.user.first_name)} ${formatName(log.user.last_name)}`
    return "No target captured"
  }

  if (entityType === "management") return "No target captured"

  return "No target captured"
}

export function getDepartmentLocation(log: AuditLog): string {
  if (log.department) return log.department
  if (log.department_info?.name) return log.department_info.name
  if (log.payment_info?.department_name) return log.payment_info.department_name
  if (log.document_info?.department_name) return log.document_info.department_name
  const newDept = str(log.new_values?.department)
  if (newDept && newDept.length < 50) return newDept
  const oldDept = str(log.old_values?.department)
  if (oldDept && oldDept.length < 50) return oldDept
  if (log.target_user?.department) return log.target_user.department
  if (log.user?.department) return log.user.department
  const officeLocation = str(log.new_values?.office_location) || str(log.old_values?.office_location)
  if (officeLocation) return officeLocation
  return "No department captured"
}
