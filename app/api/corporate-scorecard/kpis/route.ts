import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("corporate-scorecard-kpis")

type KpiAssignmentRow = {
  role: "core" | "support"
  corporate_kpis: {
    id: string
    source_sn: number
    perspective: string
    strategic_objective: string
    measure: string
    target_text: string
  } | null
}

/**
 * GET /api/corporate-scorecard/kpis?department=X
 *
 * The KPIs a department may tag a task to: everything it is CORE or SUPPORT
 * on, per the RACI grid, grouped by perspective/objective. Without a
 * department filter, every task-creation surface would offer all 61 KPIs —
 * unusable, and meaningless for a department that has no role on most of them.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`corporate-scorecard-kpis:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const department = request.nextUrl.searchParams.get("department")
  if (!department) {
    return NextResponse.json({ data: [] })
  }

  const { data, error } = await supabase
    .from("kpi_assignments")
    .select(
      `role, corporate_kpis!inner (
        id, source_sn, perspective, strategic_objective, measure, target_text
      )`
    )
    .eq("department", department)
    .eq("corporate_kpis.is_archived", false)
    .returns<KpiAssignmentRow[]>()

  if (error) {
    log.error({ err: error.message }, "Failed to load department KPIs")
    return apiError("Failed to load KPIs", ApiErrorCode.DATABASE_ERROR, 500)
  }

  const rows = (data || [])
    .filter((row) => row.corporate_kpis)
    .map((row) => ({
      id: row.corporate_kpis!.id,
      perspective: row.corporate_kpis!.perspective,
      strategic_objective: row.corporate_kpis!.strategic_objective,
      measure: row.corporate_kpis!.measure,
      target_text: row.corporate_kpis!.target_text,
      role: row.role,
    }))
    .sort((a, b) => {
      if (a.perspective !== b.perspective) return a.perspective.localeCompare(b.perspective)
      if (a.strategic_objective !== b.strategic_objective) {
        return a.strategic_objective.localeCompare(b.strategic_objective)
      }
      // CORE first within an objective, so the department's own targets lead.
      if (a.role !== b.role) return a.role === "core" ? -1 : 1
      return a.measure.localeCompare(b.measure)
    })

  return NextResponse.json({ data: rows })
}
