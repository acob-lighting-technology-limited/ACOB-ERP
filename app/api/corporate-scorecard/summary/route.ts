import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import {
  computeAttainment,
  ragStatus,
  rollupByPerspective,
  averageCappedPct,
  type Direction,
  type MeasureType,
} from "@/lib/corporate-scorecard/attainment"

const log = logger("corporate-scorecard-summary")

type AssignmentRow = {
  kpi_id: string
  department: string
  role: "core" | "support"
  target_value: number | null
  corporate_kpis: {
    perspective: string
    strategic_objective: string
    measure_type: MeasureType
    direction: Direction
  } | null
}

type ActualRow = {
  kpi_id: string
  department: string
  actual_value: number | null
  milestones_completed: number | null
  milestones_total: number | null
  recorded_at: string
}

/**
 * GET /api/corporate-scorecard/summary
 *
 * The MD view: company-wide attainment by perspective, and by department —
 * CORE ownership only, per the agreed rule that SUPPORT work does not affect
 * a department's own scorecard number.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`corporate-scorecard-summary:${getClientId(request)}`, { limit: 30, windowSec: 60 })
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
      `kpi_id, department, role, target_value,
       corporate_kpis!inner ( perspective, strategic_objective, measure_type, direction )`
    )
    .eq("role", "core")
    .eq("corporate_kpis.is_archived", false)
    .returns<AssignmentRow[]>()

  if (assignmentError) {
    log.error({ err: assignmentError.message }, "Failed to load assignments for summary")
    return apiError("Failed to load the scorecard summary", ApiErrorCode.DATABASE_ERROR, 500)
  }

  const rows = assignments || []
  if (rows.length === 0) {
    return NextResponse.json({ data: { perspectives: [], companyPct: null, departments: [] } })
  }

  const kpiIds = Array.from(new Set(rows.map((r) => r.kpi_id)))
  const { data: actualRows } = await supabase
    .from("kpi_actuals")
    .select("kpi_id, department, actual_value, milestones_completed, milestones_total, recorded_at")
    .in("kpi_id", kpiIds)
    .order("recorded_at", { ascending: false })
    .returns<ActualRow[]>()

  // Most recent actual per (kpi, department) pair.
  const latestByKey = new Map<string, ActualRow>()
  for (const row of actualRows || []) {
    const key = `${row.kpi_id}:${row.department}`
    if (!latestByKey.has(key)) latestByKey.set(key, row)
  }

  const perKpiRows = rows.map((row) => {
    const kpi = row.corporate_kpis!
    const latest = latestByKey.get(`${row.kpi_id}:${row.department}`) ?? null
    const attainment = computeAttainment({
      measureType: kpi.measure_type,
      direction: kpi.direction,
      targetValue: row.target_value,
      actualValue: latest?.actual_value ?? null,
      milestonesCompleted: latest?.milestones_completed ?? null,
      milestonesTotal: latest?.milestones_total ?? null,
    })
    return {
      department: row.department,
      perspective: kpi.perspective,
      strategicObjective: kpi.strategic_objective,
      cappedPct: attainment.cappedPct,
    }
  })

  const perspectives = rollupByPerspective(
    perKpiRows.map((r) => ({
      perspective: r.perspective,
      strategicObjective: r.strategicObjective,
      cappedPct: r.cappedPct,
    }))
  )
  const companyPct = averageCappedPct(perspectives.map((p) => p.attainmentPct))

  const byDepartment = new Map<string, number[]>()
  for (const row of perKpiRows) {
    const bucket = byDepartment.get(row.department) || []
    if (row.cappedPct != null) bucket.push(row.cappedPct)
    byDepartment.set(row.department, bucket)
  }

  const departments = Array.from(byDepartment.entries())
    .map(([department, values]) => {
      const attainmentPct = averageCappedPct(values)
      return {
        department,
        attainmentPct,
        status: attainmentPct != null ? ragStatus(attainmentPct) : null,
        recordedKpiCount: values.length,
        coreKpiCount: rows.filter((r) => r.department === department).length,
      }
    })
    .sort((a, b) => (b.attainmentPct ?? -1) - (a.attainmentPct ?? -1))

  return NextResponse.json({ data: { perspectives, companyPct, departments } })
}
