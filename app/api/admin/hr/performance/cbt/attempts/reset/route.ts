import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { canMutateV2 } from "@/lib/admin/policy-v2"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"

const log = logger("admin-hr-performance-cbt-attempts-reset")
export const dynamic = "force-dynamic"

const ResetSchema = z.object({
  profile_id: z.string().uuid("A valid employee is required"),
  review_cycle_id: z.string().uuid("A valid review cycle is required"),
})

export async function POST(request: NextRequest) {
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

    const parsed = ResetSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { profile_id, review_cycle_id } = parsed.data

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // enforceRouteAccessV2 only confirms the caller can reach this route at
    // all — a lead's grant is department-scoped, so without this a lead could
    // reset any employee's attempt, not just their own department's.
    const { data: targetProfile } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", profile_id)
      .maybeSingle<{ department: string | null }>()

    if (!targetProfile) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 })
    }
    if (!canMutateV2(contextResult.context, "hr.pms.cbt.manage", targetProfile.department)) {
      return NextResponse.json({ error: "You can only reset CBT attempts for your own department" }, { status: 403 })
    }

    // Clears every attempt (in_progress or submitted) for this profile/cycle
    // so the unique in_progress index doesn't block a retake and the old
    // submitted attempt no longer shows in the admin detail view.
    const { data: deletedAttempts, error: deleteAttemptsError } = await dataClient
      .from("cbt_attempts")
      .delete()
      .eq("profile_id", profile_id)
      .eq("review_cycle_id", review_cycle_id)
      .select("id, status, score")

    if (deleteAttemptsError) throw deleteAttemptsError

    const { data: existingReview, error: reviewLookupError } = await dataClient
      .from("performance_reviews")
      .select("id, cbt_score")
      .eq("user_id", profile_id)
      .eq("review_cycle_id", review_cycle_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; cbt_score: number | null }>()

    if (reviewLookupError) throw reviewLookupError

    if (existingReview && existingReview.cbt_score !== null) {
      const { error: clearScoreError } = await dataClient
        .from("performance_reviews")
        .update({ cbt_score: null })
        .eq("id", existingReview.id)

      if (clearScoreError) throw clearScoreError
    }

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "cbt_attempt",
        entityId: profile_id,
        oldValues: {
          profile_id,
          review_cycle_id,
          deleted_attempts: deletedAttempts?.map((a) => ({ id: a.id, status: a.status, score: a.score })) ?? [],
          cleared_review_score: existingReview?.cbt_score ?? null,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/admin/hr/performance/cbt/attempts/reset",
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: { deleted_attempts: deletedAttempts?.length ?? 0 },
      message: "CBT attempt reset. The employee can retake this cycle's assessment.",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to reset CBT attempt")
    return NextResponse.json({ error: "Failed to reset CBT attempt" }, { status: 500 })
  }
}
