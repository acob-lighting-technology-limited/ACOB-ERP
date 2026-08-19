import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("hr-performance-cbt")

const SaveCbtScoreSchema = z.object({
  user_id: z.string().trim().min(1, "Employee is required"),
  review_cycle_id: z.string().trim().min(1, "Review cycle is required"),
  cbt_score: z.number().min(0, "CBT score must be at least 0").max(100, "CBT score cannot exceed 100"),
})

type ScopedUserRow = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
  employment_type?: "full_time" | "part_time" | "contract" | null
  employment_status?: string | null
}

type ReviewerRow = {
  id: string
  first_name: string | null
  last_name: string | null
}

type ReviewCycleRow = {
  id: string
  name: string
  review_type: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
}

type CbtReviewRow = {
  id: string
  user_id: string
  review_cycle_id: string
  reviewer_id?: string | null
  status?: string | null
  strengths?: string | null
  areas_for_improvement?: string | null
  manager_comments?: string | null
  kpi_score?: number | null
  attendance_score?: number | null
  behaviour_score?: number | null
  final_score?: number | null
  cbt_score: number | null
  created_at: string
  tab_switch_count?: number
}

function getReviewPriority(review: CbtReviewRow) {
  const status = String(review.status || "").toLowerCase()
  const statusPriority = status === "completed" ? 3 : status === "submitted" ? 2 : status === "draft" ? 1 : 0
  const hasNarrative = Boolean(review.strengths || review.areas_for_improvement || review.manager_comments)
  const hasCoreScores =
    review.kpi_score !== null ||
    review.attendance_score !== null ||
    review.behaviour_score !== null ||
    review.final_score !== null

  return {
    statusPriority,
    hasNarrative: hasNarrative ? 1 : 0,
    hasCoreScores: hasCoreScores ? 1 : 0,
    createdAt: new Date(review.created_at).getTime(),
  }
}

