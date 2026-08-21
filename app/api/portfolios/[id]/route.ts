import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

export const dynamic = "force-dynamic"
const log = logger("portfolio-detail-api")

const UpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  code: z.string().trim().max(32).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(["active", "on_hold", "closed"]).optional(),
})

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`portfolio-write:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    .from("portfolios")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single()

  if (error) {
    log.error({ err: error.message }, "Failed to update portfolio")
    return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 400)
  }

  return NextResponse.json({ data })
}

/**
 * DELETE /api/portfolios/[id]
 *
 * Refuses while projects still point at it. Deleting would only detach them
 * (the FK is ON DELETE SET NULL), quietly emptying a portfolio someone is
 * reporting on — better to make the caller move the projects deliberately.
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`portfolio-write:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const { count } = await supabase
    .from("projects")
    .select("id", { head: true, count: "exact" })
    .eq("portfolio_id", params.id)

  if (count && count > 0) {
    return apiError(
      `This portfolio still holds ${count} project${count === 1 ? "" : "s"}. Move them to another portfolio first.`,
      ApiErrorCode.CONFLICT,
      409
    )
  }

  const { error } = await supabase.from("portfolios").delete().eq("id", params.id)
  if (error) {
    log.error({ err: error.message }, "Failed to delete portfolio")
    return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 400)
  }

  return NextResponse.json({ data: { id: params.id } })
}
