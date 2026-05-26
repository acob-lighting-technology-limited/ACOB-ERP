import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { computeIndividualPerformanceScore } from "@/lib/performance/scoring"
import { getUnifiedPerformanceReviews } from "@/lib/performance/review-data"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("hr-performance-reviews")

// Competencies are validated as a flexible record (keys come from competency_frameworks table)
const CompetenciesSchema = z.record(z.string(), z.number().min(0).max(100)).optional().nullable()

type CompetencyRow = { key: string; label: string }

const CreatePerformanceReviewSchema = z
  .object({
    user_id: z.string().uuid("Invalid user ID"),
    review_cycle_id: z.string().uuid("Invalid review cycle ID"),
    overall_rating: z.number().min(0).max(100).optional().nullable(),
    strengths: z.string().max(2000).optional().nullable(),
    areas_for_improvement: z.string().max(2000).optional().nullable(),
    goals_achieved: z.number().int().min(0).optional().nullable(),
    goals_total: z.number().int().min(0).optional().nullable(),
    manager_comments: z.string().max(5000).optional().nullable(),
    kpi_score: z.number().min(0).max(100).optional().nullable(),
    cbt_score: z.number().min(0).max(100).optional().nullable(),
    attendance_score: z.number().min(0).max(100).optional().nullable(),
    behaviour_score: z.number().min(0).max(100).optional().nullable(),
    behaviour_competencies: CompetenciesSchema,
    status: z.enum(["draft", "submitted", "completed"]).optional(),
  })
  .refine(
    (data) =>
      data.goals_achieved === undefined ||
      data.goals_achieved === null ||
      data.goals_total === undefined ||
      data.goals_total === null ||
      data.goals_achieved <= data.goals_total,
    { message: "goals_achieved cannot exceed goals_total", path: ["goals_achieved"] }
  )

const UpdatePerformanceReviewSchema = z
  .object({
    id: z.string().trim().optional(),
    user_id: z.string().trim().optional(),
    review_cycle_id: z.string().trim().optional(),
    acknowledge: z.boolean().optional(),
    employee_comments: z.string().optional().nullable(),
    status: z.enum(["draft", "submitted", "completed"]).optional(),
  })
  .refine((data) => Boolean(data.id || (data.user_id && data.review_cycle_id)), {
    message: "Review reference is required",
    path: ["id"],
  })

type ExistingReviewRow = {
  id: string
  created_at: string
  status: string | null
  strengths: string | null
  areas_for_improvement: string | null
  manager_comments: string | null
  kpi_score: number | null
  cbt_score: number | null
  attendance_score: number | null
  behaviour_score: number | null
  behaviour_competencies: Record<string, unknown> | null
}

type ReviewRow = {
  id: string
  user_id: string
  review_cycle_id: string
}

type ReviewStatusRow = {
  id: string
  user_id: string

  status: string | null
  employee_comments?: string | null
  self_review_completed?: boolean | null
  kpi_score?: number | null
  cbt_score?: number | null
  attendance_score?: number | null
  behaviour_score?: number | null
}

function coerceOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function reviewStatusPriority(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  if (normalized === "completed") return 3
  if (normalized === "submitted") return 2
  if (normalized === "draft") return 1
  return 0
}

