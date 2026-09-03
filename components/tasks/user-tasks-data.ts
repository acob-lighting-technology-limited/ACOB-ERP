import { createClient } from "@/lib/supabase/client"
import type { Task, TaskUserProfile, TaskPersonSummary } from "@/types/task"
import { getOfficeWeekMonday } from "@/lib/meeting-week"

type ActionItemDueDateRow = {
  id: string
  due_date?: string | null
  week_number: number
  year: number
}

function toLocalDueDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

function resolveActionItemDueDate(actionItem?: ActionItemDueDateRow | null) {
  if (!actionItem) return undefined
  if (actionItem.due_date) return actionItem.due_date

  const sunday = getOfficeWeekMonday(actionItem.week_number, actionItem.year)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 0, 0)
  return toLocalDueDateString(sunday)
}

/**
 * Every task one person should see, from one place.
 *
 * This is the single loader for the task list. The `/tasks` page used to run
 * its own near-copy of these queries without the `is_archived` filter, so a
 * deleted task stayed on screen through the server render and only disappeared
 * on the next client refresh — which is exactly how "I deleted it and they can
 * still see it" gets reported.
 */
export async function loadUserTasks(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userProfile: TaskUserProfile | null
): Promise<Task[]> {
  // 1. Fetch direct tasks assigned to user or created by user
  const { data: directTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("is_archived", false)
    .or(`assigned_to.eq.${userId},assigned_by.eq.${userId}`)
    .neq("category", "weekly_action")
    .order("created_at", { ascending: false })

  // 2. Fetch multi-assignment tasks
  const { data: assignments } = await supabase.from("task_assignments").select("task_id").eq("user_id", userId)

  const multiTaskIds = (assignments || []).map((a: { task_id: string }) => a.task_id)
  const { data: multiTasks } =
    multiTaskIds.length > 0
      ? await supabase.from("tasks").select("*").in("id", multiTaskIds).eq("is_archived", false)
      : { data: [] }

  // 3. Work assigned to the whole department. Help-desk tickets are excluded:
  //    they have their own queue and would otherwise appear twice.
  const { data: departmentTasks } = userProfile?.department
    ? await supabase
        .from("tasks")
        .select("*")
        .eq("is_archived", false)
        .eq("department", userProfile.department)
        .eq("assignment_type", "department")
        .neq("source_type", "help_desk")
        .neq("category", "weekly_action")
    : { data: [] }

  const allTasks = [...(directTasks || []), ...(multiTasks || []), ...(departmentTasks || [])].filter(
    (task) => String(task.source_type || "") !== "action_item"
  )
  const uniqueTasks = Array.from(new Map(allTasks.map((task) => [task.id, task])).values()) as Task[]
  if (uniqueTasks.length === 0) return []
  const taskIds = uniqueTasks.map((task) => task.id)

  const userIds = new Set<string>()
  const goalIds = new Set<string>()
  for (const task of uniqueTasks) {
    if (task.assigned_by) userIds.add(task.assigned_by)
    if (task.assigned_to) userIds.add(task.assigned_to)
    if (task.created_by) userIds.add(task.created_by)
    if (task.reviewed_by) userIds.add(task.reviewed_by)
    if (task.goal_id) goalIds.add(task.goal_id)
  }

  const [profilesRes, goalsRes, commentsRes, userCompletionsRes] = await Promise.all([
    userIds.size > 0
      ? supabase.from("profiles").select("id, first_name, last_name, department").in("id", Array.from(userIds))
      : { data: [] },
    goalIds.size > 0
      ? supabase.from("goals_objectives").select("id, title").in("id", Array.from(goalIds))
      : { data: [] },
    taskIds.length > 0
      ? supabase.from("task_updates").select("task_id").in("task_id", taskIds).eq("update_type", "comment")
      : { data: [] },
    taskIds.length > 0
      ? supabase.from("task_user_completion").select("task_id").in("task_id", taskIds).eq("user_id", userId)
      : { data: [] },
  ])

  const profileMap = new Map<string, TaskPersonSummary>(
    ((profilesRes.data || []) as TaskPersonSummary[]).map((p) => [p.id, p])
  )
  const goalMap = new Map<string, string>(
    ((goalsRes.data || []) as Array<{ id: string; title: string }>).map((g) => [g.id, g.title])
  )
  const completedTaskIds = new Set(
    (userCompletionsRes.data || []).map((row: { task_id?: string | null }) => String(row?.task_id || ""))
  )

  const commentCountMap = new Map<string, number>()
  for (const row of commentsRes.data || []) {
    const taskId = String((row as { task_id?: string | null }).task_id || "")
    if (!taskId) continue
    commentCountMap.set(taskId, (commentCountMap.get(taskId) || 0) + 1)
  }

  const actionItemIds = uniqueTasks
    .filter((task) => task.source_type === "action_item" && task.source_id)
    .map((task) => String(task.source_id))

  const { data: actionItems } =
    actionItemIds.length > 0
      ? await supabase.from("action_items").select("id, due_date, week_number, year").in("id", actionItemIds)
      : { data: [] }

  const actionItemDueDateMap = new Map(
    ((actionItems as ActionItemDueDateRow[] | null) || []).map((item) => [item.id, item] as const)
  )

  const tasksWithUsers = uniqueTasks.map((task) => {
    const taskData: Task = { ...task }
    taskData.comment_count = commentCountMap.get(task.id) || 0

    if (task.source_type === "action_item" && task.source_id) {
      taskData.due_date = resolveActionItemDueDate(actionItemDueDateMap.get(String(task.source_id))) || task.due_date
    }

    if (task.assigned_by) taskData.assigned_by_user = profileMap.get(task.assigned_by)
    if (task.assigned_to) taskData.assigned_to_user = profileMap.get(task.assigned_to)
    if (task.created_by) taskData.created_by_user = profileMap.get(task.created_by)
    if (task.reviewed_by) taskData.reviewed_by_user = profileMap.get(task.reviewed_by)
    if (task.goal_id) taskData.goal_title = goalMap.get(task.goal_id) || null
    taskData.user_completed = task.status === "completed" || completedTaskIds.has(task.id)

    return taskData
  })

  tasksWithUsers.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return tasksWithUsers || []
}
