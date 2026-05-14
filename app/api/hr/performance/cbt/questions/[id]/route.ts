import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("hr-performance-cbt-question-detail")

const UpdateSchema = z.object({
  prompt: z.string().trim().min(1).optional(),
  option_a: z.string().trim().min(1).optional(),
  option_b: z.string().trim().min(1).optional(),
  option_c: z.string().trim().min(1).optional(),
  option_d: z.string().trim().min(1).optional(),
  correct_option: z.enum(["A", "B", "C", "D"]).optional(),
  explanation: z.string().trim().optional().nullable(),
  is_active: z.boolean().optional(),
})

async function getAuthorizedContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, user: null as null }
  return { supabase, dataClient: getServiceRoleClientOrFallback(supabase), user }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`hr-performance-cbt-questions:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, dataClient, user } = await getAuthorizedContext()
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

    const parsed = UpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data, error } = await dataClient
      .from("cbt_questions")
      .update(parsed.data)
      .eq("id", params.id)
      .select(
        "id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, correct_option, explanation, is_active, created_at"
      )
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Failed to update question" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "cbt_question",
        entityId: params.id,
        newValues: parsed.data,
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cbt/questions/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to update CBT question")
    return NextResponse.json({ error: "Failed to update CBT question" }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit("hr-performance-cbt-questions", { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, dataClient, user } = await getAuthorizedContext()
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

    const { error } = await dataClient.from("cbt_questions").delete().eq("id", params.id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "cbt_question",
        entityId: params.id,
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cbt/questions/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to delete CBT question")
    return NextResponse.json({ error: "Failed to delete CBT question" }, { status: 500 })
  }
}
