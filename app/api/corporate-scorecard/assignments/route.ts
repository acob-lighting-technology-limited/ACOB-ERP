import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("corporate-scorecard-assignments")

const CreateSchema = z.object({
  kpi_id: z.string().uuid(),
  department: z.string().trim().min(1, "Department is required").max(200),
  role: z.enum(["core", "support"]),
  target_value: z.number().nonnegative().nullable().optional(),
  target_unit: z.string().trim().max(50).nullable().optional(),
  department_target: z.string().trim().max(2000).nullable().optional(),
  proposed_action: z.string().trim().max(2000).nullable().optional(),
})

/**
 * POST /api/corporate-scorecard/assignments
 *
 * Adds a department to a KPI's RACI grid. Exists for the departments the
 * source workbook left unmapped (Logistics, Monitoring & Evaluation,
 * Executive Management, SIWES) — the schema always supported any
 * free-text department, this is the UI to actually use that later.
 * RLS restricts writes to admins or that department's own lead.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`corporate-scorecard-assignment-create:${getClientId(request)}`, {
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

  const parsed = CreateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Validation failed", ApiErrorCode.VALIDATION_ERROR, 400)
  }

  const { data, error } = await supabase.from("kpi_assignments").insert(parsed.data).select().single()

  if (error) {
    log.error({ err: error.message, kpiId: parsed.data.kpi_id }, "Failed to create KPI assignment")
    if (error.code === "23505") {
      return apiError("This department is already assigned to this KPI", ApiErrorCode.CONFLICT, 409)
    }
    return apiError(
      error.code === "42501" ? "You can only assign your own department" : error.message || "Failed to create",
      ApiErrorCode.DATABASE_ERROR,
      error.code === "42501" ? 403 : 500
    )
  }

  return NextResponse.json({ data }, { status: 201 })
}
