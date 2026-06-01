import { createClient } from "@/lib/supabase/client"

export interface ActionTask {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  department: string
  due_date?: string
  week_number: number
  year: number
}

export interface ActionTrackerMetadata {
  profile: {
    id?: string
    role?: string | null
    department?: string | null
    is_department_lead?: boolean | null
    lead_departments?: string[] | null
    admin_routes?: string[] | null
  } | null
  allDepartments: string[]
}

export interface ActionTrackerTasksResult {
  tasks: ActionTask[]
}

export async function fetchActionTrackerMetadata(
  supabase: ReturnType<typeof createClient>
): Promise<ActionTrackerMetadata> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let profile: ActionTrackerMetadata["profile"] = null
  if (user) {
    const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single()
    profile = p
  }

  const { data: depts } = await supabase.from("profiles").select("department").not("department", "is", null)
  const allDepartments = depts
    ? (Array.from(new Set(depts.map((d) => d.department)))
        .filter(Boolean)
        .sort() as string[])
    : []

  return { profile, allDepartments }
}

export async function fetchActionTrackerTasks(
  supabase: ReturnType<typeof createClient>,
  week: number,
  year: number,
  deptFilter: string
): Promise<ActionTrackerTasksResult> {
  const params = new URLSearchParams({ week: String(week), year: String(year), dept: deptFilter })
  const response = await fetch(`/api/reports/action-tracker?${params.toString()}`, { cache: "no-store" })
  const payload = (await response.json().catch(() => null)) as { data?: ActionTask[]; error?: string } | null
  if (!response.ok) throw new Error(payload?.error || "Failed to fetch action items")
  return { tasks: payload?.data || [] }
}

export function getDeptStatus(tasks: ActionTask[], dept: string) {
  const deptActions = tasks.filter((t) => t.department === dept)
  if (deptActions.length === 0)
    return { label: "Pending", color: "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400" }
  if (deptActions.every((a) => a.status === "completed"))
    return { label: "Finished", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" }
  if (deptActions.some((a) => a.status === "in_progress" || a.status === "completed"))
    return { label: "Started", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" }
  return { label: "Pending", color: "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400" }
}

export function getStatusColor(status: string) {
  if (status === "completed") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
  if (status === "in_progress") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
  if (status === "not_started") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
  return "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400"
}
