/**
 * Shared type definitions for the audit logs feature.
 * Imported by the server page, client component, and all sub-components.
 */

export interface AuditLog {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  created_at: string
  department?: string | null
  site_id?: string | null
  ip_address?: string | null
  user_agent?: string | null
  changed_fields?: string[]
  metadata?: Record<string, unknown>
  user?: {
    first_name: string
    last_name: string
    company_email: string
    employee_number?: string
    department?: string | null
  } | null
  target_user?: {
    first_name: string
    last_name: string
    company_email: string
    employee_number?: string
    department?: string | null
  } | null
  task_info?: {
    title: string
    assigned_to?: string
    assigned_to_user?: { first_name: string; last_name: string }
  } | null
  device_info?: {
    device_name: string
    assigned_to?: string
    assigned_to_user?: { first_name: string; last_name: string }
  } | null
  asset_info?: {
    asset_name: string
    unique_code?: string
    serial_number?: string
    assignment_type?: string
    assigned_to?: string
    assigned_to_user?: { first_name: string; last_name: string }
  } | null
  payment_info?: {
    title: string
    amount: number
    currency: string
    department_name?: string
  } | null
  document_info?: {
    file_name: string
    document_type: string
    department_name?: string
  } | null
  department_info?: { name: string } | null
  category_info?: { name: string } | null
  leave_request_info?: {
    user_id: string
    leave_type_name: string
    requester_user?: { first_name: string; last_name: string }
  } | null
}

export interface EmployeeMember {
  id: string
  first_name: string
  last_name: string
  department: string
}

export interface UserProfile {
  role: string
  is_department_lead?: boolean
  lead_departments?: string[]
  managed_departments?: string[]
}

export interface AuditLogFiltersState {
  searchQuery: string
  actionFilter: string
  entityFilter: string
  dateFilter: string
  departmentFilter: string
  employeeFilter: string
  customStartDate: string
  customEndDate: string
}

export interface EnrichedAuditLogRow {
  id: string
  user_id: string | null
  action: string | null
  entity_type: string | null
  entity_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  department: string | null
  site_id?: string | null
  ip_address?: string | null
  user_agent?: string | null
  changed_fields: string[] | null
  total_count?: number | null

  // User details
  user_data?: {
    first_name: string
    last_name: string
    company_email: string
    employee_number?: string
    department?: string | null
  } | null
  actor_first_name?: string | null
  actor_last_name?: string | null
  actor_email?: string | null
  actor_employee_no?: string | null

  // Target user details
  target_user_data?: {
    first_name: string
    last_name: string
    company_email: string
    employee_number?: string
    department?: string | null
  } | null
  target_first_name?: string | null
  target_last_name?: string | null
  target_email?: string | null
  target_employee_no?: string | null

  // Task details
  task_info?: { title: string } | null
  task_title?: string | null

  // Asset details
  asset_info?: {
    asset_name: string
    unique_code?: string
    serial_number?: string
    assignment_type?: string
    assigned_to?: string
    assigned_to_user?: {
      first_name: string
      last_name: string
    }
  } | null
  asset_name?: string | null
  asset_unique_code?: string | null
  asset_serial?: string | null
  asset_assigned_to?: string | null
  asset_assignee_first_name?: string | null
  asset_assignee_last_name?: string | null

  // Payment details
  payment_info?: {
    title: string
    amount: number
    currency: string
    department_name?: string
  } | null
  payment_title?: string | null
  payment_dept_name?: string | null

  // Document details
  document_info?: {
    file_name: string
    document_type: string
    department_name?: string
  } | null
  doc_file_name?: string | null
  doc_dept_name?: string | null

  // Department details
  department_info?: { name: string } | null
  dept_name?: string | null

  // Category details
  category_info?: { name: string } | null
  category_name?: string | null

  // Leave request details
  leave_request_info?: {
    user_id: string
    leave_type_name: string
    requester_user?: {
      first_name: string
      last_name: string
    }
  } | null
  leave_type_name?: string | null
  leave_requester_first_name?: string | null
  leave_requester_last_name?: string | null

  // Device details
  device_info?: { device_name: string } | null
  device_name?: string | null
}
