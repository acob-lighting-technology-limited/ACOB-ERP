import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import {
  canAssignTasks,
  canAssignToDepartment,
  canAssignToProfile,
  type TaskAssignmentAuthorityProfile,
  type TaskAssignmentTargetProfile,
} from "@/lib/tasks/assignment-scope"
import { TASK_STATUSES, TASK_ASSIGNMENT_TYPES } from "@/lib/tasks/constants"

const log = logger("task-detail-route")

const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  priority: z.string().trim().min(1).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  due_date: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  assignment_type: z.enum(TASK_ASSIGNMENT_TYPES).optional(),
  assigned_to: z.string().uuid().optional().nullable(),
  goal_id: z.string().uuid().optional().nullable(),
  task_start_date: z.string().optional().nullable(),
  task_end_date: z.string().optional().nullable(),
})

async function assertManagerAccess(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, department, is_department_lead, lead_departments")
    .eq("id", userId)
    .single<TaskAssignmentAuthorityProfile>()

  return profile && canAssignTasks(profile) ? profile : null
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`tasks-update:${getClientId(request)}`, { limit: 30, windowSec: 60 })
    if (!rl.allowed) {
      return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)
    const assignerProfile = await assertManagerAccess(supabase, user.id)
    if (!assignerProfile) {
      return apiError("Forbidden", ApiErrorCode.FORBIDDEN, 403)
    }

    const sizeError = checkRequestSize(request)
    if (sizeError) return sizeError

    const parsed = UpdateTaskSchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Validation failed",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
    }

    const payload = parsed.data
    const { data: existingTask } = await supabase
      .from("tasks")
      .select("id, title, department, assignment_type, assigned_to, source_type, goal_id")
      .eq("id", params.id)
      .single<{
        id: string
        title?: string | null
        department?: string | null
        assignment_type?: string | null
        assigned_to?: string | null
        source_type?: "manual" | "help_desk" | null
        goal_id?: string | null
      }>()

    if (!existingTask) {
      return apiError("Task not found", ApiErrorCode.NOT_FOUND, 404)
    }

    const finalAssignmentType = payload.assignment_type || existingTask.assignment_type || "individual"
    const finalAssignedTo =
      finalAssignmentType === "individual" ? (payload.assigned_to ?? existingTask.assigned_to ?? null) : null
    let finalDepartment = payload.department ?? existingTask.department ?? null

    const assignmentFieldsTouched =
      payload.assignment_type !== undefined || payload.assigned_to !== undefined || payload.department !== undefined

    if (assignmentFieldsTouched && finalAssignmentType === "individual") {
      if (!finalAssignedTo) {
        return apiError("Assignee is required for individual tasks", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
      }

      const { data: assignee } = await supabase
        .from("profiles")
        .select("id, department")
        .eq("id", finalAssignedTo)
        .single<TaskAssignmentTargetProfile>()

      if (!assignee) {
        return apiError("Selected assignee was not found", ApiErrorCode.NOT_FOUND, 400)
      }

      if (!canAssignToProfile(assignerProfile, assignee)) {
        return apiError("You can only assign tasks within your approved scope", ApiErrorCode.FORBIDDEN, 403)
      }

      finalDepartment = assignee.department || finalDepartment
    }

    if (assignmentFieldsTouched && finalAssignmentType === "department") {
      if (!finalDepartment) {
        return apiError("Department is required for department tasks", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
      }
      if (!canAssignToDepartment(assignerProfile, finalDepartment)) {
        return apiError("You can only assign tasks within your approved scope", ApiErrorCode.FORBIDDEN, 403)
      }
    }

    const updatePayload: Record<string, unknown> = { ...payload, updated_at: new Date().toISOString() }
    if ((payload.assignment_type || "").length > 0) {
      updatePayload.assigned_to = payload.assignment_type === "individual" ? payload.assigned_to || null : null
    }
    if (assignmentFieldsTouched) {
      updatePayload.department = finalDepartment
    }

    if (payload.goal_id !== undefined) {
      updatePayload.goal_id = payload.goal_id
    }

    const { data: updatedTask, error } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", params.id)
      .select("*")
      .single()

    if (error || !updatedTask) {
      return apiError(error?.message || "Failed to update task", ApiErrorCode.DATABASE_ERROR, 500)
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.update",
        entityType: "task",
        entityId: params.id,
        newValues: payload,
        context: { actorId: user.id, source: "api", route: "/api/tasks/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updatedTask })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task PATCH")
    return apiError("Failed to update task", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`tasks-delete:${getClientId(request)}`, { limit: 30, windowSec: 60 })
    if (!rl.allowed) {
      return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)
    if (!(await assertManagerAccess(supabase, user.id))) {
      return apiError("Forbidden", ApiErrorCode.FORBIDDEN, 403)
    }

    const { data: existingTask } = await supabase.from("tasks").select("id, title, status").eq("id", params.id).single()

    const { error } = await supabase.from("tasks").delete().eq("id", params.id)
    if (error) return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 500)

    await writeAuditLog(
      supabase,
      {
        action: "task.delete",
        entityType: "task",
        entityId: params.id,
        oldValues: existingTask || null,
        context: { actorId: user.id, source: "api", route: "/api/tasks/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task DELETE")
    return apiError("Failed to delete task", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
