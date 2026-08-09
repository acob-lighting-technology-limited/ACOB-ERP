import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { loadMenuForDate, loadMenusInRange, loadVotesForMenu } from "@/lib/hr/lunch-menu-server"
import {
  isVotingOpen,
  loadLunchSettings,
  lunchCostBreakdown,
  resolveVotingDeadline,
  LUNCH_LOOKAHEAD_DAYS,
  LUNCH_LOOKBACK_DAYS,
} from "@/lib/hr/lunch-voting"
import { toLocalISODate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("api-hr-lunch")
export const dynamic = "force-dynamic"

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Staff-facing lunch poll. Returns every published day in the window — voting
 * normally happens the day before, so the page is not limited to today — plus
 * the votes on the requested day. Votes carry voter names and photos: the poll
 * deliberately shows who picked what.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const dateParam = request.nextUrl.searchParams.get("date")
    if (dateParam && !DATE_PATTERN.test(dateParam)) {
      return NextResponse.json({ error: "date is invalid" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const settings = await loadLunchSettings(dataClient)

    const today = toLocalISODate()
    const shift = (days: number) => {
      const d = new Date(`${today}T12:00:00+01:00`)
      d.setDate(d.getDate() + days)
      return toLocalISODate(d)
    }

    // The window drives the "jump to" hints only; the calendar itself is
    // unbounded, so an explicit date is fetched directly and may sit outside it.
    const menus = await loadMenusInRange(dataClient, shift(-LUNCH_LOOKBACK_DAYS), shift(LUNCH_LOOKAHEAD_DAYS))

    // An explicit date wins even when nothing is published for it — staff can
    // look at any day, and an empty day says so. With no date asked for, land
    // on today, else the next published day.
    const selected = dateParam
      ? await loadMenuForDate(dataClient, dateParam)
      : (menus.find((m) => m.date === today) ?? menus.find((m) => m.date > today) ?? menus.at(-1) ?? null)

    const votes = selected ? await loadVotesForMenu(dataClient, selected.id) : []
    const { cost, companySubsidy, employeeDeduction } = lunchCostBreakdown(settings)

    return NextResponse.json({
      today,
      selectedDate: dateParam ?? selected?.date ?? today,
      // One entry per published day, so the picker can show which days are
      // open and where this person has already voted.
      days: menus.map((menu) => ({
        date: menu.date,
        menu_id: menu.id,
        votingOpen: isVotingOpen(menu, settings),
        deadline: resolveVotingDeadline(menu, settings).toISOString(),
      })),
      menu: selected,
      votes,
      votingOpen: selected ? isVotingOpen(selected, settings) : false,
      deadline: selected ? resolveVotingDeadline(selected, settings).toISOString() : null,
      pricing: { cost, company_subsidy: companySubsidy, employee_deduction: employeeDeduction },
      eatingDays: settings.eating_days,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/lunch")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
