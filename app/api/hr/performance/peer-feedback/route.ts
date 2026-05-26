import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("peer-feedback")

const SubmitPeerFeedbackSchema = z.object({
  subject_user_id: z.string().uuid("Invalid subject user ID"),
  review_cycle_id: z.string().uuid("Invalid review cycle ID"),
  score: z.number().min(0).max(100, "Score must be between 0 and 100"),
  collaboration: z.number().min(0).max(100).optional().nullable(),
  communication: z.number().min(0).max(100).optional().nullable(),
  teamwork: z.number().min(0).max(100).optional().nullable(),
  professionalism: z.number().min(0).max(100).optional().nullable(),
  comments: z.string().max(2000).optional().nullable(),
})

/**
 * GET /api/hr/performance/peer-feedback
 *
 * Query params:
 *   subject_user_id  — feedback given TO this user, or "all_admin" for admin list view
 *   review_cycle_id  — filter by cycle (optional)
 *   as_reviewer      — "true" → return feedback submitted BY the current user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = request.nextUrl
    const subjectUserId = searchParams.get("subject_user_id")
    const cycleId = searchParams.get("review_cycle_id")
    const asReviewer = searchParams.get("as_reviewer") === "true"

    // ── Admin list view: subject_user_id=all_admin ────────────────────────────
    // The admin peer-feedback page passes this sentinel to request ALL feedback.
    // Scope it to managed departments so leads only see their dept's feedback.
    if (subjectUserId === "all_admin") {
      const scope = await getRequestScope()
      if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

      const scopedDepts = getScopedDepartments(scope)

      // Resolve scoped subject user IDs
      let scopedSubjectIds: string[] | null = null
      if (scopedDepts !== null) {
        if (scopedDepts.length > 0) {
          const { data: deptUsers } = await supabase.from("profiles").select("id").in("department", scopedDepts)
          scopedSubjectIds = (deptUsers || []).map((p) => p.id)
        } else {
          return NextResponse.json({ data: [] }) // empty scope
        }
      }

      let query = supabase
        .from("peer_feedback")
        .select(
          "id, subject_user_id, reviewer_user_id, review_cycle_id, score, collaboration, communication, teamwork, professionalism, comments, status, created_at"
        )
        .order("created_at", { ascending: false })

      if (scopedSubjectIds !== null) {
        query = query.in("subject_user_id", scopedSubjectIds)
      }
      if (cycleId) query = query.eq("review_cycle_id", cycleId)

      const { data: feedback, error } = await query
      if (error) {
        log.error({ err: String(error) }, "Error fetching admin peer feedback")
        return NextResponse.json({ error: "Failed to fetch peer feedback" }, { status: 500 })
      }

      // Enrich with profiles
      const allUserIds = Array.from(
        new Set(
          [
            ...(feedback || []).map((f) => f.subject_user_id),
            ...(feedback || []).map((f) => f.reviewer_user_id),
          ].filter(Boolean)
        )
      )
      const { data: profiles } =
        allUserIds.length > 0
          ? await supabase.from("profiles").select("id, first_name, last_name, department").in("id", allUserIds)
          : {
              data: [] as Array<{
                id: string
                first_name: string | null
                last_name: string | null
                department: string | null
              }>,
            }
      const profileById = new Map((profiles || []).map((p) => [p.id, p]))
      const enriched = (feedback || []).map((f) => ({
        ...f,
        subject: profileById.get(f.subject_user_id) || null,
        reviewer: profileById.get(f.reviewer_user_id) || null,
      }))

      return NextResponse.json({ data: enriched })
    }

    // ── Per-user view ─────────────────────────────────────────────────────────
    // Employees can only see feedback about themselves, or feedback they submitted
    if (subjectUserId && subjectUserId !== user.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<{
          role?: string | null
          department?: string | null
          is_department_lead?: boolean | null
          lead_departments?: string[] | null
        }>()
      const peerScope = await getRequestScope()
      const isGlobalAdmin = peerScope?.isAdminLike === true && peerScope.scopeMode !== "lead"
      if (!isGlobalAdmin && !profile?.is_department_lead) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    let query = supabase
      .from("peer_feedback")
      .select(
        "id, subject_user_id, reviewer_user_id, review_cycle_id, score, collaboration, communication, teamwork, professionalism, comments, status, created_at"
      )
      .order("created_at", { ascending: false })

    if (asReviewer) {
      query = query.eq("reviewer_user_id", user.id)
    } else if (subjectUserId) {
      query = query.eq("subject_user_id", subjectUserId)
    } else {
      // Default: feedback about the current user
      query = query.eq("subject_user_id", user.id)
    }

    if (cycleId) query = query.eq("review_cycle_id", cycleId)

    const { data: feedback, error } = await query
    if (error) {
      log.error({ err: String(error) }, "Error fetching peer feedback")
      return NextResponse.json({ error: "Failed to fetch peer feedback" }, { status: 500 })
    }

    // Enrich with subject/reviewer profiles
    const allUserIds = Array.from(
      new Set(
        [...(feedback || []).map((f) => f.subject_user_id), ...(feedback || []).map((f) => f.reviewer_user_id)].filter(
          Boolean
        )
      )
    )
    const { data: profiles } =
      allUserIds.length > 0
        ? await supabase.from("profiles").select("id, first_name, last_name, department").in("id", allUserIds)
        : {
            data: [] as Array<{
              id: string
              first_name: string | null
              last_name: string | null
              department: string | null
            }>,
          }
    const profileById = new Map((profiles || []).map((p) => [p.id, p]))

    const enriched = (feedback || []).map((f) => ({
      ...f,
      subject: profileById.get(f.subject_user_id) || null,
      reviewer: profileById.get(f.reviewer_user_id) || null,
    }))

    return NextResponse.json({ data: enriched })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/peer-feedback")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

/**
 * POST /api/hr/performance/peer-feedback
 * Submit peer feedback for a colleague.
 * An employee cannot submit feedback for themselves.
 * One submission per reviewer+subject+cycle (upsert behaviour).
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-peer-feedback:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = SubmitPeerFeedbackSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const {
      subject_user_id,
      review_cycle_id,
      score,
      collaboration,
      communication,
      teamwork,
      professionalism,
      comments,
    } = parsed.data

    if (subject_user_id === user.id) {
      return NextResponse.json({ error: "You cannot submit peer feedback for yourself" }, { status: 400 })
    }

    // Check the review cycle exists
    const { data: cycle } = await supabase
      .from("review_cycles")
      .select("id, status")
      .eq("id", review_cycle_id)
      .maybeSingle()
    if (!cycle) {
      return NextResponse.json({ error: "Review cycle not found" }, { status: 404 })
    }

    // Upsert: one feedback entry per reviewer+subject+cycle
    const { data: existing } = await adminSupabase
      .from("peer_feedback")
      .select("id")
      .eq("reviewer_user_id", user.id)
      .eq("subject_user_id", subject_user_id)
      .eq("review_cycle_id", review_cycle_id)
      .maybeSingle()

    const payload = {
      subject_user_id,
      reviewer_user_id: user.id,
      review_cycle_id,
      score,
      collaboration: collaboration ?? null,
      communication: communication ?? null,
      teamwork: teamwork ?? null,
      professionalism: professionalism ?? null,
      comments: comments ?? null,
      status: "submitted",
      updated_at: new Date().toISOString(),
    }

    const { data: feedback, error } = existing
      ? await adminSupabase.from("peer_feedback").update(payload).eq("id", existing.id).select("id").single()
      : await adminSupabase.from("peer_feedback").insert(payload).select("id").single()

    if (error || !feedback) {
      log.error({ err: String(error) }, "Error saving peer feedback")
      return NextResponse.json({ error: "Failed to save peer feedback" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: existing ? "update" : "create",
        entityType: "peer_feedback",
        entityId: feedback.id,
        newValues: { subject_user_id, review_cycle_id, score, status: "submitted" },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/peer-feedback" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: feedback,
      message: existing ? "Peer feedback updated" : "Peer feedback submitted",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/performance/peer-feedback")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
