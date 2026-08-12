import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { computeIndividualPerformanceScore } from "@/lib/performance/scoring"

type ProfileRow = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type AttendanceRow = {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string | null
}

type ReviewRow = {
  id: string
  created_at: string
  status: string | null
  final_score: number | null
}

type GoalRow = {
  id: string
  department?: string | null
  approval_status: string | null
  status: string | null
}

export type IndividualPmsScore = Awaited<ReturnType<typeof computeIndividualPerformanceScore>>

export type ReviewCycleOption = {
  id: string
  name: string
  startDate: string
  endDate: string
  status: string
  reviewType: string | null
}

export async function getCurrentUserPmsData(cycleId?: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, department")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>()

  const [{ data: goals }, { data: latestReview }, { data: cycleRows }] = await Promise.all([
    profile?.department
      ? supabase
          .from("goals_objectives")
          .select("id, department, approval_status, status")
          .eq("department", profile.department)
          .returns<GoalRow[]>()
      : Promise.resolve({ data: [] as GoalRow[] }),
    supabase
      .from("performance_reviews")
      .select("id, created_at, status, final_score")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<ReviewRow[]>(),
    supabase
      .from("review_cycles")
      .select("id, name, start_date, end_date, status, review_type")
      .order("start_date", { ascending: false }),
  ])

  const score = await computeIndividualPerformanceScore(supabase, { userId: user.id, cycleId })

  let attendanceQuery = supabase
    .from("attendance_records")
    .select("id, date, clock_in, clock_out, total_hours, status")
    .eq("user_id", user.id)
    .order("date", { ascending: false })

  if (score.cycle_start_date && score.cycle_end_date) {
    attendanceQuery = attendanceQuery.gte("date", score.cycle_start_date).lte("date", score.cycle_end_date)
  } else {
    attendanceQuery = attendanceQuery.limit(100)
  }

  const { data: attendance } = await attendanceQuery.returns<AttendanceRow[]>()

  const goalRows = goals || []
  const recentAttendance = attendance || []
  const cycles: ReviewCycleOption[] = (cycleRows || []).map((c) => ({
    id: c.id,
    name: c.name || "Review Cycle",
    startDate: c.start_date,
    endDate: c.end_date,
    status: c.status || "closed",
    reviewType: c.review_type ?? null,
  }))

  return {
    profile,
    score,
    cycles,
    activeCycleId: score.cycle_id,
    cycle: {
      id: score.cycle_id,
      name: score.cycle_name || "Active Review Cycle",
      startDate: score.cycle_start_date,
      endDate: score.cycle_end_date,
    },
    goalSummary: {
      total: goalRows.length,
      approved: goalRows.filter((goal) => goal.approval_status === "approved").length,
      completed: goalRows.filter((goal) => goal.status === "completed").length,
    },
    attendance: {
      recent: recentAttendance,
      presentDays: recentAttendance.filter((record) =>
        ["present", "wfh", "remote"].includes(String(record.status || "").toLowerCase())
      ).length,
      trackedDays: recentAttendance.length,
    },
    latestReview: latestReview?.[0] ?? null,
  }
}
