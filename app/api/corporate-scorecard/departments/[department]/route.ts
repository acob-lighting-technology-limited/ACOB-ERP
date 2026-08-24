import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { computeAttainment, type Direction, type MeasureType } from "@/lib/corporate-scorecard/attainment"

const log = logger("corporate-scorecard-department")

type AssignmentRow = {
  id: string
  kpi_id: string
  role: "core" | "support"
  target_value: number | null
  target_unit: string | null
  department_target: string | null
  proposed_action: string | null
  corporate_kpis: {
    id: string
    source_sn: number
    perspective: string
    strategic_objective: string
    measure: string
    target_text: string
    measure_type: MeasureType
    direction: Direction
  } | null
}

type ActualRow = {
  kpi_id: string
  actual_value: number | null
  milestones_completed: number | null
  milestones_total: number | null
  note: string | null
  recorded_at: string
}

/**
 * GET /api/corporate-scorecard/departments/[department]
 *
 * One department's cascade: every KPI it is CORE or SUPPORT on, each with its
 * own numeric target, the most recent recorded actual, and the attainment
 * computed from those two — the same formula the register, this page and the
 * MD rollup all share, so none of them can disagree about a number.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ department: string }> }) {
  const params = await props.params
  const department = decodeURIComponent(params.department)

  const rl = await rateLimit(`corporate-scorecard-department:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const { data: assignments, error: assignmentError } = await supabase
    .from("kpi_assignments")
    .select(
      `id, kpi_id, role, target_value, target_unit, department_target, proposed_action,
       corporate_kpis!inner (
         id, source_sn, perspective, strategic_objective, measure, target_text, measure_type, direction
       )`
    )
    .eq("department", department)
    .eq("corporate_kpis.is_archived", false)
    .returns<AssignmentRow[]>()

  if (assignmentError) {
    log.error({ err: assignmentError.message, department }, "Failed to load department KPI assignments")
    return apiError("Failed to load this department's scorecard", ApiErrorCode.DATABASE_ERROR, 500)
  }

  const kpiIds = (assignments || []).map((a) => a.kpi_id)

  // The most recent actual per KPI for this department. Fetched in one pass
  // (newest first) and reduced client-side rather than N queries.
  const { data: actualRows } =
    kpiIds.length > 0
      ? await supabase
          .from("kpi_actuals")
          .select("kpi_id, actual_value, milestones_completed, milestones_total, note, recorded_at")
          .eq("department", department)
          .in("kpi_id", kpiIds)
          .order("recorded_at", { ascending: false })
          .returns<ActualRow[]>()
      : { data: [] as ActualRow[] }

  const latestActualByKpi = new Map<string, ActualRow>()
  for (const row of actualRows || []) {
    if (!latestActualByKpi.has(row.kpi_id)) latestActualByKpi.set(row.kpi_id, row)
  }

  const data = (assignments || [])
    .filter((a) => a.corporate_kpis)
    .map((a) => {
      const kpi = a.corporate_kpis!
      const latestActual = latestActualByKpi.get(a.kpi_id) ?? null
      const attainment = computeAttainment({
        measureType: kpi.measure_type,
        direction: kpi.direction,
        targetValue: a.target_value,
        actualValue: latestActual?.actual_value ?? null,
        milestonesCompleted: latestActual?.milestones_completed ?? null,
        milestonesTotal: latestActual?.milestones_total ?? null,
      })

      return {
        assignment_id: a.id,
        kpi_id: kpi.id,
        source_sn: kpi.source_sn,
        perspective: kpi.perspective,
        strategic_objective: kpi.strategic_objective,
        measure: kpi.measure,
        target_text: kpi.target_text,
        measure_type: kpi.measure_type,
        direction: kpi.direction,
        role: a.role,
        target_value: a.target_value,
        target_unit: a.target_unit,
        department_target: a.department_target,
        proposed_action: a.proposed_action,
        latest_actual: latestActual,
        raw_pct: attainment.rawPct,
        capped_pct: attainment.cappedPct,
      }
    })
    .sort((a, b) => a.source_sn - b.source_sn)

  return NextResponse.json({ data, department })
}
