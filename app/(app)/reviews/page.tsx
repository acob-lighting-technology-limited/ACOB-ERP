import { redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getUnifiedPerformanceReviews, type UnifiedReviewRow } from "@/lib/performance/review-data"
import { ReviewsContent } from "./reviews-content"

import { logger } from "@/lib/logger"

const log = logger("dashboard-reviews")
export const dynamic = "force-dynamic"

export interface Review {
  id: string
  user_id?: string | null
  overall_rating: number | null
  strengths: string | null
  areas_for_improvement: string | null
  goals_achieved: number | null
  goals_total: number | null
  manager_comments: string | null
  status: string | null
  created_at: string
  // PMS 4-component scores
  kpi_score?: number | null
  cbt_score?: number | null
  attendance_score?: number | null
  behaviour_score?: number | null
  final_score?: number | null
  acknowledged_at?: string | null
  acknowledged_by?: string | null
  employee_comments?: string | null
  behaviour_competencies?: {
    collaboration?: number
    accountability?: number
    communication?: number
    teamwork?: number
    loyalty?: number
    professional_conduct?: number
  } | null
  review_cycle_id?: string | null
  reviewer_id?: string | null
  review_cycle: {
    id: string | null
    name: string
    review_type: string
    start_date: string | null
    end_date: string | null
  }
  reviewer: {
    first_name: string
    last_name: string
  }
}

function reviewStatusPriority(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  if (normalized === "completed") return 3
  if (normalized === "submitted") return 2
  if (normalized === "draft") return 1
  return 0
}

function pickCanonicalReview(reviews: Review[]): Review {
  return [...reviews].sort((left, right) => {
    const leftStatus = reviewStatusPriority(left.status)
    const rightStatus = reviewStatusPriority(right.status)
    if (rightStatus !== leftStatus) return rightStatus - leftStatus

    const leftHasNarrative = Number(Boolean(left.strengths || left.areas_for_improvement || left.manager_comments))
    const rightHasNarrative = Number(Boolean(right.strengths || right.areas_for_improvement || right.manager_comments))
    if (rightHasNarrative !== leftHasNarrative) return rightHasNarrative - leftHasNarrative

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })[0]
}

function mergeDuplicateReviews(reviews: Review[]): Review[] {
  const grouped = new Map<string, Review[]>()
  for (const review of reviews) {
    const key = `${review.user_id || "unknown"}:${review.review_cycle_id || "no-cycle"}`
    const existing = grouped.get(key) || []
    existing.push(review)
    grouped.set(key, existing)
  }

  return Array.from(grouped.values()).map((group) => {
    const canonical = pickCanonicalReview(group)

    const latestValue = <T,>(pick: (review: Review) => T | null | undefined): T | null => {
      const found = [...group]
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .find((review) => pick(review) !== null && pick(review) !== undefined)
      if (!found) return null
      return (pick(found) ?? null) as T | null
    }

    const kpiScore = latestValue((review) => review.kpi_score)
    const cbtScore = latestValue((review) => review.cbt_score)
    const attendanceScore = latestValue((review) => review.attendance_score)
    const behaviourScore = latestValue((review) => review.behaviour_score)

    const metricParts = [
      { value: kpiScore, weight: 70 },
      { value: cbtScore, weight: 10 },
      { value: attendanceScore, weight: 10 },
      { value: behaviourScore, weight: 10 },
    ].filter((item): item is { value: number; weight: number } => item.value !== null)

    const totalWeight = metricParts.reduce((sum, item) => sum + item.weight, 0)
    const computedFinal =
      totalWeight > 0
        ? Math.round((metricParts.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight) * 100) / 100
        : null

    return {
      ...canonical,
      kpi_score: kpiScore,
      cbt_score: cbtScore,
      attendance_score: attendanceScore,
      behaviour_score: behaviourScore,
      final_score: computedFinal ?? latestValue((review) => review.final_score),
      strengths: canonical.strengths || latestValue((review) => review.strengths) || "",
      areas_for_improvement:
        canonical.areas_for_improvement || latestValue((review) => review.areas_for_improvement) || "",
      manager_comments: canonical.manager_comments || latestValue((review) => review.manager_comments) || "",
      employee_comments: canonical.employee_comments || latestValue((review) => review.employee_comments) || null,
    }
  })
}

async function getReviewsData() {
  noStore()
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  let reviewRows: UnifiedReviewRow[] = []
  try {
    const result = await getUnifiedPerformanceReviews(supabase, { userId: user.id, limit: 200 })
    reviewRows = result.reviews
  } catch (error) {
    log.error("Error loading reviews:", error)
    return { reviews: [] as Review[] }
  }

  if (reviewRows.length === 0) {
    return { reviews: [] as Review[] }
  }

  const hydratedReviews: Review[] = reviewRows.map((review) => ({
    ...review,
    review_cycle: {
      id: review.cycle?.id || review.review_cycle_id || null,
      name: review.cycle?.name || "Performance Review",
      review_type: review.cycle?.review_type || "standard",
      start_date: review.cycle?.start_date || null,
      end_date: review.cycle?.end_date || null,
    },
    reviewer: {
      first_name: review.reviewer?.first_name || "Unknown",
      last_name: review.reviewer?.last_name || "Reviewer",
    },
  }))

  return {
    reviews: mergeDuplicateReviews(hydratedReviews).sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    ),
  }
}

export default async function ReviewsPage() {
  const data = await getReviewsData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const reviewsData = data as { reviews: Review[] }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return <ReviewsContent initialReviews={reviewsData.reviews} currentUserId={user?.id || ""} />
}
