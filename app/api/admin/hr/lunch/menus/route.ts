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
  notEatingTally,
  resolveVotingDeadline,
  tallyVotes,
  type LunchMenuStatus,
} from "@/lib/hr/lunch-voting"
import { toLocalISODate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-menus")
export const dynamic = "force-dynamic"

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MENU_COLUMNS = "id, date, status, voting_deadline, published_at, closed_at, archived_at"

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
    const from = fromParam || shift(-180)
    const to = toParam || shift(60)

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const settings = await loadLunchSettings(dataClient)

    const { data: menuRows, error } = await dataClient
      .from("lunch_menus")
      .select(MENU_COLUMNS)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })

    if (error) throw new Error(`Failed to load menus: ${error.message}`)

    const menuIds = (menuRows || []).map((row) => row.id)
    const { data: reviewRows } =
      menuIds.length > 0
        ? await dataClient
            .from("lunch_reviews")
            .select("id, menu_id, rating, comment, created_at")
            .in("menu_id", menuIds)
        : { data: [] }

    const reviewsByMenu = new Map<
      string,
      { id: string; rating: number; comment: string | null; created_at: string }[]
    >()
    for (const r of (reviewRows || []) as {
      id: string
      menu_id: string
      rating: number
      comment: string | null
      created_at: string
    }[]) {
      reviewsByMenu.set(r.menu_id, [...(reviewsByMenu.get(r.menu_id) || []), r])
    }

    const menus = await Promise.all(
      (menuRows || []).map(async (row) => {
        const menu = await hydrateMenu(dataClient, row)
        const votes = await loadVotesForMenu(dataClient, menu.id)
        const menuReviews = reviewsByMenu.get(menu.id) || []
        const totalRating = menuReviews.reduce((sum, r) => sum + r.rating, 0)
        const averageRating = menuReviews.length > 0 ? Number((totalRating / menuReviews.length).toFixed(1)) : null

        return {
          ...menu,
          votes,
          // The NO answers ride along so admin sees who opted out.
          tallies: [...tallyVotes(menu.groups, votes), notEatingTally(votes)],
          eatingCount: votes.filter((v) => v.is_eating).length,
          votingOpen: isVotingOpen(menu, settings),
          resolvedDeadline: resolveVotingDeadline(menu, settings).toISOString(),
          review_count: menuReviews.length,
          average_rating: averageRating,
          reviews: menuReviews,
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

    // Only a live menu blocks the date. Cancelled ones stay as history, which
    // is the whole point of cancelling before putting up a different meal.
    const { data: existing } = await dataClient
      .from("lunch_menus")
      .select("id")
      .eq("date", body.date)
      .is("archived_at", null)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: "A menu is already up for that date. Edit it, or cancel it first to replace it." },
        { status: 409 }
      )
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
