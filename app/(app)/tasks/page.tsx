import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { TasksContent } from "./management/tasks-content"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import type { Task, TaskUserProfile } from "@/types/task"

/**
 * The task list is loaded by `loadUserTasks` here and on every client refresh,
 * so the first paint and every later one agree. This page previously ran its
 * own copy of those queries which omitted the `is_archived` filter, leaving
 * deleted tasks on screen until something triggered a refetch.
 */
async function getTasksData() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("department, role, is_department_lead, lead_departments")
    .eq("id", user.id)
    .maybeSingle<TaskUserProfile>()

  const tasks = await loadUserTasks(
    supabase as unknown as Parameters<typeof loadUserTasks>[0],
    user.id,
    userProfile ?? null
  )

  return {
    tasks: tasks.map((task) => ({
      ...task,
      // Department-wide work is progressed from the department queue, not from
      // an individual's list.
      can_change_status: task.assignment_type === "department" ? false : task.can_change_status,
    })) as Task[],
    userId: user.id,
    userProfile: userProfile ?? null,
  }
}

export default async function TasksPage() {
  const data = await getTasksData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const tasksData = data as {
    tasks: Task[]
    userId: string
    userProfile: TaskUserProfile | null
  }

  return <TasksContent initialTasks={tasksData.tasks} userId={tasksData.userId} userProfile={tasksData.userProfile} />
}
