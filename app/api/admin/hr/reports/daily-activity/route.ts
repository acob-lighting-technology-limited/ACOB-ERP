import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { computeDailyTotals } from "@/lib/hr/daily-report"

const log = logger("admin-hr-daily-activity")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-daily-activity:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const depts = getScopedDepartments(scope)
    const { searchParams } = request.nextUrl
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const userId = searchParams.get("user_id")
    const status = searchParams.get("status")

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Resolve the set of user IDs visible to this admin/lead
    let scopedUserIds: string[] | null = null
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ reports: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ reports: [] })
    }

    let query = dataClient
      .from("daily_reports")
      .select(
        "id, user_id, report_date, status, submitted_at, acknowledged_by, acknowledged_at, daily_report_tasks(id, description, status, task_type, comments, position)"
      )
      .order("report_date", { ascending: false })
      .limit(500)

    if (startDate) query = query.gte("report_date", startDate)
    if (endDate) query = query.lte("report_date", endDate)
    if (status) query = query.eq("status", status)
    if (userId) {
      if (scopedUserIds !== null && !scopedUserIds.includes(userId)) return NextResponse.json({ reports: [] })
      query = query.eq("user_id", userId)
    } else if (scopedUserIds !== null) {
      query = query.in("user_id", scopedUserIds)
    }

    const { data, error } = await query
    if (error) {
      log.error("Failed to fetch daily reports", error)
      return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
    }

    const rows = data ?? []
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
    const profileRows =
      userIds.length > 0
        ? (
            await dataClient
              .from("profiles")
              .select("id, full_name, first_name, last_name, department")
              .in("id", userIds)
          ).data ?? []
        : []
    const profileMap = new Map<string, { full_name?: string; first_name?: string; last_name?: string; department?: string }>()
    for (const p of profileRows) profileMap.set(p.id, p)

    const reports = rows.map((r) => {
      const p = profileMap.get(r.user_id)
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"
      const tasks = ((r.daily_report_tasks ?? []) as {
        id: string
        description: string
        status: string
        task_type: string | null
        comments: string | null
        position: number
      }[])
        .slice()
        .sort((a, b) => a.position - b.position)
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: name,
        department: p?.department ?? "",
        report_date: r.report_date,
        status: r.status,
        acknowledged: Boolean(r.acknowledged_at),
        acknowledged_at: r.acknowledged_at,
        task_count: tasks.length,
        tasks,
        ...computeDailyTotals(tasks),
      }
    })

    return NextResponse.json({ reports })
  } catch (error) {
    log.error("Error in GET /api/admin/hr/reports/daily-activity", error)
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
