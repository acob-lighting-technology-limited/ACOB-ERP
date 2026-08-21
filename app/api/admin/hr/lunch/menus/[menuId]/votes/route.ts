import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { loadMenuById, loadVotesForMenu } from "@/lib/hr/lunch-menu-server"
import { loadLunchSettings, lunchCostBreakdown, notEatingTally, tallyVotes } from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-votes")
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ menuId: string }> }

/**
 * Sets or clears a staff member's answer on behalf of Admin and HR.
 *
 * Unlike the staff route this deliberately ignores the voting deadline: the
 * whole point is to fix up a day after the cut-off — somebody travelled,
 * somebody turned up unannounced — without reopening the poll for everyone.
 * The lunch register is kept in step so payroll matches the corrected answer.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { menuId } = await params
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = (await request.json()) as {
      userId?: string
      /** false = the NO answer; null = remove the vote entirely. */
      eating?: boolean | null
      selections?: Record<string, string>
    }

    const userId = body.userId
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const [settings, menu] = await Promise.all([loadLunchSettings(dataClient), loadMenuById(dataClient, menuId)])
    if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 })

    const clearing = body.eating === null
    const eating = body.eating === true
    const selections = eating ? body.selections || {} : {}

    if (clearing) {
      const { error } = await dataClient.from("lunch_votes").delete().eq("menu_id", menu.id).eq("user_id", userId)
      if (error) throw new Error(`Failed to remove vote: ${error.message}`)
    } else {
      if (eating) {
        const missing = menu.groups.filter((group) => group.is_required && !selections[group.id])
        if (missing.length > 0) {
          return NextResponse.json(
            { error: `Choose a ${missing.map((g) => g.name || "dish").join(" and ")} for them` },
            { status: 400 }
          )
        }
        for (const group of menu.groups) {
          const optionId = selections[group.id]
          if (!optionId) continue
          if (!group.options.some((o) => o.id === optionId)) {
            return NextResponse.json({ error: "Selection does not match this menu" }, { status: 400 })
          }
        }
      }

      const { data: voteRow, error: voteError } = await dataClient
        .from("lunch_votes")
        .upsert(
          { menu_id: menu.id, user_id: userId, is_eating: eating, updated_at: new Date().toISOString() },
          { onConflict: "menu_id,user_id" }
        )
        .select("id")
        .single()

      if (voteError || !voteRow) throw new Error(`Failed to save vote: ${voteError?.message}`)

      await dataClient.from("lunch_vote_selections").delete().eq("vote_id", voteRow.id)

      const rows = Object.entries(selections)
        .filter(([, optionId]) => Boolean(optionId))
        .map(([groupId, optionId]) => ({ vote_id: voteRow.id, group_id: groupId, option_id: optionId }))

      if (rows.length > 0) {
        const { error: insertError } = await dataClient.from("lunch_vote_selections").insert(rows)
        if (insertError) throw new Error(`Failed to save selections: ${insertError.message}`)
      }
    }

    // Keep the payroll-facing register in step with the corrected answer.
    if (!clearing && eating) {
      const { cost, companySubsidy, employeeDeduction } = lunchCostBreakdown(settings)
      const { error: logError } = await dataClient.from("attendance_lunch_log").upsert(
        {
          user_id: userId,
          date: menu.date,
          cost,
          company_subsidy: companySubsidy,
          employee_deduction: employeeDeduction,
          created_by: scope.userId,
        },
        { onConflict: "user_id,date" }
      )
      if (logError) log.error({ err: logError.message, userId, date: menu.date }, "lunch register sync failed")
    } else {
      const { error: logError } = await dataClient
        .from("attendance_lunch_log")
        .delete()
        .eq("user_id", userId)
        .eq("date", menu.date)
      if (logError) log.error({ err: logError.message, userId, date: menu.date }, "lunch register cleanup failed")
    }

    const votes = await loadVotesForMenu(dataClient, menu.id)

    return NextResponse.json({
      success: true,
      votes,
      tallies: [...tallyVotes(menu.groups, votes), notEatingTally(votes)],
      eatingCount: votes.filter((v) => v.is_eating).length,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/lunch/menus/[menuId]/votes")
    return NextResponse.json({ error: "Failed to update that vote" }, { status: 500 })
  }
}
