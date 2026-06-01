import type { TaskStatus } from "@/lib/tasks/constants"
export type { TaskStatus }

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          employee_number: string | null // Unique employee identifier: ACOB/YEAR/NUMBER
          company_email: string
          additional_email: string | null
          first_name: string
          last_name: string
          full_name: string | null // NEW: Computed column
          other_names: string | null
          department: string | null // DEPRECATED: Use department_id
          department_id: string | null // NEW: Foreign key to departments
          designation: string | null
          phone_number: string | null
          additional_phone: string | null
          residential_address: string | null
          current_work_location: string | null
          office_location: string | null
          bank_name: string | null
          bank_account_number: string | null
          bank_account_name: string | null
          date_of_birth: string | null
          birthday: string | null // MM-DD, populated from HR tracker; used for automated birthday emails
          employment_date: string | null
          is_admin: boolean
          role: Database["public"]["Enums"]["user_role"]
          admin_domains: string[] | null
          admin_routes: string[] | null
          is_department_lead: boolean
          lead_departments: string[]
          job_description: string | null
          job_description_updated_at: string | null
          created_at: string
          updated_at: string
          // Employment status fields
          employment_status: Database["public"]["Enums"]["employment_status"]
          status_changed_at: string | null
          status_changed_by: string | null
          separation_date: string | null
          separation_reason: string | null
          // DEPRECATED fields (use assets table instead)
          device_allocated: boolean | null
          device_type: string | null
          device_model: string | null
          devices: string[] | null
        }
        Insert: {
          id: string
          employee_number?: string | null
          company_email: string
          additional_email?: string | null
          first_name: string
          last_name: string
          other_names?: string | null
          department?: string | null
          department_id?: string | null
          designation?: string | null
          phone_number?: string | null
          additional_phone?: string | null
          residential_address?: string | null
          current_work_location?: string | null
          office_location?: string | null
          bank_name?: string | null
          bank_account_number?: string | null
          bank_account_name?: string | null
          date_of_birth?: string | null
          birthday?: string | null
          employment_date?: string | null
          is_admin?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          admin_domains?: string[] | null
          admin_routes?: string[] | null
          is_department_lead?: boolean
          lead_departments?: string[]
          job_description?: string | null
          job_description_updated_at?: string | null
          employment_status?: Database["public"]["Enums"]["employment_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          separation_date?: string | null
          separation_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          employee_number?: string | null
          company_email?: string
          additional_email?: string | null
          first_name?: string
          last_name?: string
          other_names?: string | null
          department?: string | null
          department_id?: string | null
          designation?: string | null
          phone_number?: string | null
          additional_phone?: string | null
          residential_address?: string | null
          current_work_location?: string | null
          office_location?: string | null
          bank_name?: string | null
          bank_account_number?: string | null
          bank_account_name?: string | null
          date_of_birth?: string | null
          birthday?: string | null
          employment_date?: string | null
          is_admin?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          admin_domains?: string[] | null
          admin_routes?: string[] | null
          is_department_lead?: boolean
          lead_departments?: string[]
          job_description?: string | null
          job_description_updated_at?: string | null
          employment_status?: Database["public"]["Enums"]["employment_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          separation_date?: string | null
          separation_reason?: string | null
          updated_at?: string
        }
      }
      department_payments: {
        Row: {
          id: string
          department_id: string
          payment_type: string
          category: string
          title: string
          description: string | null
          amount: number | null
          currency: string
          recurrence_period: string | null
          next_payment_due: string | null
          last_payment_date: string | null
          payment_date: string | null
          status: string
          payment_reference: string | null
          notes: string | null
          created_by: string
          created_at: string
          updated_at: string
          issuer_name: string | null
          issuer_phone_number: string | null
          issuer_address: string | null
          amount_paid: number | null
          // NEW: Starlink consolidation fields
          invoice_number: string | null
          site_id: string | null
          site_name: string | null
          site_state: string | null
          site_serial_number: string | null
        }
        Insert: {
          id?: string
          department_id: string
          payment_type: string
          category: string
          title: string
          description?: string | null
          amount?: number | null
          currency?: string
          recurrence_period?: string | null
          next_payment_due?: string | null
          last_payment_date?: string | null
          payment_date?: string | null
          status?: string
          payment_reference?: string | null
          notes?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
          issuer_name?: string | null
          issuer_phone_number?: string | null
          issuer_address?: string | null
          amount_paid?: number | null
          invoice_number?: string | null
          site_id?: string | null
          site_name?: string | null
          site_state?: string | null
          site_serial_number?: string | null
        }
        Update: {
          department_id?: string
          payment_type?: string
          category?: string
          title?: string
          description?: string | null
          amount?: number | null
          currency?: string
          recurrence_period?: string | null
          next_payment_due?: string | null
          last_payment_date?: string | null
          payment_date?: string | null
          status?: string
          payment_reference?: string | null
          notes?: string | null
          updated_at?: string
          issuer_name?: string | null
          issuer_phone_number?: string | null
          issuer_address?: string | null
          amount_paid?: number | null
          invoice_number?: string | null
          site_id?: string | null
          site_name?: string | null
          site_state?: string | null
          site_serial_number?: string | null
        }
      }
      office_locations: {
        Row: {
          id: string
          name: string
          type: string
          department: string | null
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          site: string | null // NEW: Site location
        }
        Insert: {
          id?: string
          name: string
          type: string
          department?: string | null
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          site?: string | null
        }
        Update: {
          name?: string
          type?: string
          department?: string | null
          description?: string | null
          is_active?: boolean
          updated_at?: string
          site?: string | null
        }
      }
      departments: {
        Row: {
          id: string
          name: string
          description: string | null
          department_code: string | null
          is_executive_dept: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          department_code?: string | null
          is_executive_dept?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          department_code?: string | null
          is_executive_dept?: boolean
          is_active?: boolean
          updated_at?: string
        }
      }
    }
    Enums: {
      user_role: "visitor" | "employee" | "admin" | "super_admin" | "developer"
      employment_status: "active" | "suspended" | "exited" | "on_leave"
    }
  }
}

