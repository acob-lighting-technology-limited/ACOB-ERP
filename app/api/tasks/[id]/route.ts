import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"
import { canAssignToDepartment, canAssignToProfile } from "@/lib/tasks/assignment-scope"
import { TASK_WEIGHT_MAX, TASK_WEIGHT_MIN } from "@/lib/tasks/scoring"
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
  project_id: z.string().uuid().optional().nullable(),
  plan_id: z.string().uuid().optional().nullable(),
  weight: z.number().int().min(TASK_WEIGHT_MIN).max(TASK_WEIGHT_MAX).optional(),
  task_start_date: z.string().optional().nullable(),
  task_end_date: z.string().optional().nullable(),
  extension_reason: z.string().trim().max(5000).optional().nullable(),
  is_archived: z.boolean().optional(),
})

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

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const { data: task, error } = await supabase.from("tasks").select("*").eq("id", params.id).single()

    if (error || !task) {
      return apiError("Task not found", ApiErrorCode.NOT_FOUND, 404)
    }

    return NextResponse.json({ data: task })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task GET")
    return apiError("Failed to fetch task", ApiErrorCode.INTERNAL_ERROR, 500)
  }
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<ProfileRecord>()

    const scope = await getRequestScope()
    const isAdmin = isAdminProfile(scope)
    const isLead = Boolean(profile?.is_department_lead)

    if (!isAdmin && !isLead) {
      return apiError("Forbidden: Only department leads or administrators can edit tasks", ApiErrorCode.FORBIDDEN, 403)
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
      .select("id, title, department, assignment_type, assigned_to, source_type, goal_id, due_date")
      .eq("id", params.id)
      .single()

    if (!existingTask) {
      return apiError("Task not found", ApiErrorCode.NOT_FOUND, 404)
    }

    const finalAssignmentType = payload.assignment_type || existingTask.assignment_type || "individual"
    const finalAssignedTo =
      finalAssignmentType === "individual" ? (payload.assigned_to ?? existingTask.assigned_to ?? null) : null
    let finalDepartment = payload.department ?? existingTask.department ?? null

    const assignmentFieldsTouched =
      payload.assignment_type !== undefined || payload.assigned_to !== undefined || payload.department !== undefined

    if (!isAdmin && isLead) {
      if (assignmentFieldsTouched && finalAssignedTo) {
        const { data: assignee } = await supabase
          .from("profiles")
          .select("id, department")
          .eq("id", finalAssignedTo)
          .single()

        if (!assignee || !canAssignToProfile(profile, assignee)) {
          return apiError(
            "You can only assign tasks to users within your approved departmental scope",
            ApiErrorCode.FORBIDDEN,
            403
          )
        }
        finalDepartment = assignee.department || finalDepartment
      }

      if (assignmentFieldsTouched && finalDepartment && !canAssignToDepartment(profile, finalDepartment)) {
        return apiError("You can only assign tasks within your approved department scope", ApiErrorCode.FORBIDDEN, 403)
      }
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      ...payload,
      updated_by: user.id,
      updated_at: now,
    }

    if (payload.assigned_to !== undefined && payload.assigned_to !== existingTask.assigned_to) {
      updatePayload.assigned_at = now
    }

    if (payload.due_date && payload.due_date !== existingTask.due_date) {
      if (payload.extension_reason) {
        updatePayload.extension_reason = payload.extension_reason
      }
    }

    if (assignmentFieldsTouched) {
      updatePayload.department = finalDepartment
      updatePayload.assigned_to = finalAssignedTo
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
        newValues: updatePayload,
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<ProfileRecord>()

    const scope = await getRequestScope()
    const isAdmin = isAdminProfile(scope)
    const isLead = Boolean(profile?.is_department_lead)

    if (!isAdmin && !isLead) {
      return apiError(
        "Forbidden: Only department leads or administrators can archive tasks",
        ApiErrorCode.FORBIDDEN,
        403
      )
    }

    const now = new Date().toISOString()
    // Soft delete / archive to protect audit trails
    const { data: archivedTask, error } = await supabase
      .from("tasks")
      .update({
        is_archived: true,
        archived_by: user.id,
        archived_at: now,
        updated_by: user.id,
        updated_at: now,
      })
      .eq("id", params.id)
      .select()
      .single()

    if (error) return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 500)

    await writeAuditLog(
      supabase,
      {
        action: "task.archive",
        entityType: "task",
        entityId: params.id,
        oldValues: { is_archived: false },
        newValues: { is_archived: true, archived_by: user.id, archived_at: now },
        context: { actorId: user.id, source: "api", route: "/api/tasks/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true, data: archivedTask })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task DELETE")
    return apiError("Failed to archive task", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
