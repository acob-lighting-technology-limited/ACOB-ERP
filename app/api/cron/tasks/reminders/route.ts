import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"
import { computeProjectHealth, type ProjectHealthTask } from "@/lib/projects/health"

const log = logger("cron-tasks-reminders")

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Deadline reminders start this many days out. */
const DUE_SOON_DAYS = 3
/** Submitted work is chased once it has waited this long for a rating. */
const RATING_NUDGE_DAYS = 2
/** Nobody is told the same thing twice inside these windows. */
const TASK_REMINDER_COOLDOWN_HOURS = 48
const PROJECT_REMINDER_COOLDOWN_HOURS = 168 // weekly

type TaskRow = {
  id: string
  title: string | null
  status: string
  assigned_to: string | null
  assigned_by: string | null
  due_date: string | null
  task_end_date: string | null
  updated_at: string | null
  project_id: string | null
}

type ProjectRow = {
  id: string
  project_name: string
  project_manager_id: string | null
  deployment_start_date: string | null
  deployment_end_date: string | null
  status: string | null
  tasks: ProjectHealthTask[] | null
}

/** The service-role client this route builds, typed from the factory itself so
 *  the helpers below share its exact instantiation. */
function serviceClient(url: string, key: string) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

type Supabase = ReturnType<typeof serviceClient>

function daysUntil(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000)
}

/**
 * Project-manager reminders: deadlines approaching, submitted work waiting on
 * a decision, approved work still unrated, and projects slipping behind.
 *
 * Every send is guarded by a cooldown lookup against the notifications already
 * on record, so a daily job does not become a daily nagging — a reminder people
 * learn to ignore is worse than none.
 *
 * Overdue tasks are handled by the separate expire-overdue job, which fails
 * them outright; this one only ever looks forward.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`
  if (!safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 })
  }

  const supabase = serviceClient(supabaseUrl, supabaseServiceKey)

  const today = toLocalISODate()

  try {
    const [dueSoon, needsRating, delayed] = await Promise.all([
      sendDueSoonReminders(supabase, today),
      sendRatingReminders(supabase, today),
      sendProjectDelayReminders(supabase, today),
    ])

    log.info({ dueSoon, needsRating, delayed }, "Task reminders sent")
    return NextResponse.json({ data: { dueSoon, needsRating, delayed } })
  } catch (error) {
    log.error({ err: String(error) }, "Task reminders failed")
    return NextResponse.json({ error: "Failed to send task reminders" }, { status: 500 })
  }
}

/** Has this person already been told about this entity inside the cooldown? */
async function recentlyNotified(
  supabase: Supabase,
  userId: string,
  entityId: string,
  type: string,
  cooldownHours: number
): Promise<boolean> {
  const since = new Date(Date.now() - cooldownHours * 3_600_000).toISOString()
  const { count } = await supabase
    .from("notifications")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("entity_id", entityId)
    .eq("type", type)
    .gte("created_at", since)
  return Boolean(count && count > 0)
}

async function notify(
  supabase: Supabase,
  params: {
    userId: string
    type: string
    title: string
    message: string
    entityType: string
    entityId: string
    linkUrl: string
    priority?: string
  }
): Promise<boolean> {
  try {
    await supabase.rpc("create_notification", {
      p_user_id: params.userId,
      p_type: params.type,
      p_category: "tasks",
      p_title: params.title,
      p_message: params.message,
      p_priority: params.priority ?? "normal",
      p_link_url: params.linkUrl,
      p_actor_id: null,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_rich_content: null,
    })
    return true
  } catch (error) {
    log.error({ err: String(error), entityId: params.entityId }, "Reminder notification failed")
    return false
  }
}

/** Open work whose deadline lands within the next few days. */
async function sendDueSoonReminders(supabase: Supabase, today: string): Promise<number> {
  const horizon = toLocalISODate(new Date(Date.parse(`${today}T00:00:00`) + DUE_SOON_DAYS * 86_400_000))

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, assigned_to, assigned_by, due_date, task_end_date, updated_at, project_id")
    .in("status", ["pending", "in_progress"])
    .eq("is_archived", false)
    .returns<TaskRow[]>()

  let sent = 0
  for (const task of tasks || []) {
    const deadline = (task.task_end_date || task.due_date)?.slice(0, 10)
    if (!deadline || deadline < today || deadline > horizon) continue
    if (!task.assigned_to) continue

    if (await recentlyNotified(supabase, task.assigned_to, task.id, "task_due_soon", TASK_REMINDER_COOLDOWN_HOURS)) {
      continue
    }

    const remaining = daysUntil(today, deadline)
    const when = remaining <= 0 ? "today" : remaining === 1 ? "tomorrow" : `in ${remaining} days`
    const ok = await notify(supabase, {
      userId: task.assigned_to,
      type: "task_due_soon",
      title: "Task deadline approaching",
      message: `"${task.title || "Untitled task"}" is due ${when} (${deadline}).`,
      entityType: "task",
      entityId: task.id,
      linkUrl: "/tasks",
      priority: remaining <= 1 ? "high" : "normal",
    })
    if (ok) sent++
  }

  return sent
}

