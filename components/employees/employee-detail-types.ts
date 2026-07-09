export interface UserProfile {
  id: string
  first_name: string
  last_name: string
  other_names: string | null
  company_email: string
  personal_email?: string | null
  department: string
  designation: string | null
  role: string
  phone_number: string | null
  additional_phone: string | null
  residential_address: string | null
  office_location: string | null
  is_admin: boolean
  is_department_lead: boolean
  lead_departments: string[]
  created_at: string
  updated_at: string
}

export interface EmployeeTask {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  department: string | null
  due_date: string | null
  created_at: string
}

export interface EmployeeDevice {
  id: string
  device_name: string
  device_type: string
  device_model: string | null
  serial_number: string | null
  status: string
  assigned_at: string
}

export interface EmployeeAsset {
  id: string
  asset_name: string
  asset_type: string
  asset_model: string | null
  serial_number: string | null
  status: string
  assigned_at: string
}

export interface EmployeeDocumentation {
  id: string
  title: string
  category: string | null
  created_at: string
}

export interface EmployeeAuditLog {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  old_values: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new_values: any
  created_at: string
}

export interface EmployeeFeedback {
  id: string
  feedback_type: string
  title: string
  description: string | null
  status: string
  created_at: string
}

export interface EmployeeDetailData {
  profile: UserProfile
  tasks: EmployeeTask[]
  devices: EmployeeDevice[]
  assets: EmployeeAsset[]
  documentation: EmployeeDocumentation[]
  auditLogs: EmployeeAuditLog[]
  feedback: EmployeeFeedback[]
}
