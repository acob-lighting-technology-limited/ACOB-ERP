import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { resolveEffectiveMeetingDateIso } from "@/lib/reports/meeting-date"

export const dynamic = "force-dynamic"

// Resolves the effective meeting date (ISO) for a given office week/year via
// the weekly_report_effective_meeting_date RPC.
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

  try {
    const meetingDate = await resolveEffectiveMeetingDateIso(supabase, week, year)
    return NextResponse.json({ meetingDate })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve meeting date" },
      { status: 500 }
    )
  }
}
