import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AdminGoalsContent } from "./admin-goals-content"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import type { Goal } from "@/app/(app)/goals/page"

type GoalWithCycle = Goal & {
  cycle?: {
    id: string
    name: string
    review_type: string | null
  } | null
}

async function getAdminGoalPageData() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const scope = await getRequestScope()
  if (!scope) return { redirect: "/profile" as const }

  const scopedDepts = getScopedDepartments(scope)
  let managedDepartments: string[]

  if (scopedDepts === null) {
    // Global admin — all departments
    const { data: allDepts } = await supabase.from("departments").select("name").order("name", { ascending: true })
    managedDepartments = (allDepts || []).map((row) => row.name).filter(Boolean)
  } else {
    // Lead or admin in lead mode — expand aliases
    managedDepartments = scopedDepts.length > 0 ? scopedDepts : []
  }

  const [goalsResult, cyclesResult] = await Promise.all([
    managedDepartments.length > 0
      ? supabase
          .from("goals_objectives")
          .select("*")
          .in("department", managedDepartments)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Goal[] }),
    supabase
      .from("review_cycles")
      .select("id, name, review_type, start_date, end_date")
      .order("start_date", { ascending: false }),
  ])

  const cycles = cyclesResult.data || []
  const cyclesById = new Map(cycles.map((cycle) => [cycle.id, cycle]))
  const goals = ((goalsResult.data || []) as Goal[]).map((goal) => ({
    ...goal,
    cycle: goal.review_cycle_id ? cyclesById.get(goal.review_cycle_id) || null : null,
  })) as GoalWithCycle[]

  return {
    goals,
    cycles,
    canCreateGoal: scope.isAdminLike || scope.isDepartmentLead,
    managedDepartments,
  }
}

export default async function AdminPmsGoalsPage() {
  const data = await getAdminGoalPageData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  return (
    <AdminGoalsContent
      initialGoals={data.goals}
      cycles={data.cycles}
      canCreateGoal={data.canCreateGoal}
      managedDepartments={data.managedDepartments}
    />
  )
}