function pickCanonicalReview(reviews: ExistingReviewRow[]) {
  return [...reviews].sort((left, right) => {
    const statusDiff = reviewStatusPriority(right.status) - reviewStatusPriority(left.status)
    if (statusDiff !== 0) return statusDiff
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
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

    const { searchParams } = request.nextUrl
    const cycleId = searchParams.get("cycle_id")
    const userId = searchParams.get("user_id")
    const limitParam = searchParams.get("limit")
    const offsetParam = searchParams.get("offset")
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0

    // Resolve scope from middleware header (single source of truth)
    const scope = await getRequestScope()
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const scopedDepts = getScopedDepartments(scope)

    // When requesting another user's review, verify that user is in our dept scope
    if (userId && userId !== user.id) {
      if (scopedDepts !== null) {
        // Not global admin — verify target user is in scoped departments
        const { data: targetProfile } = await supabase
          .from("profiles")
          .select("department")
          .eq("id", userId)
          .single<{ department?: string | null }>()

        const targetDept = targetProfile?.department || ""
        if (!scopedDepts.includes(targetDept)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
      }
    }

    // Resolve scoped user IDs for the list view (no userId filter)
    let scopedUserIds: string[] | null = null
    if (!userId && scopedDepts !== null) {
      // Scoped — resolve the users in managed departments
      if (scopedDepts.length > 0) {
        const { data: deptUsers } = await supabase.from("profiles").select("id").in("department", scopedDepts)
        scopedUserIds = (deptUsers || []).map((p) => p.id)
      } else {
        scopedUserIds = [] // empty scope — return nothing
      }
    }

    // If we resolved an empty scope, return empty result immediately
    if (scopedUserIds !== null && scopedUserIds.length === 0) {
      return NextResponse.json({ data: [], meta: { total: 0, limit, offset, hasMore: false } })
    }

    const { reviews, total } = await getUnifiedPerformanceReviews(supabase, {
      userId,
      cycleId,
      limit,
      offset,
      userIds: scopedUserIds ?? undefined,
    })
    return NextResponse.json({
      data: reviews,
      meta: { total, limit, offset, hasMore: offset + reviews.length < total },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/reviews:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-reviews:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = CreatePerformanceReviewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    // Check scope: admin can always create; department lead only for their own departments
    const [{ data: profile }, { data: targetProfile }] = await Promise.all([
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<{
          role?: string | null
          department?: string | null
          is_department_lead?: boolean | null
          lead_departments?: string[] | null
        }>(),
      supabase
        .from("profiles")
        .select("department")
        .eq("id", parsed.data.user_id)
        .maybeSingle<{ department?: string | null }>(),
    ])

    const reviewsScope = await getRequestScope()
    const isAdmin = reviewsScope?.isAdminLike === true && reviewsScope.scopeMode !== "lead"
    const managedDepartments = Array.isArray(profile?.lead_departments) ? profile.lead_departments : []
    const canLeadTarget =
      profile?.is_department_lead === true &&
      Boolean(
        targetProfile?.department &&
          (targetProfile.department === profile?.department || managedDepartments.includes(targetProfile.department))
      )

    if (!isAdmin && !canLeadTarget) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const {
      user_id,
      review_cycle_id,
      overall_rating,
      strengths,
      areas_for_improvement,
      goals_achieved,
      goals_total,
      manager_comments,
      // PMS 4-component scores
      kpi_score: _kpiScore,
      cbt_score: _cbtScore,
      attendance_score: _attendanceScore,
      behaviour_score: _behaviourScore,
      behaviour_competencies,
      status,
    } = parsed.data

    const { data: existingReviews } = await adminSupabase
      .from("performance_reviews")
      .select(
        "id, created_at, status, strengths, areas_for_improvement, manager_comments, kpi_score, cbt_score, attendance_score, behaviour_score, behaviour_competencies"
      )
      .eq("user_id", user_id)
      .eq("review_cycle_id", review_cycle_id)
      .returns<ExistingReviewRow[]>()

    const canonicalReview = existingReviews && existingReviews.length > 0 ? pickCanonicalReview(existingReviews) : null

    const computedScore = await computeIndividualPerformanceScore(supabase, {
      userId: user_id,
      cycleId: review_cycle_id,
    })

    const parsedCompetencies =
      typeof behaviour_competencies === "object" && behaviour_competencies !== null
        ? (behaviour_competencies as Record<string, unknown>)
        : null

    // Fetch active competency keys from DB (falls back to empty array on failure)
    const { data: competencyRows } = await adminSupabase
      .from("competency_frameworks")
      .select("key, label")
      .eq("is_active", true)
      .order("sort_order")
      .returns<CompetencyRow[]>()
    const competencyKeys = (competencyRows || []).map((c) => c.key)

    const competencyValues =
      parsedCompetencies && competencyKeys.length > 0
        ? competencyKeys.map((key) => {
            const raw = parsedCompetencies[key]
            const normalized = typeof raw === "number" ? raw : Number(raw)
            return Number.isFinite(normalized) ? Math.max(0, Math.min(100, normalized)) : 0
          })
        : []
    const competencyAverage =
      competencyValues.length > 0
        ? Math.round((competencyValues.reduce((sum, value) => sum + value, 0) / competencyValues.length) * 100) / 100
        : null

    const payload = {
      user_id,
      reviewer_id: user.id,
      review_cycle_id,
      review_date: toLocalISODate(),
      overall_rating: overall_rating ?? computedScore.final_score,
      strengths,
      areas_for_improvement,
      goals_achieved,
      goals_total,
      manager_comments,
      kpi_score: coerceOptionalNumber(_kpiScore) ?? computedScore.kpi_score,
      cbt_score: coerceOptionalNumber(_cbtScore) ?? computedScore.cbt_score,
      attendance_score: coerceOptionalNumber(_attendanceScore) ?? computedScore.attendance_score,
      behaviour_score: coerceOptionalNumber(_behaviourScore) ?? competencyAverage ?? computedScore.behaviour_score,
      final_score: coerceOptionalNumber(overall_rating) ?? computedScore.final_score,
      behaviour_competencies: parsedCompetencies,
      status: status || canonicalReview?.status || "draft",
      updated_at: new Date().toISOString(),
    }

    const reviewQuery = canonicalReview
      ? adminSupabase.from("performance_reviews").update(payload).eq("id", canonicalReview.id)
      : adminSupabase.from("performance_reviews").insert(payload)

    const { data: review, error } = await reviewQuery.select("id, user_id, review_cycle_id").single<ReviewRow>()

    if (error) {
      log.error({ err: String(error) }, "Error creating performance review:")
      return NextResponse.json({ error: "Failed to create performance review" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: canonicalReview ? "update" : "create",
        entityType: "performance_review",
        entityId: review.id,
        newValues: {
          user_id,
          review_cycle_id,
          overall_rating,
          kpi_score: payload.kpi_score,
          cbt_score: payload.cbt_score,
          attendance_score: payload.attendance_score,
          behaviour_score: payload.behaviour_score,
          status: payload.status,
        },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/reviews" },
      },
      { failOpen: true }
    )

    const hydratedReview = review
      ? (
          await getUnifiedPerformanceReviews(supabase, {
            userId: review.user_id,
            cycleId: review.review_cycle_id,
            limit: 1,
          })
        ).reviews[0] || review
      : review

    return NextResponse.json({
      data: hydratedReview,
      message: canonicalReview ? "Performance review updated successfully" : "Performance review created successfully",
    })
  } catch (error) {
    log.error(
      { err: JSON.stringify(error, Object.getOwnPropertyNames(error || {})) },
      "Error in POST /api/hr/performance/reviews:"
    )
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-reviews:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const parsed = UpdatePerformanceReviewSchema.safeParse(await request.json())
    if (!parsed.success) {
      log.warn({ issues: parsed.error.issues }, "PATCH review validation failed")
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    log.info(
      {
        actor_id: user.id,
        id: parsed.data.id || null,
        user_id: parsed.data.user_id || null,
        review_cycle_id: parsed.data.review_cycle_id || null,
        status: parsed.data.status || null,
        acknowledge: parsed.data.acknowledge === true,
      },
      "PATCH review request received"
    )

    if (!parsed.data.acknowledge && !parsed.data.status) {
      log.warn({ actor_id: user.id }, "PATCH review rejected because no supported action was provided")
      return NextResponse.json({ error: "Unsupported review update request" }, { status: 400 })
    }

    let review: ReviewStatusRow | null = null
    let reviewError: { message?: string } | null = null

    if (parsed.data.user_id && parsed.data.review_cycle_id) {
      const { data: fallbackReviews, error: fallbackError } = await adminSupabase
        .from("performance_reviews")
        .select(
          "id, user_id, status, self_review_completed, employee_comments, kpi_score, cbt_score, attendance_score, behaviour_score, created_at"
        )
        .eq("user_id", parsed.data.user_id)
        .eq("review_cycle_id", parsed.data.review_cycle_id)
        .returns<Array<ReviewStatusRow & { created_at: string }>>()

      log.info(
        {
          actor_id: user.id,
          lookup: "user_cycle",
          user_id: parsed.data.user_id,
          review_cycle_id: parsed.data.review_cycle_id,
          review_count: fallbackReviews?.length || 0,
          error: fallbackError?.message || null,
        },
        "PATCH review lookup by user and cycle completed"
      )

      if (!fallbackError && fallbackReviews && fallbackReviews.length > 0) {
        review = fallbackReviews.sort((left, right) => {
          const statusDiff = reviewStatusPriority(right.status) - reviewStatusPriority(left.status)
          if (statusDiff !== 0) return statusDiff
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        })[0]
      } else {
        reviewError = fallbackError ? { message: fallbackError.message } : null
      }
    }

    if (!review && parsed.data.id) {
      const { data: reviewById, error: reviewByIdError } = await adminSupabase
        .from("performance_reviews")
        .select(
          "id, user_id, status, self_review_completed, employee_comments, kpi_score, cbt_score, attendance_score, behaviour_score"
        )
        .eq("id", parsed.data.id)
        .maybeSingle<ReviewStatusRow>()

      log.info(
        {
          actor_id: user.id,
          lookup: "id",
          id: parsed.data.id,
          found: Boolean(reviewById),
          error: reviewByIdError?.message || null,
        },
        "PATCH review lookup by id completed"
      )

      review = reviewById || null
      if (reviewByIdError) {
        reviewError = { message: reviewByIdError.message }
      }
    }

    if (reviewError || !review) {
      log.error(
        {
          actor_id: user.id,
          id: parsed.data.id || null,
          user_id: parsed.data.user_id || null,
          review_cycle_id: parsed.data.review_cycle_id || null,
          review_error: reviewError?.message || null,
        },
        "PATCH review could not resolve target review"
      )
      return NextResponse.json({ error: "Review not found" }, { status: 404 })
    }

    if (parsed.data.status) {
      if (
        parsed.data.status === "completed" &&
        ![review.kpi_score, review.cbt_score, review.attendance_score, review.behaviour_score].every(
          (value) => typeof value === "number" && Number.isFinite(value) && value > 0
        )
      ) {
        return NextResponse.json(
          { error: "Add KPI, CBT, Attendance, and Behaviour before marking this review completed" },
          { status: 400 }
        )
      }

      const statusPayload = {
        status: parsed.data.status,
        updated_at: new Date().toISOString(),
      }

      const updateQuery =
        parsed.data.user_id && parsed.data.review_cycle_id
          ? adminSupabase
              .from("performance_reviews")
              .update(statusPayload)
              .eq("user_id", parsed.data.user_id)
              .eq("review_cycle_id", parsed.data.review_cycle_id)
          : adminSupabase.from("performance_reviews").update(statusPayload).eq("id", review.id)

      const { data: updatedReviews, error: updateError } = await updateQuery.select("*").returns<ReviewStatusRow[]>()

      log.info(
        {
          actor_id: user.id,
          target_review_id: review.id,
          update_scope: parsed.data.user_id && parsed.data.review_cycle_id ? "user_cycle" : "id",
          requested_status: parsed.data.status,
          updated_count: updatedReviews?.length || 0,
          error: updateError?.message || null,
        },
        "PATCH review status update completed"
      )

      if (updateError || !updatedReviews || updatedReviews.length === 0) {
        log.error(
          {
            actor_id: user.id,
            target_review_id: review.id,
            requested_status: parsed.data.status,
            error: updateError?.message || null,
          },
          "PATCH review status update failed"
        )
        return NextResponse.json({ error: updateError?.message || "Failed to update review status" }, { status: 500 })
      }

      await writeAuditLog(
        supabase,
        {
          action: "performance_review.status",
          entityType: "performance_review",
          entityId: review.id,
          oldValues: { status: (review as { status?: string | null }).status ?? null },
          newValues: { status: parsed.data.status },
          context: { actorId: user.id, source: "api", route: "/api/hr/performance/reviews" },
        },
        { failOpen: true }
      )

      return NextResponse.json({ data: updatedReviews[0], message: "Review status updated successfully" })
    }

    if (review.user_id !== user.id) {
      log.warn({ actor_id: user.id, review_user_id: review.user_id }, "PATCH review acknowledge blocked for non-owner")
      return NextResponse.json({ error: "Only the reviewed employee can acknowledge this review" }, { status: 403 })
    }

    if (review.self_review_completed) {
      log.warn(
        { actor_id: user.id, review_id: review.id },
        "PATCH review acknowledge blocked because already acknowledged"
      )
      return NextResponse.json({ error: "Review has already been acknowledged" }, { status: 400 })
    }

    const { data: updatedReview, error: updateError } = await adminSupabase
      .from("performance_reviews")
      .update({
        self_review_completed: true,
        employee_comments: parsed.data.employee_comments ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", review.id)
      .select("*")
      .single()

    if (updateError || !updatedReview) {
      log.error(
        { actor_id: user.id, review_id: review.id, error: updateError?.message || null },
        "PATCH review acknowledge update failed"
      )
      return NextResponse.json({ error: updateError?.message || "Failed to acknowledge review" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "performance_review.acknowledge",
        entityType: "performance_review",
        entityId: review.id,
        oldValues: {
          self_review_completed: review.self_review_completed ?? false,
          employee_comments: review.employee_comments ?? null,
        },
        newValues: { self_review_completed: true, employee_comments: parsed.data.employee_comments ?? null },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/reviews" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updatedReview, message: "Review acknowledged successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/hr/performance/reviews:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
