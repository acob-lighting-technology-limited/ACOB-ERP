import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("corporate-scorecard-assignment")

const UpdateSchema = z.object({
  target_value: z.number().nonnegative().nullable().optional(),
  target_unit: z.string().trim().max(50).nullable().optional(),
  department_target: z.string().trim().max(2000).nullable().optional(),
  proposed_action: z.string().trim().max(2000).nullable().optional(),
})

/**
 * PATCH /api/corporate-scorecard/assignments/[id]
 *
 * A department confirming its own numeric target and proposed action — the
 * "yellow cell" fields from the source workbook. RLS restricts this to the
 * assignment's own department lead or an admin; this route trusts that and
 * just persists what's sent.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params

  const rl = await rateLimit(`corporate-scorecard-assignment-write:${getClientId(request)}`, {
    limit: 30,
    windowSec: 60,
  })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const parsed = UpdateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Validation failed", ApiErrorCode.VALIDATION_ERROR, 400)
  }

  const { data, error } = await supabase
    .from("kpi_assignments")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single()

  if (error) {
    log.error({ err: error.message, id: params.id }, "Failed to update KPI assignment")
    // RLS denial surfaces as a plain "no rows" error from PostgREST, not a
    // permission error — translate it so the department lead understands why.
    return apiError(
      error.code === "PGRST116"
        ? "You can only edit your own department's targets"
        : error.message || "Failed to update",
      ApiErrorCode.DATABASE_ERROR,
      error.code === "PGRST116" ? 403 : 500
    )
  }

  return NextResponse.json({ data })
}

/**
 * DELETE /api/corporate-scorecard/assignments/[id]
 *
 * Removes a department from a KPI's RACI grid — for correcting a
 * mis-mapping, same scope as PATCH (admin or that department's own lead).
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params

  const rl = await rateLimit(`corporate-scorecard-assignment-write:${getClientId(request)}`, {
    limit: 30,
    windowSec: 60,
  })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const { data, error } = await supabase.from("kpi_assignments").delete().eq("id", params.id).select().single()

  if (error) {
    log.error({ err: error.message, id: params.id }, "Failed to delete KPI assignment")
    return apiError(
      error.code === "PGRST116"
        ? "You can only remove your own department's assignments"
        : error.message || "Failed to delete",
      ApiErrorCode.DATABASE_ERROR,
      error.code === "PGRST116" ? 403 : 500
    )
  }

  return NextResponse.json({ data })
}
