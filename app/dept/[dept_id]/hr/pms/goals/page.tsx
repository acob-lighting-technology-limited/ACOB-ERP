import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { AdminGoalsContent } from "@/app/admin/hr/pms/goals/admin-goals-content"
import type { Goal } from "@/app/(app)/goals/page"

type GoalWithCycle = Goal & {
  cycle?: { id: string; name: string; review_type: string | null } | null
}

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsGoalsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const managedDepartments = expandDepartmentScopeForQuery([deptName])

  const [goalsResult, cyclesResult] = await Promise.all([
    managedDepartments.length > 0
      ? dataClient
          .from("goals_objectives")
          .select("*")
          .in("department", managedDepartments)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Goal[] }),
    dataClient
      .from("review_cycles")
      .select("id, name, review_type, start_date, end_date")
      .order("start_date", { ascending: false }),
  ])

  const cycles = cyclesResult.data || []
  const cyclesById = new Map(cycles.map((c) => [c.id, c]))
  const goals = ((goalsResult.data || []) as Goal[]).map((goal) => ({
    ...goal,
    cycle: goal.review_cycle_id ? cyclesById.get(goal.review_cycle_id) || null : null,
  })) as GoalWithCycle[]

  return (
    <AdminGoalsContent
      initialGoals={goals}
      cycles={cycles}
      canCreateGoal={true}
      managedDepartments={managedDepartments}
      backLinkHref={`/dept/${dept_id}/hr/pms`}
      goalsBasePath={`/dept/${dept_id}/hr/pms/goals`}
    />
  )
}
