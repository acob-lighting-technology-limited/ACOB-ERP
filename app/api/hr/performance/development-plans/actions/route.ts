import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("development-plan-actions")

const UpdateActionSchema = z.object({
  id: z.string().uuid("Invalid action ID"),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
})

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-development-plans-actions:${getClientId(request)}`, {
    limit: 20,
    windowSec: 60,
  })
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
    const parsed = UpdateActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { id, status, ...rest } = parsed.data

    // Verify the user owns the plan this action belongs to
    const { data: action } = await adminSupabase
      .from("development_plan_actions")
      .select("id, plan_id, status")
      .eq("id", id)
      .maybeSingle<{ id: string; plan_id: string; status: string }>()

    if (!action) return NextResponse.json({ error: "Action not found" }, { status: 404 })

    const { data: plan } = await adminSupabase
      .from("development_plans")
      .select("user_id")
      .eq("id", action.plan_id)
      .maybeSingle<{ user_id: string }>()

    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

    // Only the employee or an admin can update action status
    if (plan.user_id !== user.id) {
      const actionScope = await getRequestScope()
      const isGlobalAdmin = actionScope?.isAdminLike === true && actionScope.scopeMode !== "lead"
      if (!isGlobalAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const completedAt = status === "completed" && action.status !== "completed" ? new Date().toISOString() : undefined

    const { data: updated, error } = await adminSupabase
      .from("development_plan_actions")
      .update({
        ...rest,
        ...(status ? { status } : {}),
        ...(completedAt ? { completed_at: completedAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single()

    if (error || !updated) {
      log.error({ err: String(error) }, "Error updating plan action")
      return NextResponse.json({ error: "Failed to update action" }, { status: 500 })
    }

    // Recalculate plan progress
    const { data: allActions } = await adminSupabase
      .from("development_plan_actions")
      .select("status")
      .eq("plan_id", action.plan_id)

    const total = allActions?.length || 0
    const done = (allActions || []).filter((a) => a.status === "completed").length
    const progress = total > 0 ? Math.round((done / total) * 100) : 0

    await adminSupabase
      .from("development_plans")
      .update({ progress_pct: progress, updated_at: new Date().toISOString() })
      .eq("id", action.plan_id)

    return NextResponse.json({ data: updated, message: "Action updated" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/hr/performance/development-plans/actions")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
