import { createClient } from "@/lib/supabase/server"
import { PmsTablePage } from "@/app/admin/hr/pms/_components/pms-table-page"
import { getCurrentUserPmsData } from "../_lib"
import { CycleSelector } from "../_components/cycle-selector"

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-"
}

type GoalCycleRow = {
  id: string
  review_cycle_id: string | null
}

type ReviewCycleRow = {
  id: string
  name: string
}

type GoalTaskRow = {
  id: string
  goal_id: string | null
  title: string | null
  description: string | null
  status: string | null
  due_date: string | null
  assignment_type: string | null
  assigned_to: string | null
  department: string | null
}

type TaskCompletionRow = {
  task_id: string
}

type KpiTableTask = {
  id: string
  title: string
  description: string | null
  status: string
  dueDate: string | null
  assignmentType: string
}

type KpiTableRow = {
  cycle: string
  goal: string
  goal_progress_pct: string
  effective_kpi_pct: string
  linked_tasks: string
  weight: string
  __goalId: string
  __tasks: KpiTableTask[]
}

function toQuarterLabel(dateString?: string | null) {
  if (!dateString) return "Current"
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return "Current"
  const quarter = Math.floor(date.getMonth() / 3) + 1
  return `Q${quarter} ${date.getFullYear()}`
}

export default async function PmsKpiPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle_id?: string }>
}) {
  const { cycle_id } = await searchParams
  const { score, cycles, activeCycleId, goalSummary, profile } = await getCurrentUserPmsData(cycle_id)
  const supabase = await createClient()

  const goalIds = score.breakdown.goals.map((goal) => goal.goal_id).filter((id): id is string => Boolean(id))

  let goalCycleByGoalId = new Map<string, string>()
  const tasksByGoalId = new Map<string, KpiTableTask[]>()

  if (goalIds.length > 0) {
    const [{ data: goalCycleRows }, { data: cycleRows }, { data: taskRows }, { data: completionRows }] =
      await Promise.all([
        supabase.from("goals_objectives").select("id, review_cycle_id").in("id", goalIds).returns<GoalCycleRow[]>(),
        supabase
          .from("review_cycles")
          .select("id, name, start_date")
          .returns<Array<ReviewCycleRow & { start_date: string | null }>>(),
        supabase
          .from("tasks")
          .select("id, goal_id, title, description, status, due_date, assignment_type, assigned_to, department")
          .in("goal_id", goalIds)
          .returns<GoalTaskRow[]>(),
        profile?.id
          ? supabase
              .from("task_user_completion")
              .select("task_id")
              .eq("user_id", profile.id)
              .returns<TaskCompletionRow[]>()
          : Promise.resolve({ data: [] as TaskCompletionRow[] }),
      ])

    const cycleNameById = new Map<string, string>()
    for (const cycle of cycleRows || []) {
      cycleNameById.set(cycle.id, cycle.name || toQuarterLabel(cycle.start_date))
    }

    goalCycleByGoalId = new Map(
      (goalCycleRows || []).map((goalCycle) => [
        goalCycle.id,
        goalCycle.review_cycle_id ? cycleNameById.get(goalCycle.review_cycle_id) || "Current" : "Current",
      ])
    )

    const completedTaskIds = new Set((completionRows || []).map((row) => row.task_id))
    const currentUserId = profile?.id || ""
    const currentUserDepartment = profile?.department || ""

    for (const task of taskRows || []) {
      if (!task.goal_id) continue
      const assignmentType = String(task.assignment_type || "")
      const isIndividualTaskForUser = assignmentType === "individual" && task.assigned_to === currentUserId
      const isDepartmentTaskForUser =
        assignmentType === "department" && Boolean(currentUserDepartment) && task.department === currentUserDepartment
      const hasCompletionByUser = completedTaskIds.has(task.id)

      if (!isIndividualTaskForUser && !isDepartmentTaskForUser && !hasCompletionByUser) {
        continue
      }

      const existing = tasksByGoalId.get(task.goal_id) || []
      existing.push({
        id: task.id,
        title: task.title || "Untitled task",
        description: task.description,
        status: task.status || "pending",
        dueDate: task.due_date,
        assignmentType: assignmentType || "department",
      })
      tasksByGoalId.set(task.goal_id, existing)
    }
  }

  const rows: KpiTableRow[] = score.breakdown.goals.map((goal) => ({
    cycle: goalCycleByGoalId.get(goal.goal_id) || "Current",
    goal: goal.title,
    goal_progress_pct: `${goal.goal_progress_pct}%`,
    effective_kpi_pct: `${goal.effective_kpi_pct}%`,
    linked_tasks: `${goal.linked_tasks_completed}/${goal.linked_tasks_total}`,
    weight: goal.custom_weight_pct !== null ? `${goal.custom_weight_pct}%` : String(goal.priority_weight),
    __goalId: goal.goal_id,
    __tasks: tasksByGoalId.get(goal.goal_id) || [],
  }))

  return (
    <PmsTablePage
      title="PMS KPI"
      description={`KPI score for ${score.cycle_name}: ${formatPercent(score.kpi_score)}. Approved goals: ${goalSummary.approved}. Completed goals: ${goalSummary.completed}.`}
      backHref="/pms"
      backLabel="Back to PMS"
      icon="kpi"
      cycles={cycles}
      activeCycleId={activeCycleId}
      summaryCards={[
        { label: "KPI Score", value: formatPercent(score.kpi_score) },
        { label: "Approved Goals", value: goalSummary.approved },
        { label: "Completed Goals", value: goalSummary.completed },
      ]}
      tableTitle="KPI Goal Breakdown"
      tableDescription={`Approved department goals contributing to your KPI score in ${score.cycle_name}.`}
      rows={rows}
      columns={[
        { key: "cycle", label: "Cycle" },
        { key: "goal", label: "Goal" },
        { key: "goal_progress_pct", label: "Goal Progress" },
        { key: "effective_kpi_pct", label: "Effective KPI" },
        { key: "linked_tasks", label: "Linked Tasks" },
        { key: "weight", label: "Weight" },
      ]}
      searchPlaceholder="Search goal or KPI row..."
      filterKey="cycle"
      filterLabel="Cycle"
      filterAllLabel="All Cycles"
    />
  )
}
