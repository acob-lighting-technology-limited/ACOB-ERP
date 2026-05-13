import { BaseService } from "../base.service"

export interface TaskFields {
  id?: string
  title: string
  description?: string
  priority: "low" | "normal" | "high" | "urgent"
  status: "pending" | "in_progress" | "completed" | "cancelled"
  assigned_to?: string
  assigned_by?: string
  department?: string
  due_date?: string
  project_id?: string
  task_start_date?: string
  time_estimate?: string
  assignment_type?: "individual" | "multiple" | "department"
  created_at?: string
  updated_at?: string
}

type TaskRow = TaskFields & {
  id: string
  created_at: string
  updated_at: string
  assigned_to_user?: ProfileRow
  assigned_users?: MultipleProfileRow[]
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
}
type TaskAssignmentRow = {
  task_id: string
  user_id: string
}

/**
 * Service for managing tasks.
 */
export class TaskService extends BaseService {
  constructor() {
    super("tasks")
  }

  /**
   * Get all tasks with user and project details
   */
  async getAllWithDetails(filters?: { department?: string; status?: string }) {
    const supabase = await this.getClient()

    let query = supabase.from(this.tableName).select("*").order("created_at", { ascending: false })

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

    // Collect IDs for batch fetching
    const individualUserIds = Array.from(
      new Set(
        tasks
          .filter((task) => task.assignment_type === "individual" && task.assigned_to)
          .map((task) => task.assigned_to)
      )
    )
    const multipleTaskIds = tasks.filter((task) => task.assignment_type === "multiple").map((task) => task.id)

    // Batch fetch data
    const [profilesResult, assignmentsResult] = await Promise.all([
      individualUserIds.length > 0
        ? supabase.from("profiles").select("id, first_name, last_name, department").in("id", individualUserIds)
        : { data: [], error: null },
      multipleTaskIds.length > 0
        ? supabase.from("task_assignments").select("task_id, user_id").in("task_id", multipleTaskIds)
        : { data: [], error: null },
    ])

    if (profilesResult.error) throw profilesResult.error
    if (assignmentsResult.error) throw assignmentsResult.error

    // Fetch details for multiple assignments if needed
    let multipleProfiles: MultipleProfileRow[] = []
    if (assignmentsResult.data && assignmentsResult.data.length > 0) {
      const multipleUserIds = Array.from(
        new Set((assignmentsResult.data as TaskAssignmentRow[]).map((assignment) => assignment.user_id))
      )
      const { data: mProfiles, error: mProfilesError } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", multipleUserIds)
      if (mProfilesError) throw mProfilesError
      multipleProfiles = mProfiles || []
    }

    // Build lookup maps
    const profileMap = new Map(((profilesResult.data || []) as ProfileRow[]).map((profile) => [profile.id, profile]))
    const multipleProfileMap = new Map(multipleProfiles.map((profile) => [profile.id, profile]))
    const assignmentsMap = new Map<string, string[]>()
    ;((assignmentsResult.data || []) as TaskAssignmentRow[]).forEach((assignment) => {
      const existing = assignmentsMap.get(assignment.task_id) || []
      assignmentsMap.set(assignment.task_id, [...existing, assignment.user_id])
    })

    // Enrich tasks
    return tasks.map((task) => {
      const taskData = { ...task }

      if (task.assignment_type === "individual" && task.assigned_to) {
        taskData.assigned_to_user = profileMap.get(task.assigned_to)
      }

      if (task.assignment_type === "multiple") {
        const userIds = assignmentsMap.get(task.id) || []
        taskData.assigned_users = userIds
          .map((id) => multipleProfileMap.get(id))
          .filter((profile): profile is MultipleProfileRow => Boolean(profile))
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
      .eq("assignment_type", "individual")
    if (individualError) throw individualError

    // Multiple-user tasks through assignments
    const { data: assignments, error: assignmentsError } = await supabase
      .from("task_assignments")
      .select("task_id")
      .eq("user_id", userId)
    if (assignmentsError) throw assignmentsError

    const multipleTaskIds = ((assignments || []) as Array<Pick<TaskAssignmentRow, "task_id">>).map(
      (assignment) => assignment.task_id
    )
    const { data: multiple, error: multipleError } =
      multipleTaskIds.length > 0
        ? await supabase.from(this.tableName).select("*").in("id", multipleTaskIds).eq("assignment_type", "multiple")
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
      supabase.from(this.tableName).select("*", { count: "exact", head: true }),
      supabase.from(this.tableName).select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from(this.tableName).select("*", { count: "exact", head: true }).eq("status", "in_progress"),
      supabase.from(this.tableName).select("*", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from(this.tableName).select("*", { count: "exact", head: true }).eq("priority", "urgent"),
    ])

    const firstError = results.find((r) => r.error)?.error
    if (firstError) throw firstError
    const [totalRes, pendingRes, inProgressRes, completedRes, urgentRes] = results

    return {
      total: totalRes.count ?? 0,
      pending: pendingRes.count ?? 0,
      inProgress: inProgressRes.count ?? 0,
      completed: completedRes.count ?? 0,
      urgent: urgentRes.count ?? 0,
    }
  }
}

export const taskService = new TaskService()
