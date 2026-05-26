/**
 * Display helper functions for audit log rows.
 *
 * Extracted from admin-audit-logs-content.tsx so that table, card, detail
 * panel, and export functions all share one implementation.
 */

import { formatName } from "@/lib/utils"
import type { AuditLog } from "@/app/admin/audit-logs/types"

export const HIDDEN_ACTIONS = ["sync", "migrate", "update_schema", "migration"] as const

export const VISIBLE_AUDIT_ACTIONS = [
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "approve", label: "Approve" },
  { value: "reject", label: "Reject" },
] as const

export function getAuditLogSummary(log: AuditLog): string {
  if (log.metadata?.event) return String(log.metadata.event)
  if (log.task_info?.title) return `Task: ${log.task_info.title}`
  if (log.asset_info?.unique_code) return `Asset: ${log.asset_info.unique_code}`
  if (log.leave_request_info?.leave_type_name) return log.leave_request_info.leave_type_name
  return `Modified ${log.entity_type}`
}

/** Safely read a string field from new_values / old_values (which are Record<string, unknown>) */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
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
  return "N/A"
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
    return "-"
  }

  if (["profile", "profiles", "user", "pending_user", "admin_action"].includes(entityType)) {
    const employeeNumber =
      str(log.new_values?.employee_number) || str(log.old_values?.employee_number) || log.target_user?.employee_number
    if (employeeNumber) return employeeNumber
    const companyEmail =
      str(log.new_values?.company_email) || str(log.old_values?.company_email) || log.target_user?.company_email
    if (companyEmail) return companyEmail.split("@")[0]
    if (log.target_user) return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    return "-"
  }

  if (["task", "tasks"].includes(entityType)) {
    const title = str(log.new_values?.title) || str(log.old_values?.title) || log.task_info?.title
    if (title) return title.length > 30 ? title.substring(0, 30) + "..." : title
    return "-"
  }

  if (entityType === "department_payments") {
    const title =
      str(log.new_values?.title) ||
      str(log.old_values?.title) ||
      log.payment_info?.title ||
      str(log.new_values?.payment_reference)
    if (title) return title.length > 50 ? title.substring(0, 50) + "..." : title
    return "-"
  }

  if (entityType === "payment_documents") {
    const fileName = str(log.new_values?.file_name) || str(log.old_values?.file_name) || log.document_info?.file_name
    if (fileName) return fileName.length > 50 ? fileName.substring(0, 50) + "..." : fileName
    return "-"
  }

  if (["device", "devices", "device_assignment", "device_assignments"].includes(entityType)) {
    const deviceName =
      str(log.new_values?.device_name) || str(log.old_values?.device_name) || log.device_info?.device_name
    if (deviceName) return deviceName
    return "-"
  }

  if (["leave_requests", "leave_approvals"].includes(entityType)) {
    if (log.leave_request_info?.leave_type_name) return log.leave_request_info.leave_type_name
    return "-"
  }

  if (entityType === "departments") {
    const name = str(log.new_values?.name) || str(log.old_values?.name) || log.department_info?.name
    if (name) return name
    return "-"
  }

  if (entityType === "feedback") {
    const feedbackType = str(log.new_values?.feedback_type) || str(log.old_values?.feedback_type)
    if (feedbackType) return feedbackType.charAt(0).toUpperCase() + feedbackType.slice(1)
    return "-"
  }

  return "-"
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
    if (assignmentType === "individual") return "-"
    const dept = str(log.new_values?.department) || str(log.old_values?.department)
    if (dept) return `${dept} (Dept)`
    const location = str(log.new_values?.office_location) || str(log.old_values?.office_location)
    if (location) return `${location} (Location)`
    return "-"
  }

  if (["task", "tasks"].includes(entityType)) {
    if (log.task_info?.assigned_to_user) {
      return `${formatName(log.task_info.assigned_to_user.first_name)} ${formatName(log.task_info.assigned_to_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "-"
  }

  if (["device", "devices", "device_assignment", "device_assignments"].includes(entityType)) {
    if (log.device_info?.assigned_to_user) {
      return `${formatName(log.device_info.assigned_to_user.first_name)} ${formatName(log.device_info.assigned_to_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "-"
  }

  if (["profile", "profiles", "user", "pending_user", "admin_action"].includes(entityType)) {
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    const firstName = str(log.new_values?.first_name)
    const lastName = str(log.new_values?.last_name)
    if (firstName && lastName) return `${formatName(firstName)} ${formatName(lastName)}`
    return "-"
  }

  if (entityType === "leave_requests") {
    if (log.leave_request_info?.requester_user) {
      return `${formatName(log.leave_request_info.requester_user.first_name)} ${formatName(log.leave_request_info.requester_user.last_name)}`
    }
    if (log.target_user) {
      return `${formatName(log.target_user.first_name)} ${formatName(log.target_user.last_name)}`
    }
    return "-"
  }

  if (entityType === "leave_approvals") {
    if (log.leave_request_info?.requester_user) {
      return `${formatName(log.leave_request_info.requester_user.first_name)} ${formatName(log.leave_request_info.requester_user.last_name)}`
    }
    return "-"
  }

  if (["department_payments", "payment_documents"].includes(entityType)) {
    const deptName =
      log.department_info?.name ||
      log.payment_info?.department_name ||
      str(log.new_values?.department_name) ||
      str(log.new_values?.department) ||
      str(log.old_values?.department)
    if (deptName) return deptName
    return "-"
  }

  if (entityType === "departments") {
    if (log.department_info) return log.department_info.name
    const name = str(log.new_values?.name) || str(log.old_values?.name)
    if (name) return name
    return "-"
  }

  if (entityType === "payment_categories") return "-"

  if (entityType === "feedback") {
    if (log.user && !log.new_values?.is_anonymous) {
      return `${formatName(log.user.first_name)} ${formatName(log.user.last_name)}`
    }
    return log.new_values?.is_anonymous ? "Anonymous" : "-"
  }

  if (["user_documentation", "documentation"].includes(entityType)) {
    if (log.user) return `${formatName(log.user.first_name)} ${formatName(log.user.last_name)}`
    return "-"
  }

  if (entityType === "management") return "-"

  return "-"
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
  const officeLocation = str(log.new_values?.office_location) || str(log.old_values?.office_location)
  if (officeLocation) return officeLocation
  return "-"
}
