import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { GoalsContent } from "./goals-content"

import { logger } from "@/lib/logger"

const log = logger("dashboard-goals")

export interface Goal {
  id: string
  title: string
  description: string
  target_value: number
  achieved_value: number
  status: string
  priority: string
  due_date: string
  created_at: string
  review_cycle_id?: string | null
  // PMS: approval workflow
  approval_status: "pending" | "approved" | "rejected"
  approved_by?: string | null
  approved_at?: string | null
  department?: string | null
  cycle?: {
    id?: string
    name: string
    review_type?: string | null
    start_date?: string | null
    end_date?: string | null
  } | null
  linked_tasks?: Array<{ id: string; work_item_number?: string | null; title: string; status: string }>
  linked_help_desk?: Array<{ id: string; ticket_number?: string | null; title: string; status: string }>
}

type ReviewCycleRow = {
  id: string
  name: string
  review_type: string | null
  start_date: string | null
  end_date: string | null
}

async function getGoalsData() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("department")
    .eq("id", user.id)
    .maybeSingle<{ department?: string | null }>()

  const { data: cycles } = await supabase
    .from("review_cycles")
    .select("id, name, review_type, start_date, end_date")
    .order("start_date", { ascending: false })
    .returns<ReviewCycleRow[]>()

  const cyclesById = new Map((cycles || []).map((cycle) => [cycle.id, cycle]))

  const { data: goals, error } = profile?.department
    ? await supabase
        .from("goals_objectives")
        .select("*")
        .eq("department", profile.department)
        .order("created_at", { ascending: false })
    : { data: [], error: null }

  if (error) {
    log.error("Error loading goals:", error)
  }

  const goalIds = ((goals || []) as Goal[]).map((goal) => goal.id)

  const [{ data: linkedTasks }, { data: linkedHelpDesk }] = await Promise.all([
    goalIds.length > 0
      ? supabase.from("tasks").select("id, goal_id, work_item_number, title, status").in("goal_id", goalIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string
            goal_id: string
            work_item_number?: string | null
            title: string
            status: string
          }>,
        }),
    goalIds.length > 0
      ? supabase.from("help_desk_tickets").select("id, goal_id, ticket_number, title, status").in("goal_id", goalIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string
            goal_id: string
            ticket_number?: string | null
            title: string
            status: string
          }>,
        }),
  ])

  const tasksByGoalId = new Map<
    string,
    Array<{ id: string; work_item_number?: string | null; title: string; status: string }>
  >()
  for (const task of linkedTasks || []) {
    const rows = tasksByGoalId.get(task.goal_id) || []
    rows.push({ id: task.id, work_item_number: task.work_item_number, title: task.title, status: task.status })
    tasksByGoalId.set(task.goal_id, rows)
  }
  const helpDeskByGoalId = new Map<
    string,
    Array<{ id: string; ticket_number?: string | null; title: string; status: string }>
  >()
  for (const ticket of linkedHelpDesk || []) {
    const rows = helpDeskByGoalId.get(ticket.goal_id) || []
    rows.push({ id: ticket.id, ticket_number: ticket.ticket_number, title: ticket.title, status: ticket.status })
    helpDeskByGoalId.set(ticket.goal_id, rows)
  }

  return {
    goals: ((goals || []) as Goal[]).map((goal) => ({
      ...goal,
      cycle: goal.review_cycle_id ? cyclesById.get(goal.review_cycle_id) || null : null,
      linked_tasks: tasksByGoalId.get(goal.id) || [],
      linked_help_desk: helpDeskByGoalId.get(goal.id) || [],
    })),
    department: profile?.department || null,
    cycles: cycles || [],
  }
}

export default async function GoalsPage() {
  const data = await getGoalsData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const goalsData = data as { goals: Goal[]; department: string | null; cycles: ReviewCycleRow[] }

  return (
    <GoalsContent
      initialGoals={goalsData.goals}
      cycles={goalsData.cycles}
      canCreateGoal={false}
      summaryCards={[
        { label: "Department", value: goalsData.department || "-" },
        { label: "Total Goals", value: goalsData.goals.length },
        {
          label: "Approved Goals",
          value: goalsData.goals.filter((goal) => goal.approval_status === "approved").length,
        },
      ]}
      pageTitle="Department Goals"
      pageDescription={
        goalsData.department
          ? `Goals for ${goalsData.department}. Department leads create goals from the admin PMS side.`
          : "Department leads create goals from the admin PMS side."
      }
      backHref="/pms"
      backLabel="Back to PMS"
    />
  )
}
