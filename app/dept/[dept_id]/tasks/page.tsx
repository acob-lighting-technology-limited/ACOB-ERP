import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"
import { AdminTasksContent, type employee, type UserProfile } from "@/app/admin/tasks/management/admin-tasks-content"
import type { Task } from "@/types/task"

type GoalFilterOption = { id: string; title: string }
type GoalRow = { id: string; title: string }
type ProfileDepartmentRow = { id: string; first_name: string; last_name: string; department: string | null }

interface DeptTasksPageProps {
  params: Promise<{ dept_id: string }>
  searchParams?: Promise<{ goal_id?: string }>
}

export default async function DeptTasksPage({ params, searchParams }: DeptTasksPageProps) {
  const { dept_id } = await params
  const resolvedSearchParams = await searchParams
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id ?? scope.userId

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepts = expandDepartmentScopeForQuery([deptName])

  const userProfile: UserProfile = {
    id: userId,
    role: scope.role,
    department: scope.deptName,
    is_department_lead: true,
    lead_departments: [scope.deptName],
    managed_departments: [scope.deptName],
    is_global_task_assigner: false,
  }

  const [tasksResult, employeeResult] = await Promise.all([
    dataClient.from("tasks").select("*").neq("category", "weekly_action").order("created_at", { ascending: false }),
    listAssignableProfiles(dataClient, {
      select:
        "id, first_name, last_name, company_email, department, employment_status, is_department_lead, lead_departments",
      departmentScope: expandedDepts,
      allowLegacyNullStatus: true,
    }),
  ])

  const allIndivUserIds = Array.from(
    new Set(
      ((tasksResult.data as Task[] | null) || [])
        .filter((t) => t.assignment_type === "individual" && t.assigned_to)
        .map((t) => t.assigned_to)
    )
  ) as string[]

  const { data: indivProfiles } =
    allIndivUserIds.length > 0
      ? await dataClient.from("profiles").select("id, first_name, last_name, department").in("id", allIndivUserIds)
      : { data: [] }

  const indivProfileMap = new Map(((indivProfiles as ProfileDepartmentRow[] | null) || []).map((p) => [p.id, p]))

  const taskGoalIds = Array.from(
    new Set(((tasksResult.data as Task[] | null) || []).map((t) => t.goal_id).filter(Boolean) as string[])
  )
  const { data: taskGoalRows } =
    taskGoalIds.length > 0
      ? await dataClient.from("goals_objectives").select("id, title").in("id", taskGoalIds)
      : { data: [] as GoalRow[] }
  const taskGoalMap = new Map(((taskGoalRows as GoalRow[] | null) || []).map((g) => [g.id, g.title]))

  const tasksWithUsers = ((tasksResult.data as Task[] | null) || []).map((task) => {
    const taskData: Task = { ...task }
    if (task.assignment_type === "individual" && task.assigned_to) {
      const assignedProfile = indivProfileMap.get(task.assigned_to)
      taskData.assigned_to_user = assignedProfile
        ? { ...assignedProfile, department: assignedProfile.department || "" }
        : undefined
    }
    taskData.goal_title = task.goal_id ? taskGoalMap.get(task.goal_id) || null : null
    return taskData
  }) as Task[]

  // Filter to this dept
  const scopedTokens = new Set(expandedDepts.map((d) => normalizeDepartmentName(d)))
  const filteredTasks = tasksWithUsers
    .filter((t) => String(t.source_type || "") !== "action_item")
    .filter((task) => {
      if (task.department && scopedTokens.has(normalizeDepartmentName(task.department))) return true
      if (
        task.assigned_to_user?.department &&
        scopedTokens.has(normalizeDepartmentName(task.assigned_to_user.department))
      )
        return true
      if (task.assignment_type === "individual" && task.assigned_to === userId) return true
      return false
    })

  const { data: goalRowsRaw } = await dataClient
    .from("goals_objectives")
    .select("id, title, department, approval_status")
    .in("department", expandedDepts)
    .order("title", { ascending: true })

  const goalRows = (goalRowsRaw || [])
    .filter((g) => String(g.approval_status || "").toLowerCase() === "approved")
    .map((g) => ({ id: g.id, title: g.title })) as GoalFilterOption[]

  return (
    <AdminTasksContent
      initialTasks={filteredTasks}
      initialemployee={(employeeResult.data || []) as employee[]}
      initialDepartments={[deptName]}
      initialGoals={goalRows}
      userProfile={userProfile}
      initialGoalId={resolvedSearchParams?.goal_id || ""}
    />
  )
}
