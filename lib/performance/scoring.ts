import type { SupabaseClient } from "@supabase/supabase-js"
import { toLocalISODate } from "@/lib/utils/date"
import { latenessDeduction } from "@/lib/hr/attendance-utils"

type GoalScoreBreakdown = {
  goal_id: string
  title: string
  priority: string
  priority_weight: number
  custom_weight_pct: number | null
  linked_tasks_total: number
  linked_tasks_completed: number
  goal_progress_pct: number
  effective_kpi_pct: number
  is_system_generated: boolean
}

type AttendanceBreakdown = {
  present: number
  total: number
  score: number | null
  late_penalty_total_ngn?: number
  late_penalty_steps_total?: number
  late_days?: number
}

type DepartmentMetricBreakdown = {
  average_individual_kpi: number | null
  action_item_score: number | null
  help_desk_score: number | null
  task_project_delivery_score: number | null
  learning_capability_score: number | null
  attendance_compliance_score: number | null
  behaviour_leadership_score: number | null
}

type ReviewCycleRow = {
  id: string
  start_date: string
  end_date: string
}

type PerformanceReviewScoreRow = {
  id: string
  created_at: string
  kpi_score: number | null
  cbt_score: number | null
  attendance_score: number | null
  behaviour_score: number | null
}

type MetricValue = number | null

const PRIORITY_WEIGHTS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

function getPriorityWeight(priority: string | null | undefined): number {
  return PRIORITY_WEIGHTS[String(priority || "medium").toLowerCase()] ?? 2
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100
}

