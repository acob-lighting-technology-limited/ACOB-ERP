import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("corporate-scorecard-register")

type KpiRow = {
  id: string
  source_sn: number
  perspective: string
  strategic_priority: string
  strategic_objective: string
  measure: string
  target_text: string
  measure_type: string
  direction: string
}

type AssignmentRow = {
  id: string
  kpi_id: string
  department: string
  role: "core" | "support"
}

/**
 * GET /api/corporate-scorecard/register
 *
 * The full 61-KPI master register with its RACI ownership attached — the
 * read-only reference view. Attainment is deliberately not computed here:
 * this is "what the plan says", the department cascade view is "how we're
 * doing against it".
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`corporate-scorecard-register:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const [{ data: kpis, error: kpiError }, { data: assignments, error: assignmentError }] = await Promise.all([
    supabase
      .from("corporate_kpis")
      .select(
        "id, source_sn, perspective, strategic_priority, strategic_objective, measure, target_text, measure_type, direction"
      )
      .eq("is_archived", false)
      .order("source_sn")
      .returns<KpiRow[]>(),
    supabase.from("kpi_assignments").select("id, kpi_id, department, role").returns<AssignmentRow[]>(),
  ])

  if (kpiError || assignmentError) {
    log.error({ err: kpiError?.message || assignmentError?.message }, "Failed to load corporate scorecard register")
    return apiError("Failed to load the corporate scorecard", ApiErrorCode.DATABASE_ERROR, 500)
  }

  const assignmentsByKpi = new Map<string, AssignmentRow[]>()
  for (const row of assignments || []) {
    const bucket = assignmentsByKpi.get(row.kpi_id) || []
    bucket.push(row)
    assignmentsByKpi.set(row.kpi_id, bucket)
  }

  const data = (kpis || []).map((kpi) => {
    const rows = assignmentsByKpi.get(kpi.id) || []
    return {
      ...kpi,
      core_departments: rows.filter((r) => r.role === "core").map((r) => r.department),
      support_departments: rows.filter((r) => r.role === "support").map((r) => r.department),
      assignments: rows.map((r) => ({ id: r.id, department: r.department, role: r.role })),
    }
  })

  return NextResponse.json({ data })
}
