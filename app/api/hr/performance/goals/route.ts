import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"

const log = logger("performance-goals")
const CreateGoalSchema = z.object({
  department: z.string().trim().min(1, "Department is required"),
  review_cycle_id: z.string().optional().nullable(),
  title: z.string().trim().min(1, "Goal title is required").max(500),
  description: z.string().max(5000).optional().nullable(),
  target_value: z.coerce.number().min(0).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due_date: z.string().optional().nullable(),
  weight_pct: z.number().min(0).max(100).optional().nullable(),
})

const UpdateGoalApprovalSchema = z.object({
  id: z.string().trim().min(1, "Goal ID and valid approval_status required"),
  approval_status: z.enum(["approved", "rejected"], {
    errorMap: () => ({ message: "Goal ID and valid approval_status required" }),
  }),
  rejection_reason: z.string().trim().optional().nullable(),
})

const UpdateGoalSchema = z.object({
  id: z.string().trim().min(1, "Goal ID is required"),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  target_value: z.number().min(0).optional().nullable(),
  achieved_value: z.number().min(0).optional().nullable(),
  status: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due_date: z.string().optional().nullable(),
  weight_pct: z.number().min(0).max(100).optional().nullable(),
  approval_status: z.enum(["approved", "pending", "rejected"]).optional(),
  is_archived: z.boolean().optional(),
})

type GoalOwnerRecord = {
  id: string
  user_id: string
  department?: string | null
}

type GoalProfileRecord = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

