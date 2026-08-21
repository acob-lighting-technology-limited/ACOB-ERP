import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

export const dynamic = "force-dynamic"
const log = logger("project-plans-api")

const PlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required"),
  description: z.string().trim().max(5000).optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
})

const UpdatePlanSchema = PlanSchema.partial().extend({
  plan_id: z.string().uuid(),
})

/**
 * Implementation plans for a project.
 *
 * A plan is purely a folder for tasks — it has no weight and contributes
 * nothing to scoring on its own. Its tasks are ordinary rows in public.tasks
 * carrying plan_id, so they count once, in the assignee's KPI and in the
 * project's progress alike.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`project-plans:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const { data, error } = await supabase
    .from("implementation_plans")
    .select("*")
    .eq("project_id", params.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    log.error({ err: error.message }, "Failed to load implementation plans")
    return apiError("Failed to load implementation plans", ApiErrorCode.DATABASE_ERROR, 500)
  }

  return NextResponse.json({ data: data || [] })
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`project-plans-write:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const parsed = PlanSchema.safeParse(await request.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Validation failed", ApiErrorCode.VALIDATION_ERROR, 400)
  }

  const { data, error } = await supabase
    .from("implementation_plans")
    .insert({
      project_id: params.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      sort_order: parsed.data.sort_order ?? 0,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error.message }, "Failed to create implementation plan")
    return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 400)
  }

  return NextResponse.json({ data })
}

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const parsed = UpdatePlanSchema.safeParse(await request.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Validation failed", ApiErrorCode.VALIDATION_ERROR, 400)
  }

  const { plan_id, ...changes } = parsed.data
  const { data, error } = await supabase
    .from("implementation_plans")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", plan_id)
    .eq("project_id", params.id)
    .select()
    .single()

  if (error) {
    log.error({ err: error.message }, "Failed to update implementation plan")
    return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 400)
  }

  return NextResponse.json({ data })
}

/**
 * Deleting a plan does not delete its tasks — plan_id is ON DELETE SET NULL,
 * so the work survives and simply becomes ungrouped. Losing a folder must
 * never quietly destroy scored work an employee has already been rated on.
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const planId = new URL(request.url).searchParams.get("plan_id")
  if (!planId) return apiError("plan_id query param is required", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)

  const { error } = await supabase.from("implementation_plans").delete().eq("id", planId).eq("project_id", params.id)

  if (error) {
    log.error({ err: error.message }, "Failed to delete implementation plan")
    return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 400)
  }

  return NextResponse.json({ data: { id: planId } })
}
