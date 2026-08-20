import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

const log = logger("performance-goal-linking")

type SupportedTaskSource = "manual" | "help_desk"

type GoalRecord = {
  id: string
  title: string
  review_cycle_id?: string | null
}

type ReviewCycleRecord = {
  id: string
  end_date?: string | null
}

type GoalLinkParams = {
  supabase: SupabaseClient
  actorId: string
  assignedTo?: string | null
  department?: string | null
  sourceType: SupportedTaskSource
  title?: string | null
  explicitGoalId?: string | null
}

type GoalBucket = "help_desk" | "compliance" | "operational"

const BUCKET_KEYWORDS: Record<GoalBucket, string[]> = {
  help_desk: ["help desk", "support", "ticket", "service desk", "customer support"],
  compliance: ["compliance", "report", "reporting", "audit", "documentation"],
  operational: ["operations", "operational", "execution", "delivery", "assigned work", "general"],
}

const BUCKET_TITLES: Record<GoalBucket, string> = {
  help_desk: "Help Desk Delivery",
  compliance: "Compliance and Reporting",
  operational: "Operational Execution",
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

function resolveGoalBucket(sourceType: SupportedTaskSource, title?: string | null): GoalBucket {
  if (sourceType === "help_desk") return "help_desk"

  const normalizedTitle = normalize(title)
  if (BUCKET_KEYWORDS.compliance.some((keyword) => normalizedTitle.includes(keyword))) {
    return "compliance"
  }

  return "operational"
}

function scoreGoalMatch(goal: GoalRecord, bucket: GoalBucket, department?: string | null) {
  const title = normalize(goal.title)
  let score = 0

  if (title === normalize(BUCKET_TITLES[bucket])) score += 100
  if (title.includes(normalize(BUCKET_TITLES[bucket]))) score += 50
  if (BUCKET_KEYWORDS[bucket].some((keyword) => title.includes(keyword))) score += 30
  if (bucket !== "operational" && BUCKET_KEYWORDS.operational.some((keyword) => title.includes(keyword))) score += 5

  const normalizedDepartment = normalize(department)
  if (normalizedDepartment && title.includes(normalizedDepartment)) score += 10

  return score
}

async function resolveActiveReviewCycle(supabase: SupabaseClient): Promise<ReviewCycleRecord | null> {
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: activeCycle } = await dataClient
    .from("review_cycles")
    .select("id, end_date")
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle<ReviewCycleRecord>()

  if (activeCycle) return activeCycle

  const { data: recentCycle } = await dataClient
    .from("review_cycles")
    .select("id, end_date")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle<ReviewCycleRecord>()

  return recentCycle ?? null
}

export async function resolveAutoLinkedGoalId(params: GoalLinkParams): Promise<string | null> {
  if (params.explicitGoalId) return params.explicitGoalId
  if (!params.assignedTo) return null

  const dataClient = getServiceRoleClientOrFallback(params.supabase)
  const bucket = resolveGoalBucket(params.sourceType, params.title)
  const cycle = await resolveActiveReviewCycle(params.supabase)

  let goalsQuery = dataClient
    .from("goals_objectives")
    .select("id, title, review_cycle_id")
    .eq("user_id", params.assignedTo)
    .eq("approval_status", "approved")
    .eq("is_archived", false)

  if (cycle?.id) {
    goalsQuery = goalsQuery.eq("review_cycle_id", cycle.id)
  }

  const { data: approvedGoals, error } = await goalsQuery

  if (error) {
    log.error(
      { err: error, assignedTo: params.assignedTo, sourceType: params.sourceType },
      "Failed to resolve approved goals"
    )
    return null
  }

  const rankedGoal = (approvedGoals || [])
    .map((goal) => ({
      goal,
      score: scoreGoalMatch(goal, bucket, params.department),
    }))
    .sort((left, right) => right.score - left.score)[0]

  if (rankedGoal && rankedGoal.score > 0) {
    return rankedGoal.goal.id
  }

  log.warn(
    { assignedTo: params.assignedTo, sourceType: params.sourceType, bucket, department: params.department || null },
    "No approved goal available for auto-linking"
  )
  return null
}
