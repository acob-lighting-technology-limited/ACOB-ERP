import { BaseService } from "../base.service"
import type { TaskStatus, TaskAssignmentType } from "@/lib/tasks/constants"

export interface TaskFields {
  id?: string
  title: string
  description?: string
  priority: "low" | "normal" | "high" | "urgent"
  status: TaskStatus
  assigned_to?: string
  assigned_by?: string
  assigned_at?: string
  department?: string
  due_date?: string
  project_id?: string
  goal_id?: string
  task_start_date?: string
  task_end_date?: string
  time_estimate?: string
  assignment_type?: TaskAssignmentType
  created_by?: string
  updated_by?: string
  reviewed_by?: string
  reviewed_at?: string
  reassigned_to?: string
  unable_to_complete_reason?: string
  failure_reason?: string
  extension_reason?: string
  is_archived?: boolean
  archived_by?: string
  archived_at?: string
  created_at?: string
  updated_at?: string
}

type ProfileRow = {
  id: string
  first_name: string
  last_name: string
  department: string | null
}

type MultipleProfileRow = {
  id: string
  first_name: string
  last_name: string
  department?: string | null
}

type TaskAssignmentRow = {
  task_id: string
  user_id: string
}

type TaskRow = TaskFields & {
  id: string
  created_at: string
  updated_at: string
  assigned_to_user?: ProfileRow
  assigned_by_user?: ProfileRow
  created_by_user?: ProfileRow
  updated_by_user?: ProfileRow
  reviewed_by_user?: ProfileRow
  reassigned_to_user?: ProfileRow
  assigned_users?: MultipleProfileRow[]
}

/**
 * Service for managing tasks.
 */
export class TaskService extends BaseService {
  constructor() {
    super("tasks")
  }

