import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("api-reports-kss-results")

const CreateKssResultSchema = z.object({
  roster_id: z.string().uuid("roster_id must be a valid uuid"),
  score: z.number().min(0).max(100),
  feedback: z.string().trim().max(5000).optional().nullable(),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rosterId = new URL(request.url).searchParams.get("roster_id")
    let query = supabase
      .from("kss_results")
      .select(
        "id, roster_id, presenter_id, evaluator_id, score, feedback, meeting_week, meeting_year, created_at, updated_at"
      )
      .order("created_at", { ascending: false })

    if (rosterId) {
      query = query.eq("roster_id", rosterId)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "GET /api/reports/kss-results failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`reports-kss-results:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    const parsed = CreateKssResultSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data: roster, error: rosterError } = await supabase
      .from("kss_weekly_roster")
      .select("id, presenter_id, presenter_name, meeting_week, meeting_year")
      .eq("id", parsed.data.roster_id)
      .single<{
        id: string
        presenter_id?: string | null
        presenter_name?: string | null
        meeting_week: number
        meeting_year: number
      }>()

    if (rosterError || !roster) {
      return NextResponse.json({ error: "KSS roster entry not found" }, { status: 404 })
    }

    if (!roster.presenter_id) {
      if (roster.presenter_name) {
        return NextResponse.json({ error: "Visitor presenters cannot be scored yet" }, { status: 400 })
      }
      return NextResponse.json({ error: "This KSS roster entry does not have a presenter yet" }, { status: 400 })
    }

    if (roster.presenter_id === user.id) {
      return NextResponse.json({ error: "Presenters cannot score themselves" }, { status: 400 })
    }

    const payload = {
      roster_id: parsed.data.roster_id,
      presenter_id: roster.presenter_id,
      evaluator_id: user.id,
      score: parsed.data.score,
      feedback: parsed.data.feedback ?? null,
      meeting_week: roster.meeting_week,
      meeting_year: roster.meeting_year,
      updated_at: new Date().toISOString(),
    }

    const { data: saved, error } = await supabase
      .from("kss_results")
      .upsert(payload, { onConflict: "roster_id,evaluator_id" })
      .select(
        "id, roster_id, presenter_id, evaluator_id, score, feedback, meeting_week, meeting_year, created_at, updated_at"
      )
      .single()

    if (error || !saved) {
      return NextResponse.json({ error: error?.message || "Failed to save KSS result" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "kss_result.upsert",
        entityType: "kss_result",
        entityId: saved.id,
        newValues: {
          roster_id: saved.roster_id,
          presenter_id: saved.presenter_id,
          evaluator_id: saved.evaluator_id,
          score: saved.score,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/kss-results",
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: saved }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "POST /api/reports/kss-results failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
