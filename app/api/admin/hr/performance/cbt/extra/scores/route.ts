import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

const log = logger("admin-hr-performance-cbt-extra-scores")
export const dynamic = "force-dynamic"

type AttemptRow = {
  id: string
  profile_id: string
  review_cycle_id: string | null
  question_ids: string[]
  answers: Record<string, "A" | "B" | "C" | "D"> | null
  submitted_at: string | null
  cbt_details: {
    bonus_score?: number | null
    bonus_correct_answers?: number
    bonus_total_questions?: number
  } | null
  profiles: {
    id: string
    first_name: string | null
    last_name: string | null
    department: string | null
    company_email: string | null
  } | null
  review_cycles: { id: string; name: string } | null
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

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: attempts, error: attemptsError } = await dataClient
      .from("cbt_attempts")
      .select(
        `
        id,
        profile_id,
        review_cycle_id,
        question_ids,
        answers,
        submitted_at,
        cbt_details,
        profiles ( id, first_name, last_name, department, company_email ),
        review_cycles ( id, name )
      `
      )
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .returns<AttemptRow[]>()

    if (attemptsError) throw attemptsError

    // Only attempts that actually included a bonus question — the field is
    // absent (undefined) on attempts submitted before bonus scoring existed,
    // and 0 on attempts with no targeted bonus question for that candidate.
    const bonusAttempts = (attempts || []).filter((a) => (a.cbt_details?.bonus_total_questions ?? 0) > 0)

    const allBonusQuestionIds = Array.from(new Set(bonusAttempts.flatMap((a) => a.question_ids || [])))

    const { data: bonusQuestions, error: questionsError } = await dataClient
      .from("cbt_questions")
      .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, explanation")
      .in("id", allBonusQuestionIds.length > 0 ? allBonusQuestionIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("is_bonus", true)

    if (questionsError) throw questionsError

    const bonusQuestionMap = new Map((bonusQuestions || []).map((q) => [q.id, q]))

    const rows = bonusAttempts.map((attempt) => {
      const bonusQuestionIdsForAttempt = (attempt.question_ids || []).filter((id) => bonusQuestionMap.has(id))
      return {
        attempt_id: attempt.id,
        profile_id: attempt.profile_id,
        employee: [attempt.profiles?.first_name, attempt.profiles?.last_name].filter(Boolean).join(" ") || "Employee",
        department: attempt.profiles?.department || "-",
        company_email: attempt.profiles?.company_email || "-",
        review_cycle_id: attempt.review_cycle_id,
        cycle: attempt.review_cycles?.name || "-",
        submitted_at: attempt.submitted_at,
        bonus_score: attempt.cbt_details?.bonus_score ?? null,
        bonus_correct_answers: attempt.cbt_details?.bonus_correct_answers ?? 0,
        bonus_total_questions: attempt.cbt_details?.bonus_total_questions ?? 0,
        bonus_questions: bonusQuestionIdsForAttempt.map((id) => {
          const question = bonusQuestionMap.get(id)!
          return {
            id: question.id,
            prompt: question.prompt,
            options: {
              A: question.option_a,
              B: question.option_b,
              C: question.option_c,
              D: question.option_d,
            },
            correct_option: question.correct_option,
            explanation: question.explanation,
            chosen: attempt.answers?.[id] || null,
          }
        }),
      }
    })

    return NextResponse.json({ data: rows })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load CBT bonus question scores")
    return NextResponse.json({ error: "Failed to load CBT bonus question scores" }, { status: 500 })
  }
}
