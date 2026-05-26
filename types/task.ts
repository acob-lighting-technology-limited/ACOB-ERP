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
  source_type?: TaskSourceType
  source_id?: string | null
  assignment_type?: TaskAssignmentType
  assigned_to?: string | null
  assigned_by?: string | null
  department?: string | null
  goal_id?: string | null
  goal_title?: string | null
  task_start_date?: string | null
  task_end_date?: string | null
  assigned_to_user?: TaskPersonSummary
  assigned_by_user?: Omit<TaskPersonSummary, "id" | "completed">
  can_change_status?: boolean
  comment_count?: number
}

export interface TaskUserProfile {
  department?: string | null
  role?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}