// Legacy type exports for backward compatibility
export type UserRole = Database["public"]["Enums"]["user_role"]
export type EmploymentStatus = Database["public"]["Enums"]["employment_status"]

export type DeviceStatus = "available" | "assigned" | "maintenance" | "retired"
export type AssetStatus = "available" | "assigned" | "maintenance" | "retired"
export type TaskPriority = "low" | "medium" | "high" | "urgent"
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled"
export type ProjectMemberRole = "member" | "lead" | "manager"
export type ProjectItemStatus = "pending" | "ordered" | "received" | "installed"

// Updated Profile interface with new fields
export interface Profile {
  id: string
  employee_number?: string | null // Unique employee identifier: ACOB/YEAR/NUMBER
  company_email: string
  first_name: string
  last_name: string
  full_name?: string | null // NEW: Computed full name
  other_names?: string
  department?: string // DEPRECATED: Use department_id
  department_id?: string | null // NEW: Foreign key
  designation?: string
  phone_number?: string
  additional_phone?: string
  residential_address?: string
  current_work_location?: string
  office_location?: string
  bank_name?: string
  bank_account_number?: string
  bank_account_name?: string
  date_of_birth?: string
  employment_date?: string
  is_admin: boolean
  role: UserRole
  admin_domains?: string[] | null
  admin_routes?: string[] | null
  is_department_lead: boolean
  lead_departments: string[]
  job_description?: string
  job_description_updated_at?: string
  employment_status: EmploymentStatus
  status_changed_at?: string
  status_changed_by?: string
  separation_date?: string
  separation_reason?: string
  created_at: string
  updated_at: string
}

// Updated DepartmentPayment interface with new fields
export interface DepartmentPayment {
  id: string
  department_id: string
  payment_type: string
  category: string
  title: string
  description?: string
  amount?: number
  currency: string
  recurrence_period?: string
  next_payment_due?: string
  last_payment_date?: string
  payment_date?: string
  status: string
  payment_reference?: string
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
  issuer_name?: string
  issuer_phone_number?: string
  issuer_address?: string
  amount_paid?: number
  // NEW: Starlink consolidation fields
  invoice_number?: string
  site_id?: string
  site_name?: string
  site_state?: string
  site_serial_number?: string
}

// Updated OfficeLocation interface with new field
export interface OfficeLocation {
  id: string
  name: string
  type: string
  department?: string
  description?: string
  is_active: boolean
  created_at: string
  updated_at: string
  site?: string | null // NEW: Site location
}

