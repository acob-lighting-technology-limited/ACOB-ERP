import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { canAssignToDepartment, canAssignToProfile } from "@/lib/tasks/assignment-scope"
import { TASK_STATUSES, TASK_ASSIGNMENT_TYPES } from "@/lib/tasks/constants"
import type { Task, TaskPersonSummary } from "@/types/task"

const log = logger("tasks-route")

const TaskBodySchema = z.object({
  title: z.string().trim().min(1, "Task title is required"),
  description: z.string().optional().nullable(),
  priority: z.string().trim().min(1).default("medium"),
  status: z.enum(TASK_STATUSES).default("pending"),
  due_date: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  assignment_type: z.enum(TASK_ASSIGNMENT_TYPES).default("individual"),
  assigned_to: z.string().uuid().optional().nullable(),
  assigned_users: z.array(z.string().uuid()).optional().default([]),
  goal_id: z.string().uuid().optional().nullable(),
  task_start_date: z.string().optional().nullable(),
  task_end_date: z.string().optional().nullable(),
  source_type: z.enum(["manual", "help_desk", "action_item"]).default("manual"),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const scope = await getRequestScope()
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const scopedDepts = getScopedDepartments(scope)
    const url = new URL(request.url)
    const departmentFilter = url.searchParams.get("department")
    const statusFilter = url.searchParams.get("status")
    const goalFilter = url.searchParams.get("goal_id")
    const userFilter = url.searchParams.get("assigned_to")
    const includeArchived = url.searchParams.get("include_archived") === "true"

    let query = supabase
      .from("tasks")
      .select(
        `
        id,
        title,
        description,
        work_item_number,
        priority,
        status,
        due_date,
        started_at,
        completed_at,
        created_at,
        updated_at,
        source_type,
        source_id,
        assignment_type,
        assigned_to,
        assigned_by,
        assigned_at,
        department,
        goal_id,
        task_start_date,
        task_end_date,
        created_by,
        updated_by,
        reviewed_by,
        reviewed_at,
        reassigned_to,
        unable_to_complete_reason,
        failure_reason,
        extension_reason,
        is_archived,
        archived_by,
        archived_at
      `
      )
      .order("created_at", { ascending: false })

    if (!includeArchived) {
      query = query.eq("is_archived", false)
    }

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter)
    }

    if (goalFilter && goalFilter !== "all") {
      query = query.eq("goal_id", goalFilter)
    }

    if (departmentFilter && departmentFilter !== "all") {
      query = query.eq("department", departmentFilter)
    } else if (scopedDepts !== null) {
      if (scopedDepts.length === 0) {
        return NextResponse.json({ data: [] })
      }
      query = query.in("department", scopedDepts)
    }

    if (userFilter && userFilter !== "all") {
      query = query.eq("assigned_to", userFilter)
    }

    const { data: rawTasks, error } = await query
    if (error) {
      log.error({ err: error }, "Failed to fetch tasks")
      return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 500)
    }

    const tasks = (rawTasks || []) as Task[]
    if (tasks.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Collect all profile IDs to batch fetch
    const profileIds = new Set<string>()
    const goalIds = new Set<string>()
    const multipleTaskIds: string[] = []

    tasks.forEach((t) => {
      if (t.assigned_to) profileIds.add(t.assigned_to)
      if (t.assigned_by) profileIds.add(t.assigned_by)
      if (t.created_by) profileIds.add(t.created_by)
      if (t.updated_by) profileIds.add(t.updated_by)
      if (t.reviewed_by) profileIds.add(t.reviewed_by)
      if (t.reassigned_to) profileIds.add(t.reassigned_to)
      if (t.goal_id) goalIds.add(t.goal_id)
      if (t.assignment_type === "multiple") multipleTaskIds.push(t.id)
    })

    const [profilesRes, goalsRes, assignmentsRes] = await Promise.all([
      profileIds.size > 0
        ? supabase.from("profiles").select("id, first_name, last_name, department").in("id", Array.from(profileIds))
        : { data: [] },
      goalIds.size > 0
        ? supabase.from("goals_objectives").select("id, title").in("id", Array.from(goalIds))
        : { data: [] },
      multipleTaskIds.length > 0
        ? supabase.from("task_assignments").select("task_id, user_id").in("task_id", multipleTaskIds)
        : { data: [] },
    ])

    const profileMap = new Map<string, TaskPersonSummary>(
      ((profilesRes.data || []) as TaskPersonSummary[]).map((p) => [p.id, p])
    )
    const goalMap = new Map<string, string>(
      ((goalsRes.data || []) as Array<{ id: string; title: string }>).map((g) => [g.id, g.title])
    )

    // Check if assignments referenced additional users
    const assignmentRows = (assignmentsRes.data || []) as Array<{ task_id: string; user_id: string }>
    const extraUserIds = assignmentRows.map((a) => a.user_id).filter((uid) => !profileMap.has(uid))
    if (extraUserIds.length > 0) {
      const { data: extraProfiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, department")
        .in("id", Array.from(new Set(extraUserIds)))
      ;((extraProfiles || []) as TaskPersonSummary[]).forEach((p) => profileMap.set(p.id, p))
    }

    const assignmentsByTaskId = new Map<string, TaskPersonSummary[]>()
    assignmentRows.forEach((row) => {
      const p = profileMap.get(row.user_id)
      if (p) {
        const list = assignmentsByTaskId.get(row.task_id) || []
        list.push(p)
        assignmentsByTaskId.set(row.task_id, list)
      }
    })

    // Enrich tasks
    const enrichedTasks = tasks.map((t) => {
      const copy: Task = { ...t }
      if (t.assigned_to) copy.assigned_to_user = profileMap.get(t.assigned_to)
      if (t.assigned_by) copy.assigned_by_user = profileMap.get(t.assigned_by)
      if (t.created_by) copy.created_by_user = profileMap.get(t.created_by)
      if (t.updated_by) copy.updated_by_user = profileMap.get(t.updated_by)
      if (t.reviewed_by) copy.reviewed_by_user = profileMap.get(t.reviewed_by)
      if (t.reassigned_to) copy.reassigned_to_user = profileMap.get(t.reassigned_to)
      if (t.goal_id) copy.goal_title = goalMap.get(t.goal_id) || null
      if (t.assignment_type === "multiple") {
        copy.assigned_users = assignmentsByTaskId.get(t.id) || []
      }
      return copy
    })

    return NextResponse.json({ data: enrichedTasks })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in tasks GET")
    return apiError("Failed to fetch tasks", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single()

    const scope = await getRequestScope()
    const isAdmin = Boolean(scope?.isAdminLike)
    const isLead = Boolean(profile?.is_department_lead)

    if (!isAdmin && !isLead) {
      return apiError(
        "Forbidden: Only department leads and administrators can create tasks",
        ApiErrorCode.FORBIDDEN,
        403
      )
    }

    const payload = parsed.data
    const resolvedDepartment = payload.department || profile?.department || null

    // Determine target users to assign
    const targetUserIds: string[] = []
    if (payload.assigned_to) {
      targetUserIds.push(payload.assigned_to)
    }
    if (payload.assigned_users && payload.assigned_users.length > 0) {
      payload.assigned_users.forEach((uid) => {
        if (!targetUserIds.includes(uid)) targetUserIds.push(uid)
      })
    }

    // Validate scope if assigner is a department lead
    if (!isAdmin && isLead) {
      if (resolvedDepartment && !canAssignToDepartment(profile, resolvedDepartment)) {
        return apiError("You can only create tasks for your assigned department scope", ApiErrorCode.FORBIDDEN, 403)
      }

      if (targetUserIds.length > 0) {
        const { data: targetProfiles } = await supabase
          .from("profiles")
          .select("id, department")
          .in("id", targetUserIds)

        for (const target of targetProfiles || []) {
          if (!canAssignToProfile(profile, target)) {
            return apiError(
              "You can only assign tasks to users within your departmental scope",
              ApiErrorCode.FORBIDDEN,
              403
            )
          }
        }
      }
    }

    const now = new Date().toISOString()

    // ── Fan-Out Logic: If multiple assignees, create 1 task row per assignee ──
    if (targetUserIds.length > 1) {
      const insertPayloads = targetUserIds.map((targetId) => ({
        title: payload.title,
        description: payload.description || null,
        priority: payload.priority,
        status: payload.status,
        due_date: payload.due_date || null,
        department: resolvedDepartment,
        assignment_type: "individual" as const,
        assigned_to: targetId,
        assigned_by: user.id,
        assigned_at: now,
        created_by: user.id,
        updated_by: user.id,
        goal_id: payload.goal_id || null,
        task_start_date: payload.task_start_date || null,
        task_end_date: payload.task_end_date || null,
        source_type: payload.source_type,
      }))

      const { data: createdTasks, error: tasksError } = await supabase.from("tasks").insert(insertPayloads).select("*")

      if (tasksError || !createdTasks || createdTasks.length === 0) {
        log.error({ err: tasksError }, "Failed to fan-out create tasks")
        return apiError(tasksError?.message || "Failed to create tasks", ApiErrorCode.DATABASE_ERROR, 500)
      }

      // Write audit log
      await writeAuditLog(
        supabase,
        {
          action: "task.bulk_create",
          entityType: "task",
          entityId: createdTasks[0].id,
          newValues: {
            title: payload.title,
            count: createdTasks.length,
            assignees: targetUserIds,
            goal_id: payload.goal_id,
          },
          context: { actorId: user.id, source: "api", route: "/api/tasks" },
        },
        { failOpen: true }
      )

      // Notify all assignees
      for (const t of createdTasks) {
        if (t.assigned_to && t.assigned_to !== user.id) {
          try {
            const notifyPriority = t.priority === "urgent" ? "urgent" : t.priority === "high" ? "high" : "normal"
            await supabase.rpc("create_notification", {
              p_user_id: t.assigned_to,
              p_type: "task_assigned",
              p_category: "tasks",
              p_title: "New task assigned to you",
              p_message: t.title,
              p_priority: notifyPriority,
              p_link_url: "/tasks/management",
              p_actor_id: user.id,
              p_entity_type: "task",
              p_entity_id: t.id,
            })
          } catch (notifyErr) {
            log.error({ err: String(notifyErr), targetId: t.assigned_to }, "Task assignment notification failed")
          }
        }
      }

      return NextResponse.json({ data: createdTasks[0], createdCount: createdTasks.length }, { status: 201 })
    }

    // ── Single Assignee or Unassigned Task ──
    const primaryAssignee = targetUserIds.length === 1 ? targetUserIds[0] : null
    const insertPayload = {
      title: payload.title,
      description: payload.description || null,
      priority: payload.priority,
      status: payload.status,
      due_date: payload.due_date || null,
      department: resolvedDepartment,
      assignment_type: (primaryAssignee ? "individual" : payload.assignment_type) as
        | "individual"
        | "multiple"
        | "department",
      assigned_to: primaryAssignee,
      assigned_by: user.id,
      assigned_at: primaryAssignee ? now : null,
      created_by: user.id,
      updated_by: user.id,
      goal_id: payload.goal_id || null,
      task_start_date: payload.task_start_date || null,
      task_end_date: payload.task_end_date || null,
      source_type: payload.source_type,
    }

    const { data: task, error: taskError } = await supabase.from("tasks").insert(insertPayload).select("*").single()

    if (taskError || !task) {
      log.error({ err: taskError }, "Failed to insert task")
      return apiError(taskError?.message || "Failed to create task", ApiErrorCode.DATABASE_ERROR, 500)
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.create",
        entityType: "task",
        entityId: task.id,
        newValues: {
          title: task.title,
          status: task.status,
          goal_id: task.goal_id,
          assignment_type: task.assignment_type,
          assigned_to: task.assigned_to,
        },
        context: { actorId: user.id, source: "api", route: "/api/tasks" },
      },
      { failOpen: true }
    )

    if (task.assigned_to && task.assigned_to !== user.id) {
      try {
        const notifyPriority = task.priority === "urgent" ? "urgent" : task.priority === "high" ? "high" : "normal"
        await supabase.rpc("create_notification", {
          p_user_id: task.assigned_to,
          p_type: "task_assigned",
          p_category: "tasks",
          p_title: "New task assigned to you",
          p_message: task.title,
          p_priority: notifyPriority,
          p_link_url: "/tasks/management",
          p_actor_id: user.id,
          p_entity_type: "task",
          p_entity_id: task.id,
        })
      } catch (notifyErr) {
        log.error({ err: String(notifyErr), targetId: task.assigned_to }, "Task assignment notification failed")
      }
    }

    return NextResponse.json({ data: task }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in tasks POST")
    return apiError("Failed to create task", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
