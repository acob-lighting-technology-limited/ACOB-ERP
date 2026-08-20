import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { computeDepartmentPerformanceScore } from "@/lib/performance/scoring"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { pickCurrentCycle } from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"
import type { ReviewCycleOption } from "@/app/(app)/pms/_lib"

type DepartmentRow = {
  name: string
}

type ScopedProfileRow = {
  id: string
  department: string | null
}

type GoalRow = {
  department?: string | null
  approval_status: string | null
  status: string | null
  review_cycle_id?: string | null
}

type DepartmentScore = Awaited<ReturnType<typeof computeDepartmentPerformanceScore>>

function round(value: number) {
  return Math.round(value * 100) / 100
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (valid.length === 0) return null
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

export async function getAdminPmsData(requestedCycleId?: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  // Use the middleware-injected scope (single source of truth)
  const scope = await getRequestScope()
  if (!scope) redirect("/profile")

  const scopedDepts = getScopedDepartments(scope)
  let departments: string[] = []

  const [{ data: allDepartments }, { data: cycleRows }] = await Promise.all([
    scopedDepts === null
      ? supabase.from("departments").select("name").order("name", { ascending: true }).returns<DepartmentRow[]>()
      : Promise.resolve({ data: [] as DepartmentRow[] }),
    supabase
      .from("review_cycles")
      .select("id, name, start_date, end_date, status, review_type")
      .order("start_date", { ascending: false }),
  ])

  const cycles: ReviewCycleOption[] = (cycleRows || []).map((c) => ({
    id: c.id,
    name: c.name || "Review Cycle",
    startDate: c.start_date,
    endDate: c.end_date,
    status: c.status || "closed",
    reviewType: c.review_type ?? null,
  }))

  const cadenceCycles = cycles.map((cycle) => ({
    id: cycle.id,
    review_type: cycle.reviewType,
    start_date: cycle.startDate,
    end_date: cycle.endDate,
  }))

  const activeCycleId =
    (requestedCycleId && cycles.some((c) => c.id === requestedCycleId) ? requestedCycleId : null) ||
    pickCurrentCycle(cadenceCycles, toLocalISODate(), "quarterly")?.id ||
    cycles[0]?.id ||
    null

  if (scopedDepts === null) {
    // Global admin — see all departments
    departments = (allDepartments || []).map((row) => row.name).filter(Boolean)
  } else {
    // Lead or admin in lead mode — scope to managed departments (with aliases)
    departments = scopedDepts.length > 0 ? scopedDepts : []
  }

  const { data: scopedProfiles } =
    departments.length > 0
      ? await supabase
          .from("profiles")
          .select("id, department")
          .in("department", departments)
          .returns<ScopedProfileRow[]>()
      : { data: [] as ScopedProfileRow[] }

  const scopedUsers = scopedProfiles || []
  const scopedUserIds = scopedUsers.map((row) => row.id)

  let goalsQuery = supabase.from("goals_objectives").select("department, approval_status, status, review_cycle_id")

  if (departments.length > 0) {
    goalsQuery = goalsQuery.in("department", departments)
  }
  if (activeCycleId) {
    goalsQuery = goalsQuery.eq("review_cycle_id", activeCycleId)
  }

  const { data: goalRows } = departments.length > 0 ? await goalsQuery.returns<GoalRow[]>() : { data: [] as GoalRow[] }

  const departmentScores: DepartmentScore[] = await Promise.all(
    departments.map((department) => computeDepartmentPerformanceScore(supabase, { department, cycleId: activeCycleId }))
  )

  const goalBreakdown = departments.map((department) => {
    const rows = (goalRows || []).filter((row) => (row.department || "Unassigned") === department)
    return {
      department,
      total: rows.length,
      approved: rows.filter((row) => row.approval_status === "approved").length,
      completed: rows.filter((row) => row.status === "completed").length,
    }
  })

  return {
    departments,
    scopedUserCount: scopedUserIds.length,
    departmentScores,
    goalBreakdown,
    cycles,
    activeCycleId,
    summary: {
      overallPms: average(departmentScores.map((entry) => entry.department_pms)),
      overallKpi: average(departmentScores.map((entry) => entry.department_kpi)),
      attendance: average(departmentScores.map((entry) => entry.breakdown.attendance_compliance_score)),
      cbt: average(departmentScores.map((entry) => entry.breakdown.learning_capability_score)),
      behaviour: average(departmentScores.map((entry) => entry.breakdown.behaviour_leadership_score)),
      approvedGoals: goalBreakdown.reduce((sum, item) => sum + item.approved, 0),
    },
  }
}