  /**
   * Get all tasks with user and attribution details
   */
  async getAllWithDetails(filters?: { department?: string; status?: string; includeArchived?: boolean }) {
    const supabase = await this.getClient()

    let query = supabase.from(this.tableName).select("*").order("created_at", { ascending: false })

    if (!filters?.includeArchived) {
      query = query.eq("is_archived", false)
    }
    if (filters?.department) {
      query = query.eq("department", filters.department)
    }
    if (filters?.status) {
      query = query.eq("status", filters.status)
    }

    const { data, error } = await query
    if (error) throw error

    const tasks = (data || []) as TaskRow[]
    if (tasks.length === 0) return []

    // Collect all user IDs for batch fetching
    const userIds = new Set<string>()
    tasks.forEach((task) => {
      if (task.assigned_to) userIds.add(task.assigned_to)
      if (task.assigned_by) userIds.add(task.assigned_by)
      if (task.created_by) userIds.add(task.created_by)
      if (task.updated_by) userIds.add(task.updated_by)
      if (task.reviewed_by) userIds.add(task.reviewed_by)
      if (task.reassigned_to) userIds.add(task.reassigned_to)
    })

    const multipleTaskIds = tasks.filter((task) => task.assignment_type === "multiple").map((task) => task.id)

    // Batch fetch profiles & assignments
    const [profilesResult, assignmentsResult] = await Promise.all([
      userIds.size > 0
        ? supabase.from("profiles").select("id, first_name, last_name, department").in("id", Array.from(userIds))
        : { data: [], error: null },
      multipleTaskIds.length > 0
        ? supabase.from("task_assignments").select("task_id, user_id").in("task_id", multipleTaskIds)
        : { data: [], error: null },
    ])

    if (profilesResult.error) throw profilesResult.error
    if (assignmentsResult.error) throw assignmentsResult.error

    const profileMap = new Map(((profilesResult.data || []) as ProfileRow[]).map((p) => [p.id, p]))

    // Handle extra profiles from task_assignments if not already fetched
    if (assignmentsResult.data && assignmentsResult.data.length > 0) {
      const extraUserIds = (assignmentsResult.data as TaskAssignmentRow[])
        .map((a) => a.user_id)
        .filter((uid) => !profileMap.has(uid))

      if (extraUserIds.length > 0) {
        const { data: extraProfiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, department")
          .in("id", Array.from(new Set(extraUserIds)))
        ;((extraProfiles || []) as ProfileRow[]).forEach((p) => profileMap.set(p.id, p))
      }
    }

    const assignmentsMap = new Map<string, string[]>()
    ;((assignmentsResult.data || []) as TaskAssignmentRow[]).forEach((assignment) => {
      const existing = assignmentsMap.get(assignment.task_id) || []
      assignmentsMap.set(assignment.task_id, [...existing, assignment.user_id])
    })

    // Enrich tasks
    return tasks.map((task) => {
      const taskData = { ...task }

      if (task.assigned_to) taskData.assigned_to_user = profileMap.get(task.assigned_to)
      if (task.assigned_by) taskData.assigned_by_user = profileMap.get(task.assigned_by)
      if (task.created_by) taskData.created_by_user = profileMap.get(task.created_by)
      if (task.updated_by) taskData.updated_by_user = profileMap.get(task.updated_by)
      if (task.reviewed_by) taskData.reviewed_by_user = profileMap.get(task.reviewed_by)
      if (task.reassigned_to) taskData.reassigned_to_user = profileMap.get(task.reassigned_to)

      if (task.assignment_type === "multiple") {
        const uids = assignmentsMap.get(task.id) || []
        taskData.assigned_users = uids.map((id) => profileMap.get(id)).filter((p): p is ProfileRow => Boolean(p))
      }

      return taskData
    })
  }

  /**
   * Get tasks assigned to a specific user
   */
  async getByAssignedUser(userId: string) {
    const supabase = await this.getClient()

    // Individual tasks
    const { data: individual, error: individualError } = await supabase
      .from(this.tableName)
      .select("*")
      .eq("assigned_to", userId)
      .eq("is_archived", false)
    if (individualError) throw individualError

    // Multiple-user tasks through assignments
    const { data: assignments, error: assignmentsError } = await supabase
      .from("task_assignments")
      .select("task_id")
      .eq("user_id", userId)
    if (assignmentsError) throw assignmentsError

    const multipleTaskIds = ((assignments || []) as Array<Pick<TaskAssignmentRow, "task_id">>).map((a) => a.task_id)
    const { data: multiple, error: multipleError } =
      multipleTaskIds.length > 0
        ? await supabase.from(this.tableName).select("*").in("id", multipleTaskIds).eq("is_archived", false)
        : { data: [], error: null }
    if (multipleError) throw multipleError

    // Combine and deduplicate
    const allTasks = [...(individual || []), ...(multiple || [])]
    return Array.from(new Map((allTasks as TaskRow[]).map((task) => [task.id, task])).values())
  }

  /**
   * Get task statistics
   */
  async getStats() {
    const supabase = await this.getClient()

    const results = await Promise.all([
      supabase.from(this.tableName).select("*", { count: "exact", head: true }).eq("is_archived", false),
      supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("is_archived", false)
        .eq("status", "pending"),
      supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("is_archived", false)
        .eq("status", "in_progress"),
      supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("is_archived", false)
        .eq("status", "submitted_for_review"),
      supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("is_archived", false)
        .eq("status", "completed"),
      supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("is_archived", false)
        .eq("priority", "urgent"),
    ])

    const firstError = results.find((r) => r.error)?.error
    if (firstError) throw firstError
    const [totalRes, pendingRes, inProgressRes, submittedRes, completedRes, urgentRes] = results

    return {
      total: totalRes.count ?? 0,
      pending: pendingRes.count ?? 0,
      inProgress: inProgressRes.count ?? 0,
      submittedForReview: submittedRes.count ?? 0,
      completed: completedRes.count ?? 0,
      urgent: urgentRes.count ?? 0,
    }
  }
}

export const taskService = new TaskService()
