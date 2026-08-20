import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AdminTasksContent } from "./management/admin-tasks-content"
import type { Task, employee, UserProfile } from "./management/admin-tasks-content"
import type { TaskPersonSummary } from "@/types/task"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"

interface GoalFilterOption {
  id: string
  title: string
}

type GoalRow = {
  id: string
  title: string
}

export const dynamic = "force-dynamic"
export const revalidate = 0

async function getAdminTasksData() {
  const scope = await getRequestScope()
  if (!scope) {
    return { redirect: "/auth/login" as const }
  }

  const supabase = await createClient()

  // 1. Get current authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { redirect: "/auth/login" as const }
  }

  // 2. Fetch user profile with role info
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, department, is_department_lead, lead_departments")
    .eq("id", user.id)
    .single()

  const departmentScope = getScopedDepartments(scope)
  const isGlobalTaskAssigner = scope.isAdminLike === true && scope.scopeMode !== "lead"
  const isDeptLead = profile?.is_department_lead ?? false

  const userProfile: UserProfile = {
    id: user.id,
    role: profile?.role || "employee",
    department: profile?.department,
    is_department_lead: isDeptLead,
    lead_departments: profile?.lead_departments || [],
    managed_departments: isGlobalTaskAssigner ? [] : (departmentScope ?? profile?.lead_departments ?? []),
    is_global_task_assigner: isGlobalTaskAssigner,
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)

  // 3. Fetch non-archived tasks and active assignable profiles
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
      departmentScope: departmentScope && departmentScope.length > 0 ? departmentScope : undefined,
      allowLegacyNullStatus: true,
    }),
  ])

  const rawTasks = (tasksResult.data || []) as Task[]

  // Collect all profile and goal IDs
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

  // For leads, filter tasks strictly by their departments
  let filteredTasks = tasksWithUsers.filter((task) => String(task.source_type || "") !== "action_item")
  if (departmentScope) {
    const scopedDepartmentTokens = new Set(
      departmentScope.map((departmentName) => normalizeDepartmentName(departmentName))
    )
    filteredTasks = filteredTasks.filter((task) => {
      if (task.department && scopedDepartmentTokens.has(normalizeDepartmentName(task.department))) {
        return true
      }
      if (
        task.assigned_to_user?.department &&
        scopedDepartmentTokens.has(normalizeDepartmentName(task.assigned_to_user.department))
      ) {
        return true
      }
      if (task.assignment_type === "individual" && task.assigned_to === user.id) {
        return true
      }
      return false
    })
  }

  // Get unique departments
  let departments: string[] = []
  if (departmentScope) {
    departments = [...departmentScope].sort()
  } else {
    departments = Array.from(
      new Set(((employeeResult.data as employee[] | null) || []).map((s) => s.department).filter(Boolean))
    ) as string[]
    departments.sort()
  }

  let goalsQuery = dataClient.from("goals_objectives").select("id, title, department").eq("is_archived", false)
  if (departmentScope && departmentScope.length > 0) {
    goalsQuery = goalsQuery.in("department", departmentScope)
  }
  const { data: goalRowsRaw } = await goalsQuery.order("title", { ascending: true })
  const goalRows = ((goalRowsRaw || []) as GoalRow[]).map((goal) => ({
    id: goal.id,
    title: goal.title,
  })) as GoalFilterOption[]

  return {
    tasks: filteredTasks as Task[],
    employee: (employeeResult.data || []) as employee[],
    departments,
    goals: goalRows,
    userProfile,
  }
}

export default async function AdminTasksPage(props: { searchParams?: Promise<{ goal_id?: string }> }) {
  const searchParams = await props.searchParams
  const data = await getAdminTasksData()

  if ("redirect" in data && typeof data.redirect === "string") {
    redirect(data.redirect)
  }

  return (
    <AdminTasksContent
      initialTasks={data.tasks}
      initialemployee={data.employee}
      initialDepartments={data.departments}
      initialGoals={data.goals}
      userProfile={data.userProfile}
      initialGoalId={searchParams?.goal_id || ""}
    />
  )
}
