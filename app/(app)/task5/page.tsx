import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import type { Task, TaskUserProfile } from "@/types/task"
import { Task5Content } from "./task5-content"

export default async function Task5Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("department, role, is_department_lead, lead_departments")
    .eq("id", user.id)
    .maybeSingle<TaskUserProfile>()
  const tasks = await loadUserTasks(
    supabase as unknown as Parameters<typeof loadUserTasks>[0],
    user.id,
    profile ?? null
  )

  return <Task5Content initialTasks={tasks as Task[]} userId={user.id} userProfile={profile ?? null} />
}