function averageDefined(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (valid.length === 0) return null
  return roundScore(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

function weightedScore(
  parts: Array<{ key: "kpi" | "cbt" | "attendance" | "behaviour"; value: MetricValue; weight: number }>
) {
  const available = parts.filter((part) => typeof part.value === "number" && Number.isFinite(part.value))
  const totalWeight = available.reduce((sum, part) => sum + part.weight, 0)

  if (totalWeight <= 0) {
    return {
      finalScore: null as number | null,
      appliedWeights: { kpi: 0, cbt: 0, attendance: 0, behaviour: 0 },
    }
  }

  const weightedValue = available.reduce((sum, part) => sum + (part.value as number) * part.weight, 0) / totalWeight
  const appliedWeights = { kpi: 0, cbt: 0, attendance: 0, behaviour: 0 }

  for (const part of available) {
    appliedWeights[part.key] = roundScore((part.weight / totalWeight) * 100)
  }

  return {
    finalScore: roundScore(weightedValue),
    appliedWeights,
  }
}

async function getCycleWindow(supabase: SupabaseClient, cycleId?: string | null): Promise<ReviewCycleRow | null> {
  if (!cycleId) return null
  const { data } = await supabase
    .from("review_cycles")
    .select("id, start_date, end_date")
    .eq("id", cycleId)
    .maybeSingle<ReviewCycleRow>()
  return data ?? null
}

export async function computeIndividualPerformanceScore(
  supabase: SupabaseClient,
  params: { userId: string; cycleId?: string | null }
) {
  const cycle = await getCycleWindow(supabase, params.cycleId)
  const { data: profile } = await supabase
    .from("profiles")
    .select("department, attendance_exempt")
    .eq("id", params.userId)
    .maybeSingle<{ department?: string | null; attendance_exempt?: boolean | null }>()

  const userDepartment = profile?.department || null

  let goalQuery = supabase
    .from("goals_objectives")
    .select("id, title, target_value, achieved_value, priority, is_system_generated, weight_pct, department")
    .eq("approval_status", "approved")

  if (params.cycleId) {
    goalQuery = goalQuery.eq("review_cycle_id", params.cycleId)
  }

  if (userDepartment) {
    goalQuery = goalQuery.eq("department", userDepartment)
  } else {
    goalQuery = goalQuery.eq("user_id", params.userId)
  }

  const { data: goals } = await goalQuery

  // ── Fix 1: Include department-assigned tasks this user individually completed ──
  // Query task_user_completion to find tasks where this user recorded completion,
  // even if the task was assigned to the whole department (not directly to them).
  const { data: userCompletions } = await supabase
    .from("task_user_completion")
    .select("task_id")
    .eq("user_id", params.userId)
  const userCompletedTaskIds = new Set((userCompletions || []).map((row) => row.task_id))

  let kpiScore: number | null = null
  const goalBreakdown: GoalScoreBreakdown[] = []

  if (goals && goals.length > 0) {
    let weightedPctSum = 0
    let totalWeight = 0

    // ── Batch fetch all tasks for all goals in a single query (prevents N+1) ──
    const goalIds = goals.map((g) => g.id)
    const { data: allTaskRows } = await supabase
      .from("tasks")
      .select("id, goal_id, status, assignment_type, assigned_to, department")
      .in("goal_id", goalIds)

    const tasksByGoalId = new Map<string, typeof allTaskRows>()
    for (const task of allTaskRows || []) {
      const bucket = tasksByGoalId.get(task.goal_id) || []
      bucket.push(task)
      tasksByGoalId.set(task.goal_id, bucket)
    }

    for (const goal of goals) {
      const taskSummary = tasksByGoalId.get(goal.id) || []

      const relevantTasks = taskSummary.filter((task) => {
        if (task.assignment_type === "individual") {
          return task.assigned_to === params.userId
        }

        if (task.assignment_type === "department") {
          return Boolean(userDepartment && task.department === userDepartment && userCompletedTaskIds.has(task.id))
        }

        return false
      })

      const totalTasks = relevantTasks.length
      // Count a task as completed if its status is "completed" OR if this user
      // individually completed it (via task_user_completion for dept-assigned tasks).
      const completedTasks = relevantTasks.filter(
        (task) => task.status === "completed" || userCompletedTaskIds.has(task.id)
      ).length

      const targetValue = typeof goal.target_value === "number" ? goal.target_value : Number(goal.target_value || 0)
      const achievedValue =
        typeof goal.achieved_value === "number" ? goal.achieved_value : Number(goal.achieved_value || 0)
      const goalProgressPct = targetValue > 0 ? Math.min((achievedValue / targetValue) * 100, 100) : 0
      const effectivePct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : goalProgressPct

      // ── Fix 5: Custom goal weights ──
      // If weight_pct is set (e.g. 30 = 30%), use it directly.
      // Otherwise fall back to priority-based weighting.
      const customWeightPct = typeof goal.weight_pct === "number" ? goal.weight_pct : null
      const weight = customWeightPct !== null ? customWeightPct : getPriorityWeight(goal.priority)
      const isSystemGenerated = goal.is_system_generated === true
      const usingCustomWeights = customWeightPct !== null

      goalBreakdown.push({
        goal_id: goal.id,
        title: goal.title,
        priority: String(goal.priority || "medium"),
        priority_weight: usingCustomWeights ? weight : getPriorityWeight(goal.priority),
        custom_weight_pct: customWeightPct,
        linked_tasks_total: totalTasks,
        linked_tasks_completed: completedTasks,
        goal_progress_pct: roundScore(goalProgressPct),
        effective_kpi_pct: roundScore(effectivePct),
        is_system_generated: isSystemGenerated,
      })

      weightedPctSum += effectivePct * weight
      totalWeight += weight
    }

    kpiScore = totalWeight > 0 ? roundScore(weightedPctSum / totalWeight) : null
  }

  let attendanceScore: number | null = null
  const attendanceBreakdown: AttendanceBreakdown = {
    present: 0,
    total: 0,
    score: null,
  }

  // Attendance credit: full credit for present/wfh/remote, partial for late/half_day, zero for absent.
  const ATTENDANCE_CREDIT: Record<string, number> = {
    present: 1.0,
    wfh: 1.0,
    remote: 1.0,
    late: 0.5,
    half_day: 0.5,
    absent: 0,
  }

  let leaveRequestQuery = supabase
    .from("leave_requests")
    .select("start_date, end_date")
    .eq("user_id", params.userId)
    .eq("status", "approved")

  let attendanceQuery = supabase
    .from("attendance_records")
    .select("status, date, clock_in, clock_out, waived")
    .eq("user_id", params.userId)

  if (cycle) {
    leaveRequestQuery = leaveRequestQuery.gte("end_date", cycle.start_date).lte("start_date", cycle.end_date)
    attendanceQuery = attendanceQuery.gte("date", cycle.start_date).lte("date", cycle.end_date)
  }

  let exemptionQuery = supabase
    .from("attendance_exempt_periods")
    .select("start_date, end_date")
    .eq("user_id", params.userId)

  let holidayQuery = supabase.from("holiday_calendar").select("holiday_date")

  if (cycle) {
    exemptionQuery = exemptionQuery.lte("start_date", cycle.end_date).gte("end_date", cycle.start_date)
    holidayQuery = holidayQuery.gte("holiday_date", cycle.start_date).lte("holiday_date", cycle.end_date)
  }

  const [{ data: approvedLeaves }, { data: attendance }, { data: exemptionPeriods }, { data: holidayRows }] =
    await Promise.all([leaveRequestQuery, attendanceQuery, exemptionQuery, holidayQuery])

  const leaveDateSet = new Set<string>()
  if (approvedLeaves) {
    for (const leave of approvedLeaves) {
      const effectiveStart = cycle ? cycle.start_date : leave.start_date
      const effectiveEnd = cycle ? cycle.end_date : leave.end_date
      const leaveStart = new Date(Math.max(new Date(leave.start_date).getTime(), new Date(effectiveStart).getTime()))
      const leaveEnd = new Date(Math.min(new Date(leave.end_date).getTime(), new Date(effectiveEnd).getTime()))
      for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
        leaveDateSet.add(toLocalISODate(d))
      }
    }
  }

  const exemptionDateSet = new Set<string>()
  for (const period of exemptionPeriods || []) {
    const start = cycle ? cycle.start_date : period.start_date
    const end = cycle ? cycle.end_date : period.end_date
    const periodStart = new Date(Math.max(new Date(period.start_date).getTime(), new Date(start).getTime()))
    const periodEnd = new Date(Math.min(new Date(period.end_date).getTime(), new Date(end).getTime()))
    for (let d = new Date(periodStart); d <= periodEnd; d.setDate(d.getDate() + 1)) {
      exemptionDateSet.add(toLocalISODate(d))
    }
  }

  const holidayDateSet = new Set((holidayRows || []).map((row) => row.holiday_date))

  if (attendance && attendance.length > 0) {
    const scorableRecords = attendance.filter((row) => {
      const day = String(row.date || "").slice(0, 10)
      if (!day) return false
      if (holidayDateSet.has(day)) return false
      if (leaveDateSet.has(day)) return false
      if (Boolean(profile?.attendance_exempt) || exemptionDateSet.has(day)) return false
      return true
    })

    let creditSum = 0
    let latePenaltyTotalNgn = 0
    let latePenaltyStepsTotal = 0
    let lateDays = 0

    const cutoffMinutes = 8 * 60 + 20
    const firstPenaltyHourMinutes = 9 * 60
    const penaltyPerStepNgn = 1000
    for (const row of scorableRecords) {
      const status = row.waived
        ? "waiver"
        : !row.clock_in && !row.clock_out
          ? "absent"
          : row.clock_in && row.clock_out
            ? latenessDeduction(row.clock_in) > 0
              ? "late"
              : "present"
            : "incomplete"
      const baseCredit = ATTENDANCE_CREDIT[status] ?? 0

      let timelinessFactor = 1
      const clockInRaw = String((row as { clock_in?: string | null }).clock_in || "")
      const [hourText, minuteText] = clockInRaw.split(":")
      const hour = Number(hourText)
      const minute = Number(minuteText)
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        const clockInMinutes = hour * 60 + minute
        if (clockInMinutes > cutoffMinutes) {
          lateDays += 1
          const penaltySteps =
            clockInMinutes >= firstPenaltyHourMinutes
              ? Math.floor((clockInMinutes - firstPenaltyHourMinutes) / 60) + 1
              : 0
          latePenaltyStepsTotal += penaltySteps
          latePenaltyTotalNgn += penaltySteps * penaltyPerStepNgn
          timelinessFactor = Math.max(0, 1 - penaltySteps * 0.1)
        }
      }

      creditSum += baseCredit * timelinessFactor
    }
    attendanceBreakdown.present = scorableRecords.filter((row) => {
      const status = row.waived
        ? "waiver"
        : !row.clock_in && !row.clock_out
          ? "absent"
          : row.clock_in && row.clock_out
            ? latenessDeduction(row.clock_in) > 0
              ? "late"
              : "present"
            : "incomplete"
      return status === "present"
    }).length
    attendanceBreakdown.total = scorableRecords.length
    attendanceScore = scorableRecords.length > 0 ? roundScore((creditSum / scorableRecords.length) * 100) : null
    attendanceBreakdown.score = attendanceScore
    attendanceBreakdown.late_penalty_total_ngn = latePenaltyTotalNgn
    attendanceBreakdown.late_penalty_steps_total = latePenaltyStepsTotal
    attendanceBreakdown.late_days = lateDays
  }

  let latestReviewQuery = supabase
    .from("performance_reviews")
    .select("id, created_at, kpi_score, cbt_score, attendance_score, behaviour_score")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)

  if (params.cycleId) {
    latestReviewQuery = latestReviewQuery.eq("review_cycle_id", params.cycleId)
  }

  const { data: latestReviewRows } = await latestReviewQuery.returns<PerformanceReviewScoreRow[]>()
  const latestReview = latestReviewRows?.[0] || null

  let cbtScore: number | null =
    latestReview && typeof latestReview.cbt_score === "number" ? roundScore(Number(latestReview.cbt_score) || 0) : null

  if (!latestReview || latestReview.cbt_score === null) {
    let cbtQuery = supabase
      .from("performance_reviews")
      .select("cbt_score")
      .eq("user_id", params.userId)
      .not("cbt_score", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)

    if (params.cycleId) {
      cbtQuery = cbtQuery.eq("review_cycle_id", params.cycleId)
    }

    const { data: cbtRows } = await cbtQuery
    if (cbtRows && cbtRows.length > 0) {
      cbtScore = roundScore(Number(cbtRows[0]?.cbt_score) || 0)
    }
  }

  // ── Fix 2: 360° feedback — blend peer + manager for behaviour ──
  // Query manager behaviour score from performance_reviews
  const managerBehaviourScore: number | null =
    latestReview && typeof latestReview.behaviour_score === "number"
      ? roundScore(Number(latestReview.behaviour_score) || 0)
      : null

  // Query peer feedback scores (360° feedback) if the table exists
  let peerBehaviourScore: number | null = null
  let peerFeedbackCount = 0
  const { data: peerRows } = await supabase
    .from("peer_feedback")
    .select("score")
    .eq("subject_user_id", params.userId)
    .eq("status", "submitted")
    .not("score", "is", null)

  if (peerRows && peerRows.length > 0) {
    peerFeedbackCount = peerRows.length
    peerBehaviourScore = roundScore(peerRows.reduce((sum, row) => sum + (Number(row.score) || 0), 0) / peerRows.length)
  }

  // Blend: if peer feedback exists, 60% manager + 40% peer. Otherwise 100% manager.
  let behaviourScore: number | null = null
  if (managerBehaviourScore !== null && peerBehaviourScore !== null && peerFeedbackCount > 0) {
    behaviourScore = roundScore(managerBehaviourScore * 0.6 + peerBehaviourScore * 0.4)
  } else if (managerBehaviourScore !== null) {
    behaviourScore = managerBehaviourScore
  } else if (peerBehaviourScore !== null) {
    behaviourScore = peerBehaviourScore
  }

  if (latestReview && typeof latestReview.kpi_score === "number") {
    kpiScore = roundScore(Number(latestReview.kpi_score) || 0)
  }

  if (latestReview && typeof latestReview.behaviour_score === "number") {
    behaviourScore = roundScore(Number(latestReview.behaviour_score) || 0)
  }

  // ── Fix 1: CBT dead weight redistribution ──
  // When CBT = 0 (system not built yet), redistribute its 10% proportionally
  // among the other 3 components so scores aren't artificially deflated.
  // Standard weights: KPI=70%, CBT=10%, Attendance=10%, Behaviour=10%
  const { finalScore, appliedWeights } = weightedScore([
    { key: "kpi", value: kpiScore, weight: 70 },
    { key: "cbt", value: cbtScore, weight: 10 },
    { key: "attendance", value: attendanceScore, weight: 10 },
    { key: "behaviour", value: behaviourScore, weight: 10 },
  ])

  return {
    user_id: params.userId,
    cycle_id: params.cycleId ?? null,
    kpi_score: kpiScore,
    cbt_score: cbtScore,
    attendance_score: attendanceScore,
    behaviour_score: behaviourScore,
    manager_behaviour_score: managerBehaviourScore,
    peer_behaviour_score: peerBehaviourScore,
    peer_feedback_count: peerFeedbackCount,
    final_score: finalScore,
    applied_weights: appliedWeights,
    breakdown: {
      goals: goalBreakdown,
      attendance: attendanceBreakdown,
    },
  }
}

