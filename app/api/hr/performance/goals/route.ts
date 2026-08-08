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
  approval_status: z.enum(["pending"]).optional(),
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
}

async function attachGoalCycles(supabase: Awaited<ReturnType<typeof createClient>>, goals: GoalRow[]) {
  const cycleIds = Array.from(new Set(goals.map((goal) => goal.review_cycle_id).filter(Boolean)))
  if (cycleIds.length === 0) {
    return goals.map((goal) => ({ ...goal, cycle: null }))
  }

  const { data: cycles } = await supabase
    .from("review_cycles")
    .select("id, name, review_type")
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
  // Prefer scope.managedDepartments (alias-expanded) over raw profile.lead_departments
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

    if (!targetDepartment) {
      return NextResponse.json({ data: [] })
    }

    const getScope = await getRequestScope()
    // Global admin (scopeMode: "global") may access any department's goals.
    // Admin in lead mode is restricted the same as a department lead.
    const isGlobalAdmin = getScope?.isAdminLike === true && getScope.scopeMode !== "lead"

    if (
      targetDepartment !== profile?.department &&
      !isGlobalAdmin &&
      !canManageGoalOwner(getScope, profile, targetDepartment)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let query = supabase
      .from("goals_objectives")
      .select("*")
      .eq("department", targetDepartment)
      .order("created_at", { ascending: false })

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

    // Weight validation: if weight_pct is set, check existing goals don't exceed 100%
    let weightWarning: string | null = null
    if (typeof weight_pct === "number" && review_cycle_id) {
      const { data: existingGoals } = await supabase
        .from("goals_objectives")
        .select("weight_pct")
        .eq("department", department)
        .eq("review_cycle_id", review_cycle_id)
        .eq("approval_status", "approved")
        .not("weight_pct", "is", null)

      const existingTotal = (existingGoals || []).reduce(
        (sum, goal) => sum + (typeof goal.weight_pct === "number" ? goal.weight_pct : 0),
        0
      )
      if (existingTotal + weight_pct > 100) {
        return NextResponse.json(
          {
            error: `Adding this weight (${weight_pct}%) would bring total approved goal weights to ${existingTotal + weight_pct}%, exceeding 100%. Current total: ${existingTotal}%.`,
          },
          { status: 400 }
        )
      }
      if (existingTotal + weight_pct < 100) {
        weightWarning = `Current total goal weight will be ${existingTotal + weight_pct}% (${100 - existingTotal - weight_pct}% unallocated).`
      }
    }

    // Create goal
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
        // Goal creation is already restricted to department leads and admins
        // (see canCreateForDepartment above) — the creator IS the approving
        // authority, so there is nobody left to ask. Leaving these at the
        // column default parked every lead-created goal at "pending approval"
        // forever, and the weight check below only counts approved goals.
        approval_status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
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
      ...(weightWarning ? { warning: weightWarning } : {}),
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in POST")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

// PATCH: approve or reject a KPI (managers/admins only)
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_department_lead")
      .eq("id", user.id)
      .single()

    const patchScope = await getRequestScope()
    const isGlobalAdminPatch = patchScope?.isAdminLike === true && patchScope.scopeMode !== "lead"
    if (!profile || (!isGlobalAdminPatch && !profile.is_department_lead)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateGoalApprovalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { id, approval_status } = parsed.data
    const rejectionReason = parsed.data.rejection_reason?.trim() || null

    // A rejected goal must explain itself so the owner knows what to revise.
    if (approval_status === "rejected" && !rejectionReason) {
      return NextResponse.json({ error: "A reason is required when rejecting a goal" }, { status: 400 })
    }

    const { data: goal, error } = await supabase
      .from("goals_objectives")
      .update({
        approval_status,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        rejection_reason: approval_status === "rejected" ? rejectionReason : null,
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      log.error({ err: error }, "Error approving goal")
      return NextResponse.json({ error: "Failed to update goal approval" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "goal",
        entityId: id,
        newValues: { approval_status, approved_by: user.id },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/goals" },
      },
      { failOpen: true }
    )

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
    // Update goal
    const { data: goal, error } = await supabase
      .from("goals_objectives")
      .update({ ...updates, updated_at: new Date().toISOString() })
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
