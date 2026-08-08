import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import {
  hydrateMenu,
  loadVotesForMenu,
  normalizeMenuGroups,
  notifyStaffOfMenu,
  writeMenuGroups,
  type MenuGroupInput,
} from "@/lib/hr/lunch-menu-server"
import {
  deadlineForDate,
  isValidDeadlineTime,
  isVotingOpen,
  loadLunchSettings,
  resolveVotingDeadline,
  tallyVotes,
  type LunchMenuStatus,
} from "@/lib/hr/lunch-voting"
import { toLocalISODate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-menus")
export const dynamic = "force-dynamic"

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MENU_COLUMNS = "id, date, status, voting_deadline, published_at, closed_at"

/**
 * Lists menus in a date window (defaults to the last 14 and next 14 days),
 * each hydrated with its groups, options, votes and tallies so the admin
 * Menu & Votes tab renders in one round-trip.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { searchParams } = request.nextUrl
    const fromParam = searchParams.get("from")
    const toParam = searchParams.get("to")
    if ((fromParam && !DATE_PATTERN.test(fromParam)) || (toParam && !DATE_PATTERN.test(toParam))) {
      return NextResponse.json({ error: "from/to are invalid" }, { status: 400 })
    }

    const shift = (days: number) => {
      const d = new Date()
      d.setDate(d.getDate() + days)
      return toLocalISODate(d)
    }
    const from = fromParam || shift(-14)
    const to = toParam || shift(14)

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const settings = await loadLunchSettings(dataClient)

    const { data: menuRows, error } = await dataClient
      .from("lunch_menus")
      .select(MENU_COLUMNS)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })

    if (error) throw new Error(`Failed to load menus: ${error.message}`)

    const menus = await Promise.all(
      (menuRows || []).map(async (row) => {
        const menu = await hydrateMenu(dataClient, row)
        const votes = await loadVotesForMenu(dataClient, menu.id)
        return {
          ...menu,
          votes,
          tallies: tallyVotes(menu.groups, votes),
          votingOpen: isVotingOpen(menu, settings),
          resolvedDeadline: resolveVotingDeadline(menu, settings).toISOString(),
        }
      })
    )

    return NextResponse.json({ menus, settings })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/lunch/menus")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Creates a menu for a date, with its groups and options. A date holds at most
 * one menu — a repeat call is rejected so an existing menu's votes can never
 * be silently discarded.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = (await request.json()) as {
      date?: string
      status?: LunchMenuStatus
      deadline_time?: string | null
      groups?: MenuGroupInput[]
    }

    if (!body.date || !DATE_PATTERN.test(body.date)) {
      return NextResponse.json({ error: "A valid date is required" }, { status: 400 })
    }
    if (body.status && !["draft", "published"].includes(body.status)) {
      return NextResponse.json({ error: "status must be draft or published" }, { status: 400 })
    }
    if (body.deadline_time != null && !isValidDeadlineTime(body.deadline_time)) {
      return NextResponse.json({ error: "deadline_time must be HH:MM" }, { status: 400 })
    }
    const groups = normalizeMenuGroups(body.groups)
    if ("error" in groups) return NextResponse.json({ error: groups.error }, { status: 400 })

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: existing } = await dataClient.from("lunch_menus").select("id").eq("date", body.date).maybeSingle()
    if (existing) {
      return NextResponse.json({ error: "A menu already exists for that date. Edit it instead." }, { status: 409 })
    }

    const status: LunchMenuStatus = body.status || "draft"
    const { data: menuRow, error: menuError } = await dataClient
      .from("lunch_menus")
      .insert({
        date: body.date,
        status,
        // Null is the normal case: the cut-off is then derived from
        // lunch_settings.voting_deadline at read time, so changing that setting
        // moves every menu instead of leaving stale copies behind. A value is
        // written only when the admin deliberately overrode this one day.
        voting_deadline: body.deadline_time ? deadlineForDate(body.date, body.deadline_time).toISOString() : null,
        published_at: status === "published" ? new Date().toISOString() : null,
        created_by: scope.userId,
      })
      .select(MENU_COLUMNS)
      .single()

    if (menuError || !menuRow) throw new Error(`Failed to create menu: ${menuError?.message}`)

    await writeMenuGroups(dataClient, menuRow.id, groups.value)

    if (status === "published") {
      await notifyStaffOfMenu(dataClient, menuRow.id, body.date, scope.userId)
    }

    return NextResponse.json({ success: true, menu: await hydrateMenu(dataClient, menuRow) })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/lunch/menus")
    return NextResponse.json({ error: "Failed to create menu" }, { status: 500 })
  }
}
