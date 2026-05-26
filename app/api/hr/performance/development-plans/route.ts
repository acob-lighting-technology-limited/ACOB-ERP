import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"

const log = logger("development-plans")

const PRIORITIES = ["low", "medium", "high"] as const
const STATUSES = ["active", "completed", "cancelled", "on_hold"] as const
const FOCUS_AREAS = [
  "general",
  "communication",
  "leadership",
  "technical",
  "collaboration",
  "time_management",
  "problem_solving",
] as const

const CreatePlanSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  review_id: z.string().uuid().optional().nullable(),
  review_cycle_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1, "Title is required").max(500),
  description: z.string().max(5000).optional().nullable(),
  focus_area: z.enum(FOCUS_AREAS).default("general"),
  priority: z.enum(PRIORITIES).default("medium"),
  status: z.enum(STATUSES).default("active"),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  actions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        description: z.string().max(2000).optional().nullable(),
        due_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable(),
      })
    )
    .optional(),
})

const UpdatePlanSchema = z.object({
  id: z.string().uuid("Invalid plan ID"),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  focus_area: z.enum(FOCUS_AREAS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  progress_pct: z.number().min(0).max(100).optional(),
})

type ProfileRow = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

function canManageUser(scope: AdminScope | null, actor: ProfileRow | null, targetDept: string | null | undefined) {
  if (!actor) return false
  if (scope?.isAdminLike === true && scope.scopeMode !== "lead") return true
  if (!actor.is_department_lead || !targetDept) return false
  const managed = Array.isArray(actor.lead_departments) ? actor.lead_departments : []
  return actor.department === targetDept || managed.includes(targetDept)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = request.nextUrl
    const targetUserId = searchParams.get("user_id") || user.id
    const cycleId = searchParams.get("cycle_id")

    // Authorization
    if (targetUserId !== user.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ProfileRow>()
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("department")
        .eq("id", targetUserId)
        .maybeSingle<{ department?: string | null }>()

      if (!canManageUser(await getRequestScope(), profile, targetProfile?.department)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    let query = supabase
      .from("development_plans")
      .select("*, actions:development_plan_actions(id, title, description, status, due_date, completed_at, created_at)")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })

    if (cycleId) query = query.eq("review_cycle_id", cycleId)

    const { data: plans, error } = await query
    if (error) {
      log.error({ err: String(error) }, "Error fetching development plans")
      return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 })
    }

    return NextResponse.json({ data: plans })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/development-plans")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-development-plans:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = CreatePlanSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { actions, ...planData } = parsed.data

    // Authorization: only admins/leads can create plans for others
    if (planData.user_id !== user.id) {
      const [{ data: profile }, { data: targetProfile }] = await Promise.all([
        supabase
          .from("profiles")
          .select("role, department, is_department_lead, lead_departments")
          .eq("id", user.id)
          .single<ProfileRow>(),
        supabase
          .from("profiles")
          .select("department")
          .eq("id", planData.user_id)
          .maybeSingle<{ department?: string | null }>(),
      ])
      if (!canManageUser(await getRequestScope(), profile, targetProfile?.department)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { data: plan, error } = await adminSupabase
      .from("development_plans")
      .insert({ ...planData, created_by: user.id })
      .select("id")
      .single()

    if (error || !plan) {
      log.error({ err: String(error) }, "Error creating development plan")
      return NextResponse.json({ error: "Failed to create plan" }, { status: 500 })
    }

    // Insert action items if provided
    if (actions && actions.length > 0) {
      await adminSupabase
        .from("development_plan_actions")
        .insert(actions.map((action) => ({ ...action, plan_id: plan.id })))
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "development_plan",
        entityId: plan.id,
        newValues: { user_id: planData.user_id, title: planData.title, focus_area: planData.focus_area },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/development-plans" },
      },
      { failOpen: true }
    )

    // Return full plan with actions
    const { data: fullPlan } = await adminSupabase
      .from("development_plans")
      .select("*, actions:development_plan_actions(id, title, description, status, due_date, completed_at, created_at)")
      .eq("id", plan.id)
      .single()

    return NextResponse.json({ data: fullPlan, message: "Development plan created" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/performance/development-plans")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-development-plans:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = UpdatePlanSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { id, ...updates } = parsed.data

    const { data: existing } = await adminSupabase
      .from("development_plans")
      .select("id, user_id, status")
      .eq("id", id)
      .maybeSingle<{ id: string; user_id: string; status: string }>()

    if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

    // Only the employee themselves, their manager, or admin can update
    if (existing.user_id !== user.id) {
      const [{ data: profile }, { data: targetProfile }] = await Promise.all([
        supabase
          .from("profiles")
          .select("role, department, is_department_lead, lead_departments")
          .eq("id", user.id)
          .single<ProfileRow>(),
        supabase
          .from("profiles")
          .select("department")
          .eq("id", existing.user_id)
          .maybeSingle<{ department?: string | null }>(),
      ])
      if (!canManageUser(await getRequestScope(), profile, targetProfile?.department)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const completedAt =
      updates.status === "completed" && existing.status !== "completed" ? new Date().toISOString() : undefined

    const { data: plan, error } = await adminSupabase
      .from("development_plans")
      .update({
        ...updates,
        ...(completedAt ? { completed_at: completedAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*, actions:development_plan_actions(id, title, description, status, due_date, completed_at, created_at)")
      .single()

    if (error || !plan) {
      log.error({ err: String(error) }, "Error updating development plan")
      return NextResponse.json({ error: "Failed to update plan" }, { status: 500 })
    }

    return NextResponse.json({ data: plan, message: "Development plan updated" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/hr/performance/development-plans")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
