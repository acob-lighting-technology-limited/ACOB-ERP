import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"

const log = logger("tasks-comments-route")

const CommentBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
})

type ProfileRecord = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

function canLeadDepartment(profile: ProfileRecord | null, department: string | null | undefined) {
  if (!profile?.is_department_lead || !department) return false
  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  return profile.department === department || leadDepartments.includes(department)
}

function isPrivileged(scope: AdminScope | null) {
  return scope?.isAdminLike === true && scope.scopeMode !== "lead"
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`tasks-comments:${getClientId(request)}`, { limit: 30, windowSec: 60 })
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

    const parsed = CommentBodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Validation failed",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
    }

    const [{ data: task }, { data: profile }, { data: assignments }] = await Promise.all([
      supabase.from("tasks").select("id, assigned_to, assigned_by, department").eq("id", params.id).single(),
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ProfileRecord>(),
      supabase.from("task_assignments").select("user_id").eq("task_id", params.id).eq("user_id", user.id).limit(1),
    ])

    if (!task) return apiError("Task not found", ApiErrorCode.NOT_FOUND, 404)

    const commentScope = await getRequestScope()
    const canAccess =
      task.assigned_to === user.id ||
      task.assigned_by === user.id ||
      Boolean(assignments && assignments.length > 0) ||
      isPrivileged(commentScope) ||
      canLeadDepartment(profile ?? null, task.department)

    if (!canAccess) return apiError("Forbidden", ApiErrorCode.FORBIDDEN, 403)

    const { data: comment, error } = await supabase
      .from("task_updates")
      .insert({
        task_id: params.id,
        user_id: user.id,
        update_type: "comment",
        content: parsed.data.content,
      })
      .select("*")
      .single()

    if (error || !comment) {
      return apiError(error?.message || "Failed to create comment", ApiErrorCode.DATABASE_ERROR, 500)
    }

    await writeAuditLog(
      supabase,
      {
        action: "task.comment_create",
        entityType: "task",
        entityId: params.id,
        newValues: { content: parsed.data.content },
        context: { actorId: user.id, source: "api", route: "/api/tasks/[id]/comments" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: comment })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in task comments POST")
    return apiError("Failed to add comment", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