export interface Department {
  id: string
  name: string
  description?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// Keep existing interfaces for backward compatibility
export interface Device {
  id: string
  device_name: string
  device_type: string
  device_model?: string
  serial_number?: string
  purchase_date?: string
  notes?: string
  status: DeviceStatus
  created_at: string
  updated_at: string
  created_by: string
}

export interface DeviceAssignment {
  id: string
  device_id: string
  assigned_to: string
  assigned_from?: string
  assigned_by: string
  assigned_at: string
  handed_over_at?: string
  assignment_notes?: string
  handover_notes?: string
  is_current: boolean
  created_at: string
}

export interface Asset {
  id: string
  asset_name: string
  asset_type: string
  asset_model?: string
  serial_number?: string
  purchase_date?: string
  purchase_cost?: number
  notes?: string
  status: AssetStatus
  created_at: string
  updated_at: string
  created_by: string
}

export interface AssetAssignment {
  id: string
  asset_id: string
  assigned_to: string
  assigned_from?: string
  assigned_by: string
  assigned_at: string
  handed_over_at?: string
  assignment_notes?: string
  handover_notes?: string
  is_current: boolean
  created_at: string
}

export interface Task {
  id: string
  title: string
  description?: string
  priority: TaskPriority
  status: TaskStatus
  assigned_to: string
  assigned_by: string
  department?: string
  due_date?: string
  started_at?: string
  completed_at?: string
  progress: number
  project_id?: string
  goal_id?: string | null // PMS: optional link to a KPI/goal
  task_start_date?: string
  task_end_date?: string
  created_at: string
  updated_at: string
}

// PMS: KPI approval states
export type KpiApprovalStatus = "pending" | "approved" | "rejected"

export interface Goal {
  id: string
  user_id: string
  review_cycle_id?: string | null
  title: string
  description?: string | null
  target_value?: number | null
  achieved_value?: number | null
  status: string
  priority: string
  due_date?: string | null
  // PMS: approval workflow
  approval_status: KpiApprovalStatus
  approved_by?: string | null
  approved_at?: string | null
  created_at: string
  updated_at: string
}

export interface ReviewCycle {
  id: string
  name: string
  start_date: string
  end_date: string
  review_type: string // annual, quarterly, monthly
  status: string // draft, active, completed
  created_at: string
  updated_at: string
}

// PMS: behavioural competency breakdown stored as JSON
export interface BehaviourCompetencies {
  collaboration?: number // 0-100
  accountability?: number
  communication?: number
  teamwork?: number
  loyalty?: number
  professional_conduct?: number
}

export interface PerformanceReview {
  id: string
  user_id: string
  review_cycle_id: string
  reviewer_id: string
  review_date: string
  overall_rating?: number | null // legacy 1-5 stars (kept for backward compat)
  status: string // draft, in_progress, completed, approved
  self_review_completed: boolean
  manager_review_completed: boolean
  employee_comments?: string | null
  manager_comments?: string | null
  goals_achieved: number
  goals_total: number
  strengths?: string | null
  areas_for_improvement?: string | null
  // PMS 4-component scoring
  kpi_score?: number | null // 0-100, weight 70%
  cbt_score?: number | null // 0-100, weight 10%
  attendance_score?: number | null // 0-100, weight 10%
  behaviour_score?: number | null // 0-100, weight 10%
  final_score?: number | null // auto-computed weighted total
  behaviour_competencies?: BehaviourCompetencies | null
  created_at: string
  updated_at: string
}

export interface TaskUpdate {
  id: string
  task_id: string
  user_id: string
  update_type: "comment" | "status_change" | "progress_update"
  content?: string
  old_value?: string
  new_value?: string
  created_at: string
}

export interface UserDocumentation {
  id: string
  user_id: string
  title: string
  content: string
  category?: string
  tags?: string[]
  is_draft: boolean
  sharepoint_folder_path?: string | null
  sharepoint_text_file_path?: string | null
  sharepoint_attachments?: {
    id: string
    name: string
    file_path: string
    mime_type?: string | null
    size?: number | null
    uploaded_at: string
  }[]
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  user_id: string
  action: string
  entity_type: string
  entity_id?: string
  old_values?: Json
  new_values?: Json
  ip_address?: string
  user_agent?: string
  created_at: string
}

export interface Project {
  id: string
  project_name: string
  location: string
  deployment_start_date: string
  deployment_end_date: string
  capacity_w?: number
  technology_type?: string
  project_manager_id?: string
  description?: string
  status: ProjectStatus
  created_by: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: ProjectMemberRole
  assigned_by: string
  assigned_at: string
  removed_at?: string
  is_active: boolean
  created_at: string
}

export interface ProjectItem {
  id: string
  project_id: string
  item_name: string
  description?: string
  quantity: number
  unit?: string
  status: ProjectItemStatus
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProjectUpdate {
  id: string
  project_id: string
  user_id: string
  update_type: "comment" | "status_change" | "milestone" | "member_added" | "member_removed"
  content?: string
  old_value?: string
  new_value?: string
  created_at: string
}
