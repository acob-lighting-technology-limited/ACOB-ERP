import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"
import { TASK_STATUSES, type TaskStatus } from "@/lib/tasks/constants"
import { TASK_RATING_MAX, TASK_RATING_MIN, isValidRating } from "@/lib/tasks/scoring"

const log = logger("tasks-status-route")

const StatusBodySchema = z.object({
  status: z.enum(TASK_STATUSES),
  comment: z.string().trim().max(5000).optional(),
  reason: z.string().trim().max(5000).optional(),
  reassigned_to: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  extension_reason: z.string().trim().max(5000).optional().nullable(),
  // Required when completing a task: the rater's score of the delivered work.
  rating: z.number().int().min(TASK_RATING_MIN).max(TASK_RATING_MAX).optional().nullable(),
})

const EMPLOYEE_TRANSITIONS: Record<string, TaskStatus[]> = {
  pending: ["in_progress", "submitted_for_review", "unable_to_complete", "cancelled"],
  in_progress: ["submitted_for_review", "unable_to_complete", "pending", "cancelled"],
  submitted_for_review: ["in_progress", "unable_to_complete"],
  unable_to_complete: ["in_progress", "submitted_for_review"],
  completed: [],
  reassigned: [],
  failed: [],
  cancelled: ["pending"],
}

