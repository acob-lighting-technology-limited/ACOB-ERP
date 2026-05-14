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

const log = logger("tasks-route")

const TaskBodySchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  priority: z.string().trim().min(1),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
  due_date: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  assignment_type: z.enum(["individual", "department"]),
  assigned_to: z.string().uuid().optional().nullable(),
  goal_id: z.string().uuid("Goal is required"),
  task_start_date: z.string().optional().nullable(),
  task_end_date: z.string().optional().nullable(),
  source_type: z.enum(["manual"]).default("manual"),
})

export async function POST(request: NextRequest) {
  try {
    const rl = await rateLimit(`tasks-create:${getClientId(request)}`, { limit: 30, windowSec: 60 })
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
      .select("id, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<TaskAssignmentAuthorityProfile>()

    if (!profile || !canAssignTasks(profile)) {
      return apiError("Forbidden", ApiErrorCode.FORBIDDEN, 403)
    }

    const sizeError = checkRequestSize(request)
    if (sizeError) return sizeError

    const parsed = TaskBodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Validation failed",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
    }

    const payload = parsed.data
    let resolvedDepartment = payload.department || null

    if (payload.assignment_type === "individual") {
      if (!payload.assigned_to) {
        return apiError("Assignee is required for individual tasks", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
      }

      const { data: assignee } = await supabase
        .from("profiles")
        .select("id, department")
        .eq("id", payload.assigned_to)
        .single<TaskAssignmentTargetProfile>()

      if (!assignee) {
        return apiError("Selected assignee was not found", ApiErrorCode.NOT_FOUND, 400)
      }

      if (!canAssignToProfile(profile, assignee)) {
        return apiError("You can only assign tasks within your approved scope", ApiErrorCode.FORBIDDEN, 403)
      }

      resolvedDepartment = assignee.department || resolvedDepartment
    }

    if (payload.assignment_type === "department") {
      if (!payload.department) {
        return apiError("Department is required for department tasks", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
      }

      if (!canAssignToDepartment(profile, payload.department)) {
        return apiError("You can only assign tasks within your approved scope", ApiErrorCode.FORBIDDEN, 403)
      }
    }

    const insertPayload = {
      title: payload.title,
      description: payload.description || null,
      priority: payload.priority,
      status: payload.status,
      due_date: payload.due_date || null,
      department: resolvedDepartment,
      assignment_type: payload.assignment_type,
      assigned_to: payload.assignment_type === "individual" ? payload.assigned_to || null : null,
      assigned_by: user.id,
      goal_id: payload.goal_id,
      task_start_date: payload.task_start_date || null,
      task_end_date: payload.task_end_date || null,
      source_type: payload.source_type,
    }

    const { data: task, error } = await supabase.from("tasks").insert(insertPayload).select("*").single()
    if (error || !task) {
      return apiError(error?.message || "Failed to create task", ApiErrorCode.DATABASE_ERROR, 500)
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.create",
        entityType: "task",
        entityId: task.id,
        newValues: { title: task.title, status: task.status, goal_id: task.goal_id },
        context: { actorId: user.id, source: "api", route: "/api/tasks" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: task }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in tasks POST")
    return apiError("Failed to create task", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
