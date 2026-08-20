import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"
import { AdminTasksContent, type employee, type UserProfile } from "@/app/admin/tasks/management/admin-tasks-content"
import type { Task, TaskPersonSummary } from "@/types/task"

type GoalFilterOption = { id: string; title: string }
type GoalRow = { id: string; title: string }

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
    department: deptName,
    is_department_lead: true,
    lead_departments: expandedDepts,
    managed_departments: expandedDepts,
    is_global_task_assigner: false,
  }

  const [tasksResult, employeeResult] = await Promise.all([
    dataClient
      .from("tasks")
      .select("*")
      .eq("is_archived", false)
      .neq("category", "weekly_action")
      .order("created_at", { ascending: false }),
    listAssignableProfiles(dataClient, {
      select:
        "id, first_name, last_name, company_email, department, employment_status, is_department_lead, lead_departments",
      departmentScope: expandedDepts,
      allowLegacyNullStatus: true,
    }),
  ])

  const rawTasks = (tasksResult.data || []) as Task[]

  const profileIds = new Set<string>()
  const goalIds = new Set<string>()

  rawTasks.forEach((t) => {
    if (t.assigned_to) profileIds.add(t.assigned_to)
    if (t.assigned_by) profileIds.add(t.assigned_by)
    if (t.created_by) profileIds.add(t.created_by)
    if (t.reviewed_by) profileIds.add(t.reviewed_by)
    if (t.goal_id) goalIds.add(t.goal_id)
  })

  const [profilesRes, goalsRes] = await Promise.all([
    profileIds.size > 0
      ? dataClient.from("profiles").select("id, first_name, last_name, department").in("id", Array.from(profileIds))
      : { data: [] },
    goalIds.size > 0
      ? dataClient.from("goals_objectives").select("id, title").in("id", Array.from(goalIds))
      : { data: [] },
  ])

  const profileMap = new Map<string, TaskPersonSummary>(
    ((profilesRes.data || []) as TaskPersonSummary[]).map((p) => [p.id, p])
  )
  const goalMap = new Map<string, string>(
    ((goalsRes.data || []) as Array<{ id: string; title: string }>).map((g) => [g.id, g.title])
  )

  const tasksWithUsers = rawTasks.map((task) => {
    const copy: Task = { ...task }
    if (task.assigned_to) copy.assigned_to_user = profileMap.get(task.assigned_to)
    if (task.assigned_by) copy.assigned_by_user = profileMap.get(task.assigned_by)
    if (task.created_by) copy.created_by_user = profileMap.get(task.created_by)
    if (task.reviewed_by) copy.reviewed_by_user = profileMap.get(task.reviewed_by)
    if (task.goal_id) copy.goal_title = goalMap.get(task.goal_id) || null
    return copy
  })

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
    .select("id, title, department")
    .eq("is_archived", false)
    .in("department", expandedDepts)
    .order("title", { ascending: true })

  const goalRows = ((goalRowsRaw || []) as GoalRow[]).map((g) => ({
    id: g.id,
    title: g.title,
  }))

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
