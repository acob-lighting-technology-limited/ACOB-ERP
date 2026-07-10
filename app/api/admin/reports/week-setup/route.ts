import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

const SaveMeetingWindowSchema = z.object({
  weekNumber: z.number(),
  yearNumber: z.number(),
  meetingDate: z.string().optional().nullable(),
  meetingTime: z.string(),
  graceHours: z.number(),
})

// Meeting window + KSS roster snapshot for a given office week.
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const weekNumber = Number(request.nextUrl.searchParams.get("week"))
  const yearNumber = Number(request.nextUrl.searchParams.get("year"))
  if (!Number.isFinite(weekNumber) || !Number.isFinite(yearNumber)) {
    return NextResponse.json({ error: "Invalid week/year" }, { status: 400 })
  }

  const db = getServiceRoleClientOrFallback(supabase)
  const [meetingWindowResult, rosterResult] = await Promise.all([
    db
      .from("weekly_report_meeting_windows")
      .select("meeting_time")
      .eq("week_number", weekNumber)
      .eq("year", yearNumber)
      .maybeSingle(),
    db
      .from("kss_weekly_roster")
      .select("id, department, presenter_id, presenter_name")
      .eq("meeting_week", weekNumber)
      .eq("meeting_year", yearNumber)
      .maybeSingle(),
  ])
  if (meetingWindowResult.error) return NextResponse.json({ error: meetingWindowResult.error.message }, { status: 500 })
  if (rosterResult.error) return NextResponse.json({ error: rosterResult.error.message }, { status: 500 })

  return NextResponse.json({
    rosterId: typeof rosterResult.data?.id === "string" ? rosterResult.data.id : null,
    meetingTime:
      typeof meetingWindowResult.data?.meeting_time === "string" ? meetingWindowResult.data.meeting_time : "08:30",
    kssDepartment:
      typeof rosterResult.data?.department === "string" && rosterResult.data.department.trim()
        ? normalizeDepartmentName(rosterResult.data.department)
        : "none",
    kssPresenterId:
      typeof rosterResult.data?.presenter_id === "string" && rosterResult.data.presenter_id
        ? rosterResult.data.presenter_id
        : "none",
    kssPresenterName:
      typeof rosterResult.data?.presenter_name === "string" && rosterResult.data.presenter_name.trim()
        ? rosterResult.data.presenter_name.trim()
        : "",
  })
}

// Saves the meeting date/grace-hours window (upsert on first save, update after).
export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = SaveMeetingWindowSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { weekNumber, yearNumber, meetingDate, meetingTime, graceHours } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  const { error } = await db.from("weekly_report_meeting_windows").upsert(
    {
      week_number: weekNumber,
      year: yearNumber,
      meeting_date: meetingDate,
      meeting_time: meetingTime,
      grace_hours: graceHours,
      updated_by: scope.userId,
      created_by: scope.userId,
    },
    { onConflict: "week_number,year" }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
