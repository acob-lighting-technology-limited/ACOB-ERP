import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("cron-pms-ensure-review-cycle")

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

type ReviewCycleRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string | null
}

/** Calendar quarter containing `date`, as the cycle that should exist for it. */
function quarterFor(date: Date) {
  const year = date.getFullYear()
  const quarter = Math.floor(date.getMonth() / 3) + 1
  const startMonth = (quarter - 1) * 3
  const start = new Date(year, startMonth, 1)
  // Day 0 of the following month is the last day of this one.
  const end = new Date(year, startMonth + 3, 0)
  return {
    quarter,
    year,
    name: `Q${quarter} ${year} Performance Review`,
    start_date: toLocalISODate(start),
    end_date: toLocalISODate(end),
  }
}

/**
 * Keeps a review cycle covering today.
 *
 * Every PMS metric is computed over the selected cycle's window. When the
 * newest cycle ends and nobody creates the next one, that window is already
 * closed and attendance renders blank — which is exactly what happened when
 * the sole "active" cycle (Q4 2025) sat eight months in the past while 1,144
 * attendance records piled up outside every cycle.
 *
 * Each run: create the current quarter's cycle if missing, mark it active, and
 * close any other cycle whose end date has passed. Idempotent — a run that
 * finds everything in order changes nothing.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`
  if (!safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const today = toLocalISODate()
    const target = quarterFor(new Date())

    const { data: cycles, error: loadError } = await supabase
      .from("review_cycles")
      .select("id, name, start_date, end_date, status")
      .eq("review_type", "quarterly")
      .returns<ReviewCycleRow[]>()

    if (loadError) throw loadError

    const existing = (cycles || []).find(
      (cycle) => cycle.start_date === target.start_date && cycle.end_date === target.end_date
    )

    let currentId = existing?.id ?? null
    let created = false

    if (!existing) {
      const { data: inserted, error: insertError } = await supabase
        .from("review_cycles")
        .insert({
          name: target.name,
          start_date: target.start_date,
          end_date: target.end_date,
          review_type: "quarterly",
          status: "active",
        })
        .select("id")
        .single<{ id: string }>()

      if (insertError) throw insertError
      currentId = inserted.id
      created = true
    } else if (existing.status !== "active") {
      const { error: activateError } = await supabase
        .from("review_cycles")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", existing.id)
      if (activateError) throw activateError
    }

    // Exactly one cycle should be active: retire any that has already ended.
    const staleActiveIds = (cycles || [])
      .filter((cycle) => cycle.status === "active" && cycle.id !== currentId && cycle.end_date < today)
      .map((cycle) => cycle.id)

    if (staleActiveIds.length > 0) {
      const { error: closeError } = await supabase
        .from("review_cycles")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .in("id", staleActiveIds)
      if (closeError) throw closeError
    }

    log.info({ currentId, created, closed: staleActiveIds.length }, "Review cycle upkeep complete")

    return NextResponse.json({
      data: { cycle_id: currentId, name: target.name, created, closed: staleActiveIds.length },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Review cycle upkeep failed")
    return NextResponse.json({ error: "Failed to ensure a current review cycle" }, { status: 500 })
  }
}
