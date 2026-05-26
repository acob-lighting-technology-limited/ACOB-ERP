import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { computeIndividualPerformanceScore } from "@/lib/performance/scoring"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"

const log = logger("hr-performance-metric-snapshot")

const SnapshotQuerySchema = z.object({
  metric: z.enum(["kpi", "goals", "attendance", "behaviour"]),
  cycle_id: z.string().trim().optional().nullable(),
  view: z.enum(["individual", "department", "cycle"]).optional().default("individual"),
})

type DepartmentRow = {
  name: string
}

type ScopedUserRow = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type ReviewCycleRow = {
  id: string
  name: string
  review_type: string | null
  start_date: string | null
  end_date: string | null
}

type GoalRow = {
  user_id: string
  department?: string | null
  review_cycle_id: string | null
  approval_status: string | null
  status: string | null
}

type ReviewMetricRow = {
  user_id: string
  kpi_score?: number | null
  attendance_score?: number | null
  behaviour_score?: number | null
  created_at: string
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function hasMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function averageDefined(values: number[]) {
  if (values.length === 0) return null
  return round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function fullName(user: ScopedUserRow) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed employee"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const parsed = SnapshotQuerySchema.safeParse({
      metric: request.nextUrl.searchParams.get("metric"),
      cycle_id: request.nextUrl.searchParams.get("cycle_id"),
      view: request.nextUrl.searchParams.get("view") || "individual",
    })

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 })
    }

    // Resolve scope from middleware header (single source of truth)
    const scope = await getRequestScope()
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const scopedDepts = getScopedDepartments(scope)
    let departments: string[]

    if (scopedDepts === null) {
      const { data: departmentRows } = await supabase
        .from("departments")
        .select("name")
        .order("name", { ascending: true })
        .returns<DepartmentRow[]>()
      departments = (departmentRows || []).map((row) => row.name).filter(Boolean)
    } else {
      departments = scopedDepts.length > 0 ? scopedDepts : []
    }

    const { data: users } =
      departments.length > 0
        ? await supabase
            .from("profiles")
            .select("id, first_name, last_name, department")
            .in("department", departments)
            .order("first_name", { ascending: true })
            .returns<ScopedUserRow[]>()
        : { data: [] as ScopedUserRow[] }

    const { data: cycles } = await supabase
      .from("review_cycles")
      .select("id, name, review_type, start_date, end_date")
      .order("start_date", { ascending: false })
      .returns<ReviewCycleRow[]>()

    const context = { departments, users: users || [], cycles: cycles || [] }

    const metric = parsed.data.metric
    const selectedCycleId = parsed.data.cycle_id || context.cycles[0]?.id || null

    const selectedCycle = context.cycles.find((cycle) => cycle.id === selectedCycleId) || null
    const userIds = context.users.map((entry) => entry.id)
    const usersById = new Map(context.users.map((entry) => [entry.id, entry]))

    let individualRows: Record<string, unknown>[] = []
    let departmentRows: Record<string, unknown>[] = []
    let cycleRows: Record<string, unknown>[] = []

    if (metric === "goals") {
      const { data: goals } =
        userIds.length > 0
          ? await supabase
              .from("goals_objectives")
              .select("user_id, department, review_cycle_id, approval_status, status")
              .in("department", context.departments)
              .returns<GoalRow[]>()
          : { data: [] as GoalRow[] }

      const goalsForSelectedCycle = selectedCycleId
        ? (goals || []).filter((row) => row.review_cycle_id === selectedCycleId)
        : goals || []

      const goalsIndividualRows = context.users.map((entry) => {
        const rows = goalsForSelectedCycle.filter(
          (goal) => (goal.department || "Unassigned") === (entry.department || "Unassigned")
        )
        return {
          user_id: entry.id,
          employee: fullName(entry),
          department: entry.department || "Unassigned",
          cycle: selectedCycle?.name || "Current",
          total_goals: rows.length,
          approved_goals: rows.filter((row) => row.approval_status === "approved").length,
          completed_goals: rows.filter((row) => row.status === "completed").length,
        }
      })
      individualRows = goalsIndividualRows.filter((row) => Number(row.total_goals || 0) > 0)

      const goalsByDepartment = new Map<string, GoalRow[]>()
      for (const goal of goalsForSelectedCycle) {
        const department = goal.department || usersById.get(goal.user_id)?.department || "Unassigned"
        const existing = goalsByDepartment.get(department) || []
        existing.push(goal)
        goalsByDepartment.set(department, existing)
      }

      departmentRows = context.departments
        .map((department) => {
          const rows = goalsByDepartment.get(department) || []
          return {
            department,
            cycle: selectedCycle?.name || "Current",
            total_goals: rows.length,
            approved_goals: rows.filter((row) => row.approval_status === "approved").length,
            completed_goals: rows.filter((row) => row.status === "completed").length,
          }
        })
        .filter((row) => Number(row.total_goals || 0) > 0)

      const cycle = selectedCycle
      const rows = cycle ? (goals || []).filter((goal) => goal.review_cycle_id === cycle.id) : []
      cycleRows =
        cycle && rows.length > 0
          ? [
              {
                cycle_id: cycle.id,
                cycle: cycle.name,
                review_type: cycle.review_type || "-",
                total_goals: rows.length,
                approved_goals: rows.filter((row) => row.approval_status === "approved").length,
                completed_goals: rows.filter((row) => row.status === "completed").length,
              },
            ]
          : []
    } else {
      const candidateUserIds =
        selectedCycleId && context.users.length > 0
          ? await (async () => {
              if (metric === "kpi") {
                const { data: goalRows } = await supabase
                  .from("goals_objectives")
                  .select("department")
                  .eq("review_cycle_id", selectedCycleId)
                  .eq("approval_status", "approved")
                  .in("department", context.departments)
                const { data: reviewRows } = await supabase
                  .from("performance_reviews")
                  .select("user_id")
                  .eq("review_cycle_id", selectedCycleId)
                  .not("kpi_score", "is", null)
                  .in(
                    "user_id",
                    context.users.map((entry) => entry.id)
                  )
                return context.users
                  .filter(
                    (entry) =>
                      (goalRows || []).some(
                        (row) => (row.department || "Unassigned") === (entry.department || "Unassigned")
                      ) || (reviewRows || []).some((row) => row.user_id === entry.id)
                  )
                  .map((entry) => entry.id)
              }
              if (metric === "attendance") {
                return context.users.map((entry) => entry.id)
              }
              if (metric === "behaviour") {
                const { data: reviewRows } = await supabase
                  .from("performance_reviews")
                  .select("user_id")
                  .eq("review_cycle_id", selectedCycleId)
                  .not("behaviour_score", "is", null)
                  .in(
                    "user_id",
                    context.users.map((entry) => entry.id)
                  )
                return Array.from(new Set((reviewRows || []).map((row) => row.user_id)))
              }
              return []
            })()
          : []

      const candidateUsers = context.users.filter((entry) => candidateUserIds.includes(entry.id))

      const { data: reviewMetricRows } =
        selectedCycleId && candidateUsers.length > 0
          ? await supabase
              .from("performance_reviews")
              .select("user_id, kpi_score, attendance_score, behaviour_score, created_at")
              .eq("review_cycle_id", selectedCycleId)
              .in(
                "user_id",
                candidateUsers.map((entry) => entry.id)
              )
              .order("created_at", { ascending: false })
              .returns<ReviewMetricRow[]>()
          : { data: [] as ReviewMetricRow[] }

      const latestReviewMetricByUser = new Map<string, ReviewMetricRow>()
      for (const row of reviewMetricRows || []) {
        const rawValue =
          metric === "kpi" ? row.kpi_score : metric === "attendance" ? row.attendance_score : row.behaviour_score
        if (typeof rawValue === "number" && rawValue > 0 && !latestReviewMetricByUser.has(row.user_id)) {
          latestReviewMetricByUser.set(row.user_id, row)
        }
      }

      const individualScores =
        selectedCycleId && candidateUsers.length > 0
          ? await Promise.all(
              candidateUsers.map(async (entry) => ({
                user: entry,
                score: await computeIndividualPerformanceScore(supabase, {
                  userId: entry.id,
                  cycleId: selectedCycleId,
                }),
              }))
            )
          : []

      individualRows = individualScores
        .map(({ user: entry, score }) => {
          const latestReviewMetric = latestReviewMetricByUser.get(entry.id)
          const submittedMetricValue =
            metric === "kpi"
              ? (latestReviewMetric?.kpi_score ?? null)
              : metric === "attendance"
                ? score.breakdown.attendance.score
                : (latestReviewMetric?.behaviour_score ?? null)
          return {
            user_id: entry.id,
            employee: fullName(entry),
            department: entry.department || "Unassigned",
            cycle: selectedCycle?.name || "Current",
            metric_value:
              typeof submittedMetricValue === "number" && submittedMetricValue > 0 ? submittedMetricValue : null,
            kpi_score:
              typeof latestReviewMetric?.kpi_score === "number" && latestReviewMetric.kpi_score > 0
                ? latestReviewMetric.kpi_score
                : null,
            attendance_score: score.breakdown.attendance.score,
            behaviour_score:
              typeof latestReviewMetric?.behaviour_score === "number" && latestReviewMetric.behaviour_score > 0
                ? latestReviewMetric.behaviour_score
                : null,
            _goal_count: score.breakdown.goals.length,
            _attendance_total: score.breakdown.attendance.total,
          }
        })
        .filter((row) => {
          if (metric === "kpi") return hasMetric(row.kpi_score) || Number(row._goal_count || 0) > 0
          if (metric === "attendance") return true
          return hasMetric(row.behaviour_score)
        })
        .map(({ _goal_count, _attendance_total, ...row }) => row)

      const employeeCountByDepartment = context.users.reduce((map, row) => {
        const department = String(row.department || "Unassigned")
        map.set(department, (map.get(department) || 0) + 1)
        return map
      }, new Map<string, number>())

      const submittedCountByDepartment = individualRows.reduce((map, row) => {
        const department = String(row.department || "Unassigned")
        if (hasMetric(row.metric_value)) {
          map.set(department, (map.get(department) || 0) + 1)
        }
        return map
      }, new Map<string, number>())

      departmentRows = context.departments
        .map((department) => {
          const submittedRows = individualRows.filter(
            (row) => String(row.department || "Unassigned") === department && hasMetric(row.metric_value)
          )
          return {
            department,
            cycle: selectedCycle?.name || "Current",
            employee_count: employeeCountByDepartment.get(department) || 0,
            submitted_count: submittedCountByDepartment.get(department) || 0,
            metric_value: averageDefined(submittedRows.map((row) => row.metric_value as number)),
          }
        })
        .filter((row) => Number(row.employee_count || 0) > 0)

      if (selectedCycle) {
        const submittedMetricValues = individualRows
          .map((row) => row.metric_value)
          .filter((value): value is number => hasMetric(value))

        const departmentsWithSubmissions = departmentRows.filter((row) => Number(row.submitted_count || 0) > 0)

        cycleRows = [
          {
            cycle_id: selectedCycle.id,
            cycle: selectedCycle.name,
            review_type: selectedCycle.review_type || "-",
            employee_count: candidateUsers.length,
            submitted_count: submittedMetricValues.length,
            departments_counted: departmentsWithSubmissions.length,
            metric_value: averageDefined(submittedMetricValues),
          },
        ]
      }
    }

    return NextResponse.json({
      data: {
        metric,
        selected_cycle_id: selectedCycleId,
        users: context.users.map((entry) => ({
          id: entry.id,
          name: fullName(entry),
          department: entry.department || "Unassigned",
        })),
        departments: context.departments,
        cycles: context.cycles,
        rows: {
          individual: individualRows,
          department: departmentRows,
          cycle: cycleRows,
        },
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/metric-snapshot")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
