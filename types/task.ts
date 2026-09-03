import type { TaskStatus, TaskAssignmentType } from "@/lib/tasks/constants"
export type { TaskStatus, TaskAssignmentType }
export type TaskSourceType = "manual" | "help_desk" | "action_item"

export interface TaskPersonSummary {
  id: string
  first_name: string
  last_name: string
  department?: string | null
  completed?: boolean
}

export interface Task {
  id: string
  title: string
  description?: string | null
  work_item_number?: string | null
  priority: string
  status: string
  due_date?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
  updated_at?: string | null
  source_type?: TaskSourceType
  source_id?: string | null
  assignment_type?: TaskAssignmentType
  assigned_to?: string | null
  assigned_by?: string | null
  assigned_at?: string | null
  department?: string | null
  goal_id?: string | null
  goal_title?: string | null
  /** The corporate KPI this task's work serves. Reporting label only — does not affect scoring. */
  kpi_id?: string | null
  kpi_measure?: string | null
  project_id?: string | null
  project_name?: string | null
  plan_id?: string | null
  /** Shared by every row of one multi-assign fan-out. */
  group_id?: string | null
  weight: number
  rating?: number | null
  rated_by?: string | null
  rated_at?: string | null
  task_start_date?: string | null
  task_end_date?: string | null
  created_by?: string | null
  updated_by?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  reassigned_to?: string | null
  unable_to_complete_reason?: string | null
  failure_reason?: string | null
  extension_reason?: string | null
  is_archived?: boolean
  archived_by?: string | null
  archived_at?: string | null

  // Enriched relational data
  assigned_to_user?: TaskPersonSummary
  assigned_by_user?: TaskPersonSummary
  created_by_user?: TaskPersonSummary
  updated_by_user?: TaskPersonSummary
  reviewed_by_user?: TaskPersonSummary
  rated_by_user?: TaskPersonSummary
  reassigned_to_user?: TaskPersonSummary
  assigned_users?: TaskPersonSummary[]
  can_change_status?: boolean
  comment_count?: number
  user_completed?: boolean
}

export interface TaskUserProfile {
  id?: string
  department?: string | null
  role?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}
