import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"

const log = logger("tasks-status-route")

const StatusBodySchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  comment: z.string().trim().max(5000).optional(),
})

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["completed", "pending", "cancelled"],
  completed: [],
  cancelled: ["pending"],
}

type TaskRecord = {
  id: string
  status: string
  goal_id?: string | null
  assignment_type?: string | null
  assigned_to?: string | null
  assigned_by?: string | null
  department?: string | null
  started_at?: string | null
  completed_at?: string | null
  work_item_number?: string | null
}

type ProfileRecord = {
  id: string
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

function isAdminProfile(scope: AdminScope | null) {
  return scope?.isAdminLike === true && scope.scopeMode !== "lead"
}

function isLeadForTask(profile: ProfileRecord | null, taskDepartment: string | null | undefined) {
  if (!profile?.is_department_lead || !taskDepartment) return false
  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  return profile.department === taskDepartment || leadDepartments.includes(taskDepartment)
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`tasks-status:${getClientId(request)}`, { limit: 30, windowSec: 60 })
    if (!rl.allowed) {
      return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const sizeError = checkRequestSize(request)
    if (sizeError) return sizeError

    const parsed = StatusBodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Validation failed",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
    }

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select(
        "id, status, goal_id, assignment_type, assigned_to, assigned_by, department, started_at, completed_at, work_item_number"
      )
      .eq("id", params.id)
      .single<TaskRecord>()

    if (taskError || !task) {
      return apiError("Task not found", ApiErrorCode.NOT_FOUND, 404)
    }

    const [{ data: profile }, { data: assignments }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ProfileRecord>(),
      supabase.from("task_assignments").select("user_id").eq("task_id", task.id).eq("user_id", user.id).limit(1),
    ])

    const taskScope = await getRequestScope()
    const isAdmin = isAdminProfile(taskScope)
    const hasAssignment = Boolean(assignments && assignments.length > 0)
    const canAccess =
      task.assigned_to === user.id ||
      task.assigned_by === user.id ||
      hasAssignment ||
      isAdmin ||
      isLeadForTask(profile ?? null, task.department)

    if (!canAccess) {
      return apiError("Forbidden", ApiErrorCode.FORBIDDEN, 403)
    }

    if (!task.goal_id) {
      return apiError("Task must be linked to a goal before it can be updated", ApiErrorCode.INVALID_STATE, 400)
    }

    // Policy: department tasks are updated by department leads only.
    if (task.assignment_type === "department" && !isLeadForTask(profile ?? null, task.department)) {
      return apiError("Only department leads can update department tasks", ApiErrorCode.FORBIDDEN, 403)
    }

    const oldStatus = task.status
    const nextStatus = parsed.data.status
    if (oldStatus === nextStatus) {
      return NextResponse.json({ success: true, task })
    }

    if (!isAdmin) {
      const allowed = VALID_TRANSITIONS[oldStatus] || []
      if (!allowed.includes(nextStatus)) {
        return apiError(`Cannot transition from ${oldStatus} to ${nextStatus}`, ApiErrorCode.INVALID_STATE, 400)
      }
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_at: now,
    }

    if (nextStatus === "completed") updatePayload.completed_at = now
    if (nextStatus === "in_progress" && oldStatus === "pending" && !task.started_at) updatePayload.started_at = now

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", task.id)
      .select("*")
      .single()

    if (updateError || !updatedTask) {
      return apiError(updateError?.message || "Failed to update task", ApiErrorCode.DATABASE_ERROR, 500)
    }

    if (parsed.data.comment) {
      await supabase.from("task_updates").insert({
        task_id: task.id,
        user_id: user.id,
        update_type: "status_change",
        content: parsed.data.comment,
        old_value: oldStatus,
        new_value: nextStatus,
      })
    }

    if (nextStatus === "completed" && task.assigned_by && task.assigned_by !== user.id) {
      await supabase.rpc("create_notification", {
        p_user_id: task.assigned_by,
        p_type: "task_completed",
        p_category: "tasks",
        p_title: "Task completed",
        p_message: `${task.work_item_number || "Task"} is now completed`,
        p_priority: "normal",
        p_link_url: "/tasks/management",
        p_actor_id: user.id,
        p_entity_type: "task",
        p_entity_id: task.id,
        p_rich_content: { status: nextStatus, work_item_number: task.work_item_number },
      })
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.status_update",
        entityType: "task",
        entityId: task.id,
        oldValues: { status: oldStatus },
        newValues: { status: nextStatus },
        context: { actorId: user.id, source: "api", route: "/api/tasks/[id]/status" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true, task: updatedTask })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task status PATCH")
    return apiError("Failed to update task status", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
