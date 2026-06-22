/**
 * HR Module Types
 * Types specific to Human Resources functionality
 */

import type { UserRole, EmploymentStatus } from "./database"

// ============================================
// Employee Types
// ============================================

export interface Employee {
  id: string
  company_email: string
  first_name: string
  last_name: string
  full_name?: string | null
  other_names?: string
  department?: string
  department_id?: string | null
  designation?: string
  phone_number?: string
  additional_phone?: string
  residential_address?: string
  current_work_location?: string
  office_location?: string
  is_admin: boolean
  role: UserRole
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

export interface EmployeeSuspension {
  id: string
  employee_id: string
  suspended_by?: string
  reason: string
  start_date: string
  end_date?: string
  is_active: boolean
  lifted_by?: string
  lifted_at?: string
  lift_reason?: string
  created_at: string
  updated_at: string
}

export interface EmployeeStatusChange {
  new_status: EmploymentStatus
  reason?: string
  suspension_end_date?: string // For suspended status
  separation_date?: string // For exited status
}

export interface EmployeeFormData {
  first_name: string
  last_name: string
  other_names?: string
  department?: string
  department_id?: string
  designation?: string
  phone_number?: string
  additional_phone?: string
  residential_address?: string
  current_work_location?: string
  office_location?: string
  role?: UserRole
}

// ============================================
// Department Types
// ============================================

export interface Department {
  id: string
  name: string
  description?: string
  department_code?: string | null
  is_executive_dept: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DepartmentWithStats extends Department {
  employee_count?: number
  lead?: Employee
}

// ============================================
// Attendance Types
// ============================================

export type AttendanceStatus = "present" | "absent" | "late" | "on_leave"

export interface AttendanceRecord {
  id: string
  employee_id: string
  date: string
  clock_in?: string
  clock_out?: string
  status: AttendanceStatus
  notes?: string
  created_at: string
  updated_at: string
}

export interface AttendanceSummary {
  present: number
  absent: number
  late: number
  on_leave: number
  total: number
}

// ============================================
// Leave Types
// ============================================

export type LeaveType = "annual" | "sick" | "maternity" | "paternity" | "unpaid" | "compassionate" | "study"
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled"
export type LeaveApprovalStage =
  | "reliever_pending"
  | "supervisor_pending"
  | "hr_pending"
  | "completed"
  | "rejected"
  | "cancelled"

export interface LeaveRequest {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  resume_date?: string
  days_requested: number
  reason?: string
  handover_note?: string
  handover_checklist_url?: string
  reliever_id?: string
  supervisor_id?: string
  approval_stage?: LeaveApprovalStage
  requested_days_mode?: "calendar_days" | "business_days"
  status: LeaveStatus
  approved_by?: string
  approved_at?: string
  rejection_reason?: string
  workflow_rejection_stage?: "reliever" | "supervisor" | "hr"
  reliever_decision_at?: string
  supervisor_decision_at?: string
  hr_decision_at?: string
  created_at: string
  updated_at: string
}

export interface LeavePolicy {
  id: string
  leave_type_id: string
  annual_days: number
  eligibility: "all" | "female_only" | "male_only" | "custom"
  min_tenure_months: number
  notice_days: number
  accrual_mode: "calendar_days" | "business_days"
  carry_forward_cap: number
  carry_forward_expiry?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LeaveBalance {
  id: string
  employee_id: string
  leave_type: LeaveType
  year: number
  total_days: number
  used_days: number
  remaining_days: number
}

// ============================================
// Performance Types
// ============================================

export type PerformanceRating = 1 | 2 | 3 | 4 | 5
export type ReviewStatus = "draft" | "submitted" | "acknowledged"

export interface PerformanceGoal {
  id: string
  employee_id: string
  title: string
  description?: string
  target_date?: string
  progress: number
  status: "not_started" | "in_progress" | "completed" | "cancelled"
  created_at: string
  updated_at: string
}

export interface PerformanceReview {
  id: string
  employee_id: string
  reviewer_id: string
  review_period_start: string
  review_period_end: string
  overall_rating?: PerformanceRating
  strengths?: string
  areas_for_improvement?: string
  goals_for_next_period?: string
  employee_comments?: string
  status: ReviewStatus
  submitted_at?: string
  acknowledged_at?: string
  created_at: string
  updated_at: string
}

// ============================================
// Recruitment Types (Future)
// ============================================

export type JobStatus = "draft" | "open" | "closed" | "on_hold"
export type ApplicantStatus = "new" | "screening" | "interview" | "offer" | "hired" | "rejected"

export interface JobPosting {
  id: string
  title: string
  department_id: string
  description: string
  requirements: string[]
  location?: string
  employment_type: "full_time" | "part_time" | "contract"
  salary_range?: {
    min: number
    max: number
    currency: string
  }
  status: JobStatus
  posted_at?: string
  closes_at?: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface Applicant {
  id: string
  job_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  resume_url?: string
  cover_letter?: string
  status: ApplicantStatus
  notes?: string
  created_at: string
  updated_at: string
}

// ============================================
// Training Types (Future)
// ============================================

export interface TrainingProgram {
  id: string
  title: string
  description?: string
  duration_hours: number
  is_mandatory: boolean
  department_id?: string
  created_at: string
  updated_at: string
}

export interface TrainingEnrollment {
  id: string
  program_id: string
  employee_id: string
  status: "enrolled" | "in_progress" | "completed" | "cancelled"
  enrolled_at: string
  completed_at?: string
  score?: number
}
