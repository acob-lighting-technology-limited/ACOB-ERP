import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("cron-tasks-expire-overdue")

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

type OverdueTaskRow = {
  id: string
  title: string | null
  assigned_to: string | null
  assigned_by: string | null
  due_date: string | null
  task_end_date: string | null
}

/** Statuses that are still open work, and so can run out of time. */
const OPEN_STATUSES = ["pending", "in_progress", "unable_to_complete"]

/**
 * Closes out tasks whose deadline has passed.
 *
 * An overdue task already scores zero — it sits at full weight with no rating,
 * which is what the KPI calculation wants. What was missing is anyone being
 * told: without this, a task whose deadline passed stayed "pending" forever
 * unless a lead happened to notice and fail it by hand, so the employee's score
 * quietly dropped and nobody saw why.
 *
 * Work already submitted for review is deliberately left alone: the employee
 * delivered it, and a slow rater must not turn that into a failure.
 *
 * Idempotent — a run with nothing overdue changes nothing.
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const today = toLocalISODate()

    // The deadline is task_end_date where set, otherwise due_date — the same
    // anchor the KPI calculation uses to decide which cycle a task belongs to.
    const { data: candidates, error: loadError } = await supabase
      .from("tasks")
      .select("id, title, assigned_to, assigned_by, due_date, task_end_date")
      .in("status", OPEN_STATUSES)
      .eq("is_archived", false)
      .returns<OverdueTaskRow[]>()

    if (loadError) throw loadError

    const overdue = (candidates || []).filter((task) => {
      const deadline = task.task_end_date || task.due_date
      return Boolean(deadline) && String(deadline).slice(0, 10) < today
    })

    if (overdue.length === 0) {
      log.info({ expired: 0 }, "No overdue tasks to expire")
      return NextResponse.json({ data: { expired: 0 } })
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "failed",
        failure_reason: "Deadline passed without completion (recorded automatically)",
        updated_at: now,
      })
      .in(
        "id",
        overdue.map((task) => task.id)
      )

    if (updateError) throw updateError

    // Tell the assignee and whoever set the task. A notification failure must
    // not undo the expiry that already succeeded, so each one is isolated.
    let notified = 0
    for (const task of overdue) {
      const recipients = new Set([task.assigned_to, task.assigned_by].filter(Boolean) as string[])
      for (const userId of recipients) {
        try {
          await supabase.rpc("create_notification", {
            p_user_id: userId,
            p_type: "task_updated",
            p_category: "tasks",
            p_title: "Task expired",
            p_message: `"${task.title || "Untitled task"}" passed its deadline without completion and has been marked as failed.`,
            p_priority: "high",
            p_link_url: "/tasks",
            p_actor_id: null,
            p_entity_type: "task",
            p_entity_id: task.id,
            p_rich_content: null,
          })
          notified++
        } catch (notifyError) {
          log.error({ err: String(notifyError), taskId: task.id, userId }, "Failed to notify on task expiry")
        }
      }
    }

    log.info({ expired: overdue.length, notified }, "Overdue tasks expired")

    return NextResponse.json({ data: { expired: overdue.length, notified } })
  } catch (error) {
    log.error({ err: String(error) }, "Overdue task expiry failed")
    return NextResponse.json({ error: "Failed to expire overdue tasks" }, { status: 500 })
  }
}