/**
 * Work the employee has already delivered but nobody has rated.
 *
 * This one matters beyond tidiness: an unrated submission is held out of the
 * employee's KPI entirely, so a rater who never acts leaves real work uncounted.
 */
async function sendRatingReminders(supabase: Supabase, today: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATING_NUDGE_DAYS * 86_400_000).toISOString()

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, assigned_to, assigned_by, due_date, task_end_date, updated_at, project_id")
    .eq("status", "submitted_for_review")
    .eq("is_archived", false)
    .lte("updated_at", cutoff)
    .returns<TaskRow[]>()

  if (!tasks || tasks.length === 0) return 0

  // One lookup for every project involved, rather than one per task.
  const projectIds = Array.from(new Set(tasks.map((task) => task.project_id).filter(Boolean) as string[]))
  const managerByProject = new Map<string, string | null>()
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, project_manager_id")
      .in("id", projectIds)
      .returns<Array<{ id: string; project_manager_id: string | null }>>()
    for (const project of projects || []) managerByProject.set(project.id, project.project_manager_id)
  }

  let sent = 0
  for (const task of tasks) {
    const raterId = (task.project_id ? managerByProject.get(task.project_id) : null) || task.assigned_by
    if (!raterId) continue

    if (await recentlyNotified(supabase, raterId, task.id, "task_needs_rating", TASK_REMINDER_COOLDOWN_HOURS)) {
      continue
    }

    const waitingDays = task.updated_at
      ? Math.max(1, daysUntil(String(task.updated_at).slice(0, 10), today))
      : RATING_NUDGE_DAYS

    const ok = await notify(supabase, {
      userId: raterId,
      type: "task_needs_rating",
      title: "Task still waiting to be rated",
      message: `"${task.title || "Untitled task"}" has been awaiting your rating for ${waitingDays} day${waitingDays === 1 ? "" : "s"}. It is held out of the assignee's KPI until you rate it.`,
      entityType: "task",
      entityId: task.id,
      linkUrl: "/admin/tasks",
      priority: "high",
    })
    if (ok) sent++
  }

  return sent
}

/** Projects whose weighted delivery has fallen behind their own schedule. */
async function sendProjectDelayReminders(supabase: Supabase, today: string): Promise<number> {
  const { data: projects } = await supabase
    .from("projects")
    .select(
      `id, project_name, project_manager_id, deployment_start_date, deployment_end_date, status,
       tasks:tasks(id, status, weight, rating, is_archived, due_date, task_end_date)`
    )
    .in("status", ["planning", "active"])
    .returns<ProjectRow[]>()

  let sent = 0
  for (const project of projects || []) {
    if (!project.project_manager_id) continue

    const health = computeProjectHealth({
      startDate: project.deployment_start_date,
      endDate: project.deployment_end_date,
      tasks: project.tasks || [],
      today,
    })

    if (health.status !== "behind_schedule") continue

    if (
      await recentlyNotified(
        supabase,
        project.project_manager_id,
        project.id,
        "project_delayed",
        PROJECT_REMINDER_COOLDOWN_HOURS
      )
    ) {
      continue
    }

    const ok = await notify(supabase, {
      userId: project.project_manager_id,
      type: "project_delayed",
      title: "Project behind schedule",
      message: `"${project.project_name}" is ${health.deliveryPct ?? 0}% delivered with ${health.timeElapsedPct ?? 0}% of its schedule elapsed${health.overdueCount > 0 ? `, and has ${health.overdueCount} overdue task${health.overdueCount === 1 ? "" : "s"}` : ""}.`,
      entityType: "project",
      entityId: project.id,
      linkUrl: "/admin/project",
      priority: "high",
    })
    if (ok) sent++
  }

  return sent
}
