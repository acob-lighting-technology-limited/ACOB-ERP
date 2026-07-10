import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { fetchWeeklyReportLockState } from "@/lib/weekly-report-lock"

export const dynamic = "force-dynamic"

// Whether the meeting reminder form is locked for this office week (mirrors
// the weekly_report_lock_state RPC used by the reports lock UI).
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const week = Number(request.nextUrl.searchParams.get("week"))
  const year = Number(request.nextUrl.searchParams.get("year"))
  if (!Number.isFinite(week) || !Number.isFinite(year)) {
    return NextResponse.json({ error: "Invalid week/year" }, { status: 400 })
  }

  const state = await fetchWeeklyReportLockState(supabase, week, year)
  return NextResponse.json(state)
}