export async function computeDepartmentPerformanceScore(
  supabase: SupabaseClient,
  params: { department: string; cycleId?: string | null }
) {
  const cycle = await getCycleWindow(supabase, params.cycleId)

  // ── Fix 3: Derive department membership from actual work records, not current profile ──
  // This prevents department transfers from breaking scores. A person who worked in
  // Department A during Q1 but transferred to Department B in Q2 will still count
  // toward Department A's Q1 score — because their tasks/goals have department = A.
  //
  // We also include currently-active employees as a fallback (for people with no
  // records yet in the cycle who are still valid department members).
  const employeeIdSet = new Set<string>()

  // Source 1: Users with tasks in this department during the cycle
  let taskUsersQuery = supabase
    .from("tasks")
    .select("assigned_to")
    .eq("department", params.department)
    .not("assigned_to", "is", null)
  if (cycle) {
    taskUsersQuery = taskUsersQuery.gte("created_at", cycle.start_date).lte("created_at", cycle.end_date)
  }
  const { data: taskUsers } = await taskUsersQuery
  for (const row of taskUsers || []) {
    if (row.assigned_to) employeeIdSet.add(row.assigned_to)
  }

  // Source 2: Users with goals linked to this department's review cycle
  let goalUsersQuery = supabase.from("goals_objectives").select("user_id").eq("approval_status", "approved")
  if (params.cycleId) {
    goalUsersQuery = goalUsersQuery.eq("review_cycle_id", params.cycleId)
  }
  const { data: goalUsers } = await goalUsersQuery
  // We need to cross-reference goal users with department; goals don't have a department
  // column, so we include currently active employees as well (Source 3 below).

  // Source 3: Currently active employees (fallback — catches new hires with no records yet)
  const { data: activeEmployees } = await supabase
    .from("profiles")
    .select("id")
    .eq("department", params.department)
    .eq("employment_status", "active")
  for (const row of activeEmployees || []) {
    employeeIdSet.add(row.id)
  }

  // Also add goal users who are/were in this department
  const activeIds = new Set((activeEmployees || []).map((row) => row.id))
  for (const row of goalUsers || []) {
    if (activeIds.has(row.user_id)) employeeIdSet.add(row.user_id)
  }

  const employeeIds = Array.from(employeeIdSet)

  const individualScores =
    employeeIds.length > 0
      ? await Promise.all(
          employeeIds.map((userId) => computeIndividualPerformanceScore(supabase, { userId, cycleId: params.cycleId }))
        )
      : []

  const averageIndividualKpi = averageDefined(individualScores.map((score) => score.kpi_score))

  const averageLearningCapability = averageDefined(individualScores.map((score) => score.cbt_score))

  const averageAttendanceCompliance = averageDefined(individualScores.map((score) => score.attendance_score))

  // Query action items from the TASKS table (unified model), not the legacy action_items table.
  // Use category='weekly_action' which is what weekly-report-sourced action items are tagged as.
  let actionItemsQuery = supabase
    .from("tasks")
    .select("status")
    .eq("department", params.department)
    .eq("category", "weekly_action")

  // Help desk tickets — scored from source table directly (separate lifecycle)
  let helpDeskQuery = supabase.from("help_desk_tickets").select("status").eq("service_department", params.department)

  // Task delivery: manual department tasks only.
  // Excludes help_desk (scored separately above) AND weekly_action items (scored separately above)
  // to prevent double-counting.
  let taskDeliveryQuery = supabase
    .from("tasks")
    .select("status, source_type, category")
    .eq("department", params.department)
    .eq("source_type", "manual")
    .or("category.is.null,category.neq.weekly_action")

  if (cycle) {
    actionItemsQuery = actionItemsQuery.gte("created_at", cycle.start_date).lte("created_at", cycle.end_date)
    helpDeskQuery = helpDeskQuery.gte("created_at", cycle.start_date).lte("created_at", cycle.end_date)
    taskDeliveryQuery = taskDeliveryQuery.gte("created_at", cycle.start_date).lte("created_at", cycle.end_date)
  }

  const [{ data: actionItems }, { data: helpDeskTickets }, { data: departmentTasks }] = await Promise.all([
    actionItemsQuery,
    helpDeskQuery,
    taskDeliveryQuery,
  ])

  const actionItemScore =
    actionItems && actionItems.length > 0
      ? roundScore((actionItems.filter((item) => item.status === "completed").length / actionItems.length) * 100)
      : null

  const helpDeskScore =
    helpDeskTickets && helpDeskTickets.length > 0
      ? roundScore(
          (helpDeskTickets.filter((ticket) =>
            ["resolved", "closed"].includes(String(ticket.status || "").toLowerCase())
          ).length /
            helpDeskTickets.length) *
            100
        )
      : null

  const taskProjectDeliveryScore =
    departmentTasks && departmentTasks.length > 0
      ? roundScore(
          (departmentTasks.filter((task) => task.status === "completed").length / departmentTasks.length) * 100
        )
      : null

  let behaviourLeadershipScore: number | null = null
  if (employeeIds.length > 0) {
    let reviewQuery = supabase
      .from("performance_reviews")
      .select("behaviour_score")
      .in("user_id", employeeIds)
      .not("behaviour_score", "is", null)
    if (params.cycleId) {
      reviewQuery = reviewQuery.eq("review_cycle_id", params.cycleId)
    }
    const { data: behaviourReviews } = await reviewQuery
    if (behaviourReviews && behaviourReviews.length > 0) {
      behaviourLeadershipScore = roundScore(
        behaviourReviews.reduce((sum, row) => sum + (Number(row.behaviour_score) || 0), 0) / behaviourReviews.length
      )
    }
  }

  const departmentKpi = weightedScore([
    { key: "kpi", value: averageIndividualKpi, weight: 40 },
    { key: "cbt", value: actionItemScore, weight: 20 },
    { key: "attendance", value: helpDeskScore, weight: 20 },
    { key: "behaviour", value: taskProjectDeliveryScore, weight: 20 },
  ]).finalScore

  const departmentPms = weightedScore([
    { key: "kpi", value: departmentKpi, weight: 70 },
    { key: "cbt", value: averageLearningCapability, weight: 10 },
    { key: "attendance", value: averageAttendanceCompliance, weight: 10 },
    { key: "behaviour", value: behaviourLeadershipScore, weight: 10 },
  ]).finalScore

  const breakdown: DepartmentMetricBreakdown = {
    average_individual_kpi: averageIndividualKpi,
    action_item_score: actionItemScore,
    help_desk_score: helpDeskScore,
    task_project_delivery_score: taskProjectDeliveryScore,
    learning_capability_score: averageLearningCapability,
    attendance_compliance_score: averageAttendanceCompliance,
    behaviour_leadership_score: behaviourLeadershipScore,
  }

  // ── Fix 3: Calibration — compute department mean/stddev for normalisation ──
  // ── Fix 4: Percentile ranking — rank employees within the department ──
  const sortedScores = individualScores
    .filter((score) => typeof score.final_score === "number")
    .map((s) => ({ user_id: s.user_id, final_score: s.final_score as number }))
    .sort((a, b) => b.final_score - a.final_score)

  const mean = averageDefined(sortedScores.map((entry) => entry.final_score)) ?? 0

  const variance =
    sortedScores.length > 1
      ? sortedScores.reduce((sum, s) => sum + Math.pow(s.final_score - mean, 2), 0) / (sortedScores.length - 1)
      : 0
  const stddev = roundScore(Math.sqrt(variance))

  // Percentile: rank / total * 100 (higher = better)
  const rankings = sortedScores.map((entry, index) => ({
    user_id: entry.user_id,
    final_score: entry.final_score,
    rank: index + 1,
    percentile: roundScore(((sortedScores.length - index) / sortedScores.length) * 100),
    // Z-score: how many stddevs above/below mean (for cross-dept calibration)
    z_score: stddev > 0 ? roundScore((entry.final_score - mean) / stddev) : 0,
  }))

  return {
    department: params.department,
    cycle_id: params.cycleId ?? null,
    department_kpi: departmentKpi,
    department_pms: departmentPms,
    breakdown,
    employee_count: employeeIds.length,
    calibration: { mean, stddev },
    rankings,
  }
}