function chooseCanonicalReview(reviews: CbtReviewRow[]): CbtReviewRow | null {
  if (reviews.length === 0) return null
  return [...reviews].sort((left, right) => {
    const leftPriority = getReviewPriority(left)
    const rightPriority = getReviewPriority(right)
    if (rightPriority.statusPriority !== leftPriority.statusPriority) {
      return rightPriority.statusPriority - leftPriority.statusPriority
    }
    if (rightPriority.hasNarrative !== leftPriority.hasNarrative) {
      return rightPriority.hasNarrative - leftPriority.hasNarrative
    }
    if (rightPriority.hasCoreScores !== leftPriority.hasCoreScores) {
      return rightPriority.hasCoreScores - leftPriority.hasCoreScores
    }
    return rightPriority.createdAt - leftPriority.createdAt
  })[0]
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) {
      return contextResult.response
    }

    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.pms.cbt.manage")
    if (!routeAccess.ok) {
      return routeAccess.response
    }

    const cycleId = request.nextUrl.searchParams.get("cycle_id")

    const usersQuery = supabase
      .from("profiles")
      .select("id, first_name, last_name, department, employment_type, employment_status")
      .order("first_name", { ascending: true })

    const [{ data: users }, { data: cycles }] = await Promise.all([
      usersQuery.returns<ScopedUserRow[]>(),
      supabase
        .from("review_cycles")
        .select("id, name, review_type, start_date, end_date, status")
        .order("start_date", { ascending: false })
        .returns<ReviewCycleRow[]>(),
    ])

    const scopedUsers = users || []
    const scopedUserIds = scopedUsers.map((entry) => entry.id)

    let cbtScores: CbtReviewRow[] = []
    let reviewers: ReviewerRow[] = []
    if (scopedUserIds.length > 0) {
      let reviewsQuery = supabase
        .from("performance_reviews")
        .select("id, user_id, review_cycle_id, reviewer_id, cbt_score, created_at")
        .in("user_id", scopedUserIds)
        .not("cbt_score", "is", null)
        .order("created_at", { ascending: false })

      if (cycleId) {
        reviewsQuery = reviewsQuery.eq("review_cycle_id", cycleId)
      }

      const { data: reviews } = await reviewsQuery.returns<CbtReviewRow[]>()

      const latestByUserAndCycle = new Map<string, CbtReviewRow>()
      for (const review of reviews || []) {
        const key = `${review.user_id}:${review.review_cycle_id}`
        if (!latestByUserAndCycle.has(key)) {
          latestByUserAndCycle.set(key, review)
        }
      }
      cbtScores = Array.from(latestByUserAndCycle.values())

      const { data: attempts } = await supabase
        .from("cbt_attempts")
        .select("profile_id, review_cycle_id, cbt_details")
        .eq("status", "submitted")
        .in(
          "profile_id",
          cbtScores.map((score) => score.user_id)
        )
        .returns<
          { profile_id: string; review_cycle_id: string | null; cbt_details: Record<string, unknown> | null }[]
        >()

      const tabSwitchByKey = new Map<string, number>()
      for (const attempt of attempts || []) {
        if (!attempt.review_cycle_id) continue
        const key = `${attempt.profile_id}:${attempt.review_cycle_id}`
        const count = Number(attempt.cbt_details?.tab_switch_count ?? 0)
        tabSwitchByKey.set(key, count)
      }
      cbtScores = cbtScores.map((score) => ({
        ...score,
        tab_switch_count: tabSwitchByKey.get(`${score.user_id}:${score.review_cycle_id}`) ?? 0,
      }))

      const reviewerIds = Array.from(
        new Set(cbtScores.map((review) => review.reviewer_id).filter((value): value is string => Boolean(value)))
      )

      if (reviewerIds.length > 0) {
        const { data: reviewerProfiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", reviewerIds)
          .returns<ReviewerRow[]>()

        reviewers = reviewerProfiles || []
      }
    }

    return NextResponse.json({
      data: {
        users: scopedUsers,
        cycles: cycles || [],
        scores: cbtScores,
        reviewers,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/cbt")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cbt:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) {
      return contextResult.response
    }

    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.pms.cbt.manage")
    if (!routeAccess.ok) {
      return routeAccess.response
    }

    const parsed = SaveCbtScoreSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { user_id, review_cycle_id, cbt_score } = parsed.data
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json(
        { error: "Server configuration is missing Supabase service credentials" },
        { status: 500 }
      )
    }

    const adminSupabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, department")
      .eq("id", user_id)
      .maybeSingle<{ id: string; department?: string | null }>()

    if (!targetProfile) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 })
    }

    const { data: existingReviews } = await adminSupabase
      .from("performance_reviews")
      .select(
        "id, user_id, review_cycle_id, reviewer_id, status, strengths, areas_for_improvement, manager_comments, kpi_score, attendance_score, behaviour_score, final_score, cbt_score, created_at"
      )
      .eq("user_id", user_id)
      .eq("review_cycle_id", review_cycle_id)
      .returns<CbtReviewRow[]>()

    const canonicalReview = chooseCanonicalReview(existingReviews || [])

    if (canonicalReview) {
      const { data: updatedReview, error: updateError } = await adminSupabase
        .from("performance_reviews")
        .update({
          cbt_score,
        })
        .eq("id", canonicalReview.id)
        .select("id, user_id, review_cycle_id, cbt_score")
        .single()

      if (updateError || !updatedReview) {
        log.error({ err: String(updateError) }, "Failed to update CBT score")
        return NextResponse.json({ error: "Failed to update CBT score" }, { status: 500 })
      }

      await writeAuditLog(
        supabase,
        {
          action: "update",
          entityType: "performance_review",
          entityId: updatedReview.id,
          oldValues: { cbt_score: canonicalReview.cbt_score ?? null },
          newValues: { cbt_score },
          context: { actorId: user.id, source: "api", route: "/api/hr/performance/cbt" },
        },
        { failOpen: true }
      )

      return NextResponse.json({ data: updatedReview, message: "CBT score updated successfully" })
    }

    const { data: createdReview, error: createError } = await adminSupabase
      .from("performance_reviews")
      .insert({
        user_id,
        review_cycle_id,
        reviewer_id: user.id,
        review_date: toLocalISODate(),
        cbt_score,
        status: "draft",
      })
      .select("id, user_id, review_cycle_id, cbt_score")
      .single()

    if (createError || !createdReview) {
      log.error({ err: String(createError) }, "Failed to create review draft for CBT score")
      return NextResponse.json({ error: "Failed to save CBT score" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "performance_review",
        entityId: createdReview.id,
        newValues: { cbt_score, user_id, review_cycle_id, status: "draft" },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cbt" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: createdReview, message: "CBT score saved successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/performance/cbt")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
