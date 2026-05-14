import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("tasks-complete-route")

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`tasks-complete:${getClientId(request)}`, { limit: 30, windowSec: 60 })
    if (!rl.allowed) {
      return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const { data: assignment } = await supabase
      .from("task_assignments")
      .select("task_id, user_id")
      .eq("task_id", params.id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!assignment) {
      return apiError("Only assigned users can complete this task", ApiErrorCode.FORBIDDEN, 403)
    }

    const { data: existingCompletion } = await supabase
      .from("task_user_completion")
      .select("task_id")
      .eq("task_id", params.id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (existingCompletion) {
      return apiError("Task completion already recorded", ApiErrorCode.CONFLICT, 409)
    }

    const { error: insertError } = await supabase.from("task_user_completion").insert({
      task_id: params.id,
      user_id: user.id,
    })

    if (insertError) {
      return apiError(insertError.message, ApiErrorCode.DATABASE_ERROR, 500)
    }

    const [{ count: assignmentCount }, { count: completionCount }] = await Promise.all([
      supabase.from("task_assignments").select("*", { head: true, count: "exact" }).eq("task_id", params.id),
      supabase.from("task_user_completion").select("*", { head: true, count: "exact" }).eq("task_id", params.id),
    ])

    const allDone = Boolean(assignmentCount && completionCount && assignmentCount === completionCount)
    if (allDone) {
      await supabase
        .from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", params.id)
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.user_complete",
        entityType: "task",
        entityId: params.id,
        newValues: { user_id: user.id, all_done: allDone },
        context: { actorId: user.id, source: "api", route: "/api/tasks/[id]/complete" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ completed: true, allDone })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task complete POST")
    return apiError("Failed to record completion", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