type GoalCycleRecord = {
  id: string
  name?: string | null
  review_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

type GoalRow = {
  id: string
  user_id: string
  department?: string | null
  review_cycle_id?: string | null
  title: string
  description?: string | null
  target_value?: number | null
  achieved_value?: number | null
  status?: string | null
  priority?: string | null
  due_date?: string | null
  created_at?: string | null
  updated_at?: string | null
  approval_status?: string | null
  is_archived?: boolean | null
}

async function attachGoalCycles(supabase: Awaited<ReturnType<typeof createClient>>, goals: GoalRow[]) {
  const cycleIds = Array.from(new Set(goals.map((goal) => goal.review_cycle_id).filter(Boolean)))
  if (cycleIds.length === 0) {
    return goals.map((goal) => ({ ...goal, cycle: null }))
  }

  const { data: cycles } = await supabase
    .from("review_cycles")
    .select("id, name, review_type, start_date, end_date")
    .in("id", cycleIds)
    .returns<GoalCycleRecord[]>()

  const cyclesById = new Map((cycles || []).map((cycle) => [cycle.id, cycle]))

  return goals.map((goal) => ({
    ...goal,
    cycle: goal.review_cycle_id ? cyclesById.get(goal.review_cycle_id) || null : null,
  }))
}

function canManageGoalOwner(
  scope: AdminScope | null,
  profile: GoalProfileRecord | null | undefined,
  goalDepartment: string | null | undefined
) {
  if (scope?.isAdminLike === true && scope.scopeMode !== "lead") return true
  if (!profile?.is_department_lead || !goalDepartment) return false
  const managedDepartments = scope?.managedDepartments?.length
    ? expandDepartmentScopeForQuery(scope.managedDepartments)
    : expandDepartmentScopeForQuery(Array.isArray(profile.lead_departments) ? profile.lead_departments : [])
  return profile.department === goalDepartment || managedDepartments.includes(goalDepartment)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const userId = searchParams.get("user_id")
    const department = searchParams.get("department")
    const cycleId = searchParams.get("cycle_id")
    const includeArchived = searchParams.get("include_archived") === "true"

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<GoalProfileRecord>()

    let targetDepartment = department || profile?.department || null

    if (userId) {
      const { data: goalOwnerProfile } = await supabase
        .from("profiles")
        .select("department")
        .eq("id", userId)
        .single<{ department?: string | null }>()
      targetDepartment = goalOwnerProfile?.department || targetDepartment
    }

    const getScope = await getRequestScope()
    const isGlobalAdmin = getScope?.isAdminLike === true && getScope.scopeMode !== "lead"

    let query = supabase.from("goals_objectives").select("*").order("created_at", { ascending: false })

    if (!includeArchived) {
      query = query.eq("is_archived", false)
    }

    if (targetDepartment) {
      if (
        targetDepartment !== profile?.department &&
        !isGlobalAdmin &&
        !canManageGoalOwner(getScope, profile, targetDepartment)
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      query = query.eq("department", targetDepartment)
    }

    if (cycleId) {
      query = query.eq("review_cycle_id", cycleId)
    }

    const { data: goals, error } = await query.returns<GoalRow[]>()

    if (error) {
      log.error({ err: error }, "Error fetching goals")
      return NextResponse.json({ error: "Failed to fetch goals" }, { status: 500 })
    }

    return NextResponse.json({ data: await attachGoalCycles(supabase, goals || []) })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-goals:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = CreateGoalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { department, review_cycle_id, title, description, target_value, priority, due_date, weight_pct } =
      parsed.data
    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<GoalProfileRecord>()

    const postScope = await getRequestScope()
    const isGlobalAdminPost = postScope?.isAdminLike === true && postScope.scopeMode !== "lead"
    const canCreateForDepartment = isGlobalAdminPost || canManageGoalOwner(postScope, actorProfile, department)

    if (!canCreateForDepartment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Create goal directly in active/approved state
    const { data: goal, error } = await supabase
      .from("goals_objectives")
      .insert({
        user_id: user.id,
        department,
        review_cycle_id,
        title,
        description,
        target_value,
        priority: priority || "medium",
        due_date,
        weight_pct: weight_pct ?? null,
        status: "in_progress",
        approval_status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        is_archived: false,
        updated_by: user.id,
      })
      .select("*")
      .returns<GoalRow[]>()
      .single()

    if (error) {
      log.error({ err: error }, "Error creating goal")
      return NextResponse.json({ error: "Failed to create goal" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "goal",
        entityId: goal.id,
        newValues: { user_id: user.id, department, review_cycle_id, title, priority: priority || "medium" },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/goals" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: (await attachGoalCycles(supabase, [goal]))[0],
      message: "Goal created successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in POST")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-goals:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = UpdateGoalApprovalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { id, approval_status, rejection_reason } = parsed.data

    const { data: goal, error } = await supabase
      .from("goals_objectives")
      .update({
        approval_status,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        rejection_reason: approval_status === "rejected" ? rejection_reason : null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      log.error({ err: error }, "Error updating goal approval")
      return NextResponse.json({ error: "Failed to update goal approval" }, { status: 500 })
    }

    return NextResponse.json({ data: goal, message: `KPI ${approval_status} successfully` })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in PATCH")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-goals:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = UpdateGoalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { id, ...updates } = parsed.data
    const [{ data: existingGoal }, { data: profile }] = await Promise.all([
      supabase.from("goals_objectives").select("id, user_id, department").eq("id", id).single<GoalOwnerRecord>(),
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<GoalProfileRecord>(),
    ])
    if (!existingGoal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })
    const putScope = await getRequestScope()
    const isOwner = existingGoal.user_id === user.id
    const managerCanUpdate = canManageGoalOwner(putScope, profile, existingGoal.department)
    if (!isOwner && !managerCanUpdate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: goal, error } = await supabase
      .from("goals_objectives")
      .update({ ...updates, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      log.error({ err: error }, "Error updating goal")
      return NextResponse.json({ error: "Failed to update goal" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "goal",
        entityId: id,
        newValues: updates,
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/goals" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: goal,
      message: "Goal updated successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in PUT")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-goals:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Goal ID is required" }, { status: 400 })

    const [{ data: existingGoal }, { data: profile }] = await Promise.all([
      supabase.from("goals_objectives").select("id, user_id, department").eq("id", id).single<GoalOwnerRecord>(),
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<GoalProfileRecord>(),
    ])

    if (!existingGoal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })
    const delScope = await getRequestScope()
    const isOwner = existingGoal.user_id === user.id
    const managerCanDelete = canManageGoalOwner(delScope, profile, existingGoal.department)
    if (!isOwner && !managerCanDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Soft delete / archive
    const now = new Date().toISOString()
    const { data: archivedGoal, error } = await supabase
      .from("goals_objectives")
      .update({
        is_archived: true,
        archived_by: user.id,
        archived_at: now,
        updated_by: user.id,
        updated_at: now,
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      log.error({ err: error }, "Error archiving goal")
      return NextResponse.json({ error: "Failed to archive goal" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "archive",
        entityType: "goal",
        entityId: id,
        newValues: { is_archived: true, archived_by: user.id, archived_at: now },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/goals" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: archivedGoal,
      message: "Goal archived successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in DELETE")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
