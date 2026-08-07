import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { loadMenuForDate, loadVotesForMenu } from "@/lib/hr/lunch-menu-server"
import {
  isVotingOpen,
  loadLunchSettings,
  lunchCostBreakdown,
  resolveVotingDeadline,
  tallyVotes,
} from "@/lib/hr/lunch-voting"
import { toLocalISODate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("api-hr-lunch")
export const dynamic = "force-dynamic"

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Staff-facing lunch poll for a single day. Returns the published menu, the
 * caller's own vote, and every colleague's vote — the poll deliberately shows
 * who picked what, so results carry voter names.
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
    const date = dateParam || toLocalISODate()

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const settings = await loadLunchSettings(dataClient)
    const menu = await loadMenuForDate(dataClient, date)

    const { cost, companySubsidy, employeeDeduction } = lunchCostBreakdown(settings)
    const pricing = { cost, company_subsidy: companySubsidy, employee_deduction: employeeDeduction }

    if (!menu) {
      return NextResponse.json({
        date,
        menu: null,
        votes: [],
        tallies: [],
        myVote: null,
        votingOpen: false,
        deadline: null,
        pricing,
        eatingDays: settings.eating_days,
      })
    }

    const votes = await loadVotesForMenu(dataClient, menu.id)
    const myVote = votes.find((v) => v.user_id === user.id) || null

    return NextResponse.json({
      date,
      menu,
      votes,
      tallies: tallyVotes(menu.groups, votes),
      myVote,
      votingOpen: isVotingOpen(menu, settings),
      deadline: resolveVotingDeadline(menu, settings).toISOString(),
      pricing,
      eatingDays: settings.eating_days,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/lunch")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