type TaskRecord = {
  id: string
  title: string
  status: string
  goal_id?: string | null
  assignment_type?: string | null
  assigned_to?: string | null
  assigned_by?: string | null
  department?: string | null
  started_at?: string | null
  completed_at?: string | null
  work_item_number?: string | null
  due_date?: string | null
  priority?: string | null
  description?: string | null
  task_start_date?: string | null
  task_end_date?: string | null
  source_type?: string | null
  project_id?: string | null
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
        `
        id,
        title,
        status,
        goal_id,
        assignment_type,
        assigned_to,
        assigned_by,
        department,
        started_at,
        completed_at,
        work_item_number,
        due_date,
        priority,
        description,
        task_start_date,
        task_end_date,
        source_type,
        project_id
      `
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
    const isLead = isLeadForTask(profile ?? null, task.department)
    const isLeadOrAdmin = isAdmin || isLead

    // A project task is rated by the manager of the project it belongs to; a
    // task with no project is rated by its department lead (or an admin).
    let projectManagerId: string | null = null
    if (task.project_id) {
      const { data: project } = await supabase
        .from("projects")
        .select("project_manager_id")
        .eq("id", task.project_id)
        .maybeSingle<{ project_manager_id: string | null }>()
      projectManagerId = project?.project_manager_id ?? null
    }
    const isProjectManager = Boolean(projectManagerId) && projectManagerId === user.id

    // Who may approve, rate, fail or reassign this task.
    const canReview = isLeadOrAdmin || isProjectManager
    const isAssignee = task.assigned_to === user.id || Boolean(assignments && assignments.length > 0)
    const isAssigner = task.assigned_by === user.id

    if (!isAssignee && !isAssigner && !canReview) {
      return apiError("Forbidden: You do not have permission to update this task", ApiErrorCode.FORBIDDEN, 403)
    }

    const oldStatus = task.status
    const nextStatus = parsed.data.status

    // State machine check for regular assignees
    if (!canReview) {
      const allowed = EMPLOYEE_TRANSITIONS[oldStatus] || []
      if (!allowed.includes(nextStatus)) {
        return apiError(
          `Employees cannot transition task from ${oldStatus.replaceAll("_", " ")} to ${nextStatus.replaceAll("_", " ")}.`,
          ApiErrorCode.INVALID_STATE,
          400
        )
      }
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_by: user.id,
      updated_at: now,
    }

    // Lifecycle timestamps and attribution
    if (nextStatus === "in_progress" && !task.started_at) {
      updatePayload.started_at = now
    }

    if (nextStatus === "completed") {
      // Approval and rating are one action: a task cannot reach "completed"
      // unrated, so "finished but unscored" never exists to leak a zero into
      // the employee's KPI.
      if (!canReview) {
        return apiError(
          task.project_id
            ? "Only the project manager, department lead or an administrator can approve and rate this task"
            : "Only department leads or administrators can approve and rate a task",
          ApiErrorCode.FORBIDDEN,
          403
        )
      }

      if (!isValidRating(parsed.data.rating)) {
        return apiError(
          `A performance rating from ${TASK_RATING_MIN} to ${TASK_RATING_MAX} is required to complete a task`,
          ApiErrorCode.MISSING_REQUIRED_FIELD,
          400
        )
      }

      updatePayload.completed_at = now
      updatePayload.rating = parsed.data.rating
      updatePayload.rated_by = user.id
      updatePayload.rated_at = now
      updatePayload.reviewed_by = user.id
      updatePayload.reviewed_at = now
    }

    if (nextStatus === "unable_to_complete") {
      updatePayload.unable_to_complete_reason = parsed.data.reason || parsed.data.comment || null
    }

    if (nextStatus === "failed") {
      if (!canReview) {
        return apiError(
          "Only department leads or administrators can mark a task as failed",
          ApiErrorCode.FORBIDDEN,
          403
        )
      }
      updatePayload.reviewed_by = user.id
      updatePayload.reviewed_at = now
      updatePayload.failure_reason = parsed.data.reason || parsed.data.comment || null
    }

    if (nextStatus === "reassigned") {
      if (!canReview) {
        return apiError("Only department leads or administrators can reassign a task", ApiErrorCode.FORBIDDEN, 403)
      }
      const newAssigneeId = parsed.data.reassigned_to
      if (!newAssigneeId) {
        return apiError("New assignee is required when reassigning a task", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
      }
      updatePayload.reviewed_by = user.id
      updatePayload.reviewed_at = now
      updatePayload.reassigned_to = newAssigneeId
    }

    // Timeline extension handling
    if (parsed.data.due_date) {
      if (!canReview) {
        return apiError(
          "Only department leads or administrators can extend task deadlines",
          ApiErrorCode.FORBIDDEN,
          403
        )
      }
      updatePayload.due_date = parsed.data.due_date
      if (parsed.data.extension_reason) {
        updatePayload.extension_reason = parsed.data.extension_reason
      }
      // If task was unable_to_complete or expired and is now extended, move back to in_progress
      if (nextStatus === "in_progress") {
        updatePayload.status = "in_progress"
      }
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", task.id)
      .select("*")
      .single()

    if (updateError || !updatedTask) {
      return apiError(updateError?.message || "Failed to update task", ApiErrorCode.DATABASE_ERROR, 500)
    }

    // Log update note/comment
    const commentText = parsed.data.comment || parsed.data.reason || parsed.data.extension_reason
    if (commentText) {
      await supabase.from("task_updates").insert({
        task_id: task.id,
        user_id: user.id,
        update_type: "status_change",
        content: commentText,
        old_value: oldStatus,
        new_value: nextStatus,
      })
    }

    // If task was reassigned, create a new task instance for the new assignee
    if (nextStatus === "reassigned" && parsed.data.reassigned_to) {
      const newAssigneeId = parsed.data.reassigned_to
      const { data: newTargetProfile } = await supabase
        .from("profiles")
        .select("department")
        .eq("id", newAssigneeId)
        .single()

      const newTaskPayload = {
        title: `${task.title} (Reassigned)`,
        description: task.description || null,
        priority: task.priority || "medium",
        status: "pending",
        due_date: parsed.data.due_date || task.due_date || null,
        department: newTargetProfile?.department || task.department,
        assignment_type: "individual",
        assigned_to: newAssigneeId,
        assigned_by: user.id,
        assigned_at: now,
        created_by: user.id,
        updated_by: user.id,
        goal_id: task.goal_id || null,
        task_start_date: task.task_start_date || null,
        task_end_date: task.task_end_date || null,
        source_type: task.source_type || "manual",
      }

      const { data: spawnedTask } = await supabase.from("tasks").insert(newTaskPayload).select().single()

      if (spawnedTask) {
        try {
          await supabase.rpc("create_notification", {
            p_user_id: newAssigneeId,
            p_type: "task_assigned",
            p_category: "tasks",
            p_title: "Task reassigned to you",
            p_message: spawnedTask.title,
            p_priority: "normal",
            p_link_url: "/tasks/management",
            p_actor_id: user.id,
            p_entity_type: "task",
            p_entity_id: spawnedTask.id,
          })
        } catch (nErr) {
          log.error({ err: String(nErr) }, "Failed to notify reassigned user")
        }
      }
    }

    // Send notifications based on transitions.
    //
    // Submitted work goes to whoever can actually approve and rate it: the
    // project manager for project tasks, the assigning lead otherwise. Both
    // are told when they are different people, since the lead still owns the
    // assignee's workload even when a PM owns the rating.
    if (nextStatus === "submitted_for_review") {
      const reviewers = new Set<string>()
      if (projectManagerId) reviewers.add(projectManagerId)
      if (task.assigned_by) reviewers.add(task.assigned_by)
      reviewers.delete(user.id)

      for (const reviewerId of reviewers) {
        try {
          await supabase.rpc("create_notification", {
            p_user_id: reviewerId,
            p_type: "task_awaiting_review",
            p_category: "tasks",
            p_title: "Task awaiting your review",
            p_message: `${task.work_item_number || "Task"} needs your approval and rating: ${task.title}`,
            p_priority: "high",
            p_link_url: "/admin/tasks",
            p_actor_id: user.id,
            p_entity_type: "task",
            p_entity_id: task.id,
          })
        } catch (nErr) {
          log.error({ err: String(nErr) }, "Notification failed")
        }
      }
    }

    if (nextStatus === "completed" && task.assigned_to && task.assigned_to !== user.id) {
      try {
        await supabase.rpc("create_notification", {
          p_user_id: task.assigned_to,
          p_type: "task_completed",
          p_category: "tasks",
          p_title: "Task approved & completed",
          p_message: `Your task "${task.title}" was approved by the lead`,
          p_priority: "normal",
          p_link_url: "/tasks/management",
          p_actor_id: user.id,
          p_entity_type: "task",
          p_entity_id: task.id,
        })
      } catch (nErr) {
        log.error({ err: String(nErr) }, "Notification failed")
      }
    }

    if (nextStatus === "unable_to_complete" && task.assigned_by && task.assigned_by !== user.id) {
      try {
        await supabase.rpc("create_notification", {
          p_user_id: task.assigned_by,
          p_type: "task_blocked",
          p_category: "tasks",
          p_title: "Task reported unable to complete",
          p_message: `${task.title}: ${parsed.data.reason || "Issue reported"}`,
          p_priority: "high",
          p_link_url: "/admin/tasks",
          p_actor_id: user.id,
          p_entity_type: "task",
          p_entity_id: task.id,
        })
      } catch (nErr) {
        log.error({ err: String(nErr) }, "Notification failed")
      }
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.status_update",
        entityType: "task",
        entityId: task.id,
        oldValues: { status: oldStatus },
        newValues: { status: nextStatus, ...updatePayload },
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
