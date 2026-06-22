import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

const log = logger("admin-hr-performance-cbt-attempts-detail")
export const dynamic = "force-dynamic"

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

    const { searchParams } = new URL(request.url)
    const profileId = searchParams.get("profile_id")
    const reviewCycleId = searchParams.get("review_cycle_id")

    if (!profileId || !reviewCycleId) {
      return NextResponse.json({ error: "profile_id and review_cycle_id are required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: attempt, error: attemptError } = await dataClient
      .from("cbt_attempts")
      .select("id, question_ids, answers, score, correct_answers, total_questions, submitted_at")
      .eq("profile_id", profileId)
      .eq("review_cycle_id", reviewCycleId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (attemptError) throw attemptError
    if (!attempt) {
      return NextResponse.json({ data: null })
    }

    const questionIds: string[] = (attempt.question_ids as string[]) || []
    let questions: unknown[] = []

    if (questionIds.length > 0) {
      const { data: questionsData, error: questionsError } = await dataClient
        .from("cbt_questions")
        .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, explanation")
        .in("id", questionIds)

      if (questionsError) throw questionsError
      questions = questionsData || []
    }

    return NextResponse.json({ data: { attempt, questions } })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load CBT attempt detail")
    return NextResponse.json({ error: "Failed to load CBT attempt detail" }, { status: 500 })
  }
}
