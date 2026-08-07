import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { toLocalYearMonth } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("api-hr-lunch-history")
export const dynamic = "force-dynamic"

type LunchLogRow = {
  date: string
  cost: number
  company_subsidy: number
  employee_deduction: number
}

type MenuRow = { id: string; date: string; title: string | null }
type GroupRow = { id: string; menu_id: string; name: string; position: number }
type OptionRow = { id: string; name: string }
type VoteRow = { id: string; menu_id: string }
type SelectionRow = { vote_id: string; group_id: string; option_id: string }

/**
 * The caller's own lunch register for a month: what they were charged each
 * day, and what they picked where a menu existed.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const yearMonth = String(request.nextUrl.searchParams.get("year_month") || toLocalYearMonth())
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: "year_month is invalid" }, { status: 400 })
    }

    const year = Number(yearMonth.slice(0, 4))
    const month = Number(yearMonth.slice(5, 7))
    const start = `${yearMonth}-01`
    const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const [{ data: logRows }, { data: menuRows }] = await Promise.all([
      dataClient
        .from("attendance_lunch_log")
        .select("date, cost, company_subsidy, employee_deduction")
        .eq("user_id", user.id)
        .gte("date", start)
        .lt("date", end)
        .order("date", { ascending: false }),
      dataClient.from("lunch_menus").select("id, date, title").gte("date", start).lt("date", end),
    ])

    const logs = (logRows || []) as LunchLogRow[]
    const menus = (menuRows || []) as MenuRow[]

    // Resolve what the user picked on each day that had a menu.
    const picksByDate = new Map<string, string[]>()
    if (menus.length > 0) {
      const { data: voteRows } = await dataClient
        .from("lunch_votes")
        .select("id, menu_id")
        .eq("user_id", user.id)
        .in(
          "menu_id",
          menus.map((m) => m.id)
        )

      const votes = (voteRows || []) as VoteRow[]
      if (votes.length > 0) {
        const { data: selectionRows } = await dataClient
          .from("lunch_vote_selections")
          .select("vote_id, group_id, option_id")
          .in(
            "vote_id",
            votes.map((v) => v.id)
          )
        const selections = (selectionRows || []) as SelectionRow[]

        const [{ data: groupRows }, { data: optionRows }] = await Promise.all([
          dataClient
            .from("lunch_menu_groups")
            .select("id, menu_id, name, position")
            .in(
              "menu_id",
              menus.map((m) => m.id)
            ),
          selections.length > 0
            ? dataClient
                .from("lunch_menu_options")
                .select("id, name")
                .in(
                  "id",
                  selections.map((s) => s.option_id)
                )
            : Promise.resolve({ data: [] as OptionRow[] }),
        ])

        const groups = (groupRows || []) as GroupRow[]
        const optionName = new Map(((optionRows || []) as OptionRow[]).map((o) => [o.id, o.name]))
        const groupPosition = new Map(groups.map((g) => [g.id, g.position]))
        const menuDate = new Map(menus.map((m) => [m.id, m.date]))

        for (const vote of votes) {
          const date = menuDate.get(vote.menu_id)
          if (!date) continue
          const picks = selections
            .filter((s) => s.vote_id === vote.id)
            .sort((a, b) => (groupPosition.get(a.group_id) ?? 0) - (groupPosition.get(b.group_id) ?? 0))
            .map((s) => optionName.get(s.option_id))
            .filter((name): name is string => Boolean(name))
          picksByDate.set(date, picks)
        }
      }
    }

    const menuTitle = new Map(menus.map((m) => [m.date, m.title]))

    return NextResponse.json({
      yearMonth,
      rows: logs.map((row) => ({
        ...row,
        menu_title: menuTitle.get(row.date) || null,
        picks: picksByDate.get(row.date) || [],
      })),
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/lunch/history")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
