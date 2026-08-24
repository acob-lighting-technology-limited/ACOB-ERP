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
  review_type: string
}

type CycleWindow = {
  name: string
  start_date: string
  end_date: string
}

/** Typed from its own factory so callers share one concrete client type. */
function serviceClient(url: string, key: string) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

type Supabase = ReturnType<typeof serviceClient>

/** Calendar quarter containing `date`. */
function quarterFor(date: Date): CycleWindow {
  const year = date.getFullYear()
  const quarter = Math.floor(date.getMonth() / 3) + 1
  const startMonth = (quarter - 1) * 3
  const start = new Date(year, startMonth, 1)
  const end = new Date(year, startMonth + 3, 0) // day 0 of next month = last day of this one
  return {
    name: `Q${quarter} ${year} Performance Review`,
    start_date: toLocalISODate(start),
    end_date: toLocalISODate(end),
  }
}

/** Calendar half-year (H1/H2) containing `date`. */
function biannualFor(date: Date): CycleWindow {
  const year = date.getFullYear()
  const half = date.getMonth() < 6 ? 1 : 2
  const start = new Date(year, half === 1 ? 0 : 6, 1)
  const end = new Date(year, half === 1 ? 6 : 12, 0)
  return {
    name: `H${half} ${year} Performance Review`,
    start_date: toLocalISODate(start),
    end_date: toLocalISODate(end),
  }
}

/** Calendar year containing `date`. */
function annualFor(date: Date): CycleWindow {
  const year = date.getFullYear()
  return {
    name: `FY ${year} Annual Performance Review`,
    start_date: toLocalISODate(new Date(year, 0, 1)),
    end_date: toLocalISODate(new Date(year, 11, 31)),
  }
}

/**
 * Ensures one active cycle per cadence, for whichever window contains today,
 * and retires any same-cadence cycle whose window has already ended.
 *
 * Applied once per cadence (quarterly, biannual, annual) so nothing has to be
 * duplicated per caller — a new year rolling in creates its Q1, its H1, and
 * its FY row in the same run, the same way Q4 2026 already exists ahead of
 * October because this function ran in advance of it.
 */
async function ensureCadence(
  supabase: Supabase,
  reviewType: "quarterly" | "biannual" | "annual",
  window: CycleWindow,
  today: string
) {
  const { data: cycles, error: loadError } = await supabase
    .from("review_cycles")
    .select("id, name, start_date, end_date, status, review_type")
    .eq("review_type", reviewType)
    .returns<ReviewCycleRow[]>()

  if (loadError) throw loadError

  const existing = (cycles || []).find(
    (cycle) => cycle.start_date === window.start_date && cycle.end_date === window.end_date
  )

  let currentId = existing?.id ?? null
  let created = false

  if (!existing) {
    const { data: inserted, error: insertError } = await supabase
      .from("review_cycles")
      .insert({
        name: window.name,
        start_date: window.start_date,
        end_date: window.end_date,
        review_type: reviewType,
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

  return { cycle_id: currentId, name: window.name, created, closed: staleActiveIds.length }
}

/**
 * Keeps a review cycle covering today, for every cadence.
 *
 * Every PMS metric is computed over the selected cycle's window. When the
 * newest cycle of a cadence ends and nobody creates the next one, that window
 * is already closed and the dashboard renders blank — which is exactly what
 * happened when the sole "active" cycle (Q4 2025) sat eight months in the past
 * while 1,144 attendance records piled up outside every cycle.
 *
 * Originally this only covered quarterly cycles; H1/H2/FY existed only because
 * they were seeded by hand once. That meant nothing would create H1 2027, H2
 * 2027 or FY 2027 when the time came. Each cadence is now generated the same
 * way, so entering a new quarter, half-year or year needs no manual step.
 *
 * Idempotent — a run that finds everything in order changes nothing.
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

  const supabase = serviceClient(supabaseUrl, supabaseServiceKey)

  try {
    const now = new Date()
    const today = toLocalISODate()

    const [quarterly, biannual, annual] = await Promise.all([
      ensureCadence(supabase, "quarterly", quarterFor(now), today),
      ensureCadence(supabase, "biannual", biannualFor(now), today),
      ensureCadence(supabase, "annual", annualFor(now), today),
    ])

    log.info({ quarterly, biannual, annual }, "Review cycle upkeep complete")

    return NextResponse.json({ data: { quarterly, biannual, annual } })
  } catch (error) {
    log.error({ err: String(error) }, "Review cycle upkeep failed")
    return NextResponse.json({ error: "Failed to ensure current review cycles" }, { status: 500 })
  }
}
