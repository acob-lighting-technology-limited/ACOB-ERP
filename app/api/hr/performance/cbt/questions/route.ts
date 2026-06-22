import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("hr-performance-cbt-questions")

const QuestionSchema = z.object({
  review_cycle_id: z.string().uuid("Review cycle is required"),
  department: z.string().trim().min(1, "Department is required"),
  prompt: z.string().trim().min(1, "Question is required"),
  option_a: z.string().trim().min(1, "Option A is required"),
  option_b: z.string().trim().min(1, "Option B is required"),
  option_c: z.string().trim().min(1, "Option C is required"),
  option_d: z.string().trim().min(1, "Option D is required"),
  correct_option: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().trim().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  is_bonus: z.boolean().optional().default(false),
  targeted_emails: z.array(z.string()).optional().default([]),
})

type CbtQuestionRow = {
  id: string
  prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option: "A" | "B" | "C" | "D"
  explanation?: string | null
  is_active: boolean
  created_at: string
  review_cycle_id?: string | null
  department?: string | null
  is_bonus?: boolean
  targeted_emails?: string[] | null
}

async function getAuthorizedProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, user: null as null }
  return { supabase, dataClient: getServiceRoleClientOrFallback(supabase), user }
}

export async function GET(request: NextRequest) {
  try {
    const { dataClient, user } = await getAuthorizedProfile()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) {
      return contextResult.response
    }
    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.pms.cbt.manage")
    if (!routeAccess.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const cycleId = request.nextUrl.searchParams.get("cycle_id")
    const isBonusParam = request.nextUrl.searchParams.get("is_bonus")
    const fetchBonus = isBonusParam === "true"

    let query = dataClient
      .from("cbt_questions")
      .select(
        "id, review_cycle_id, department, prompt, option_a, option_b, option_c, option_d, correct_option, explanation, is_active, created_at, is_bonus, targeted_emails"
      )
      .eq("is_bonus", fetchBonus)
      .order("created_at", { ascending: false })

    if (cycleId) {
      query = query.eq("review_cycle_id", cycleId)
    }

    const { data, error } = await query.returns<CbtQuestionRow[]>()

    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load CBT questions")
    return NextResponse.json({ error: "Failed to load CBT questions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cbt-questions:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, dataClient, user } = await getAuthorizedProfile()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) {
      return contextResult.response
    }
    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.pms.cbt.manage")
    if (!routeAccess.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const parsed = QuestionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data, error } = await dataClient
      .from("cbt_questions")
      .insert({
        ...parsed.data,
        created_by: user.id,
      })
      .select(
        "id, review_cycle_id, department, prompt, option_a, option_b, option_c, option_d, correct_option, explanation, is_active, created_at, is_bonus, targeted_emails"
      )
      .single<CbtQuestionRow>()

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Failed to create question" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "cbt_question",
        entityId: data.id,
        newValues: { prompt: data.prompt, correct_option: data.correct_option, is_active: data.is_active },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cbt/questions" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    log.error({ err: JSON.stringify(error, Object.getOwnPropertyNames(error || {})) }, "Failed to create CBT question")
    return NextResponse.json({ error: "Failed to create CBT question" }, { status: 500 })
  }
}
