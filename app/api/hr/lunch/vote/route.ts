import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { loadMenuById, loadVotesForMenu } from "@/lib/hr/lunch-menu-server"
import { isVotingOpen, loadLunchSettings, lunchCostBreakdown, tallyVotes } from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"

const log = logger("api-hr-lunch-vote")
export const dynamic = "force-dynamic"

/**
 * Casting a vote is also the commitment to eat: it writes the day's
 * attendance_lunch_log row, which is what the STAFF LUNCH payroll deduction
 * sums over. Retracting a vote removes that row again.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json()) as { menuId?: string; selections?: Record<string, string> }
    const menuId = body.menuId
    const selections = body.selections

    if (!menuId || !selections || typeof selections !== "object") {
      return NextResponse.json({ error: "menuId and selections are required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const [settings, menu] = await Promise.all([loadLunchSettings(dataClient), loadMenuById(dataClient, menuId)])

    if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 })
    if (menu.status !== "published") {
      return NextResponse.json({ error: "This menu is not open for voting" }, { status: 409 })
    }
    if (!isVotingOpen(menu, settings)) {
      return NextResponse.json({ error: "Voting has closed for this menu" }, { status: 409 })
    }

    // A vote must answer every REQUIRED category. A two-category day (soup +
    // what you eat it with) is not a valid vote with only the soup — such a
    // partial vote is rejected outright rather than stored. Categories the
    // admin marked optional may be left unanswered.
    const missing = menu.groups.filter((group) => group.is_required && !selections[group.id])
    if (missing.length > 0) {
      const names = missing.map((g) => g.name)
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      return NextResponse.json({ error: `Please choose your ${list}` }, { status: 400 })
    }

    // Each pick must be an available option belonging to the category it was
    // submitted under — one option per category, never one from elsewhere.
    for (const group of menu.groups) {
      const optionId = selections[group.id]
      if (!optionId) continue // a skipped optional category
      const option = group.options.find((o) => o.id === optionId)
      if (!option) {
        return NextResponse.json({ error: `Invalid choice for ${group.name}` }, { status: 400 })
      }
      if (!option.is_available) {
        return NextResponse.json({ error: `${option.name} is no longer available` }, { status: 409 })
      }
    }

    const validGroupIds = new Set(menu.groups.map((g) => g.id))
    const submittedGroupIds = Object.keys(selections)
    if (submittedGroupIds.some((id) => !validGroupIds.has(id))) {
      return NextResponse.json({ error: "Selection does not match this menu" }, { status: 400 })
    }

    // One vote row per (menu, user) — re-voting updates the existing row.
    const { data: voteRow, error: voteError } = await dataClient
      .from("lunch_votes")
      .upsert(
        { menu_id: menu.id, user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: "menu_id,user_id" }
      )
      .select("id")
      .single()

    if (voteError || !voteRow) {
      throw new Error(`Failed to save vote: ${voteError?.message || "no row returned"}`)
    }

    const { error: clearError } = await dataClient.from("lunch_vote_selections").delete().eq("vote_id", voteRow.id)
    if (clearError) throw new Error(`Failed to replace previous selections: ${clearError.message}`)

    const rows = submittedGroupIds
      .filter((groupId) => selections[groupId])
      .map((groupId) => ({ vote_id: voteRow.id, group_id: groupId, option_id: selections[groupId] }))

    if (rows.length > 0) {
      const { error: insertError } = await dataClient.from("lunch_vote_selections").insert(rows)
      if (insertError) throw new Error(`Failed to save selections: ${insertError.message}`)
    }

    // Voting commits the meal, so mirror it into the payroll-facing register.
    const { cost, companySubsidy, employeeDeduction } = lunchCostBreakdown(settings)
    const { error: logError } = await dataClient.from("attendance_lunch_log").upsert(
      {
        user_id: user.id,
        date: menu.date,
        cost,
        company_subsidy: companySubsidy,
        employee_deduction: employeeDeduction,
        created_by: user.id,
      },
      { onConflict: "user_id,date" }
    )
    if (logError) {
      log.error({ err: logError.message, userId: user.id, date: menu.date }, "lunch register sync failed")
    }

    const votes = await loadVotesForMenu(dataClient, menu.id)

    return NextResponse.json({
      success: true,
      votes,
      tallies: tallyVotes(menu.groups, votes),
      myVote: votes.find((v) => v.user_id === user.id) || null,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/lunch/vote")
    return NextResponse.json({ error: "Failed to save your vote" }, { status: 500 })
  }
}

/** Retracts the caller's vote and removes the matching lunch register row. */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const menuId = request.nextUrl.searchParams.get("menuId")
    if (!menuId) return NextResponse.json({ error: "menuId is required" }, { status: 400 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const [settings, menu] = await Promise.all([loadLunchSettings(dataClient), loadMenuById(dataClient, menuId)])

    if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 })
    if (!isVotingOpen(menu, settings)) {
      return NextResponse.json({ error: "Voting has closed for this menu" }, { status: 409 })
    }

    const { error: deleteError } = await dataClient
      .from("lunch_votes")
      .delete()
      .eq("menu_id", menu.id)
      .eq("user_id", user.id)
    if (deleteError) throw new Error(`Failed to withdraw vote: ${deleteError.message}`)

    const { error: logError } = await dataClient
      .from("attendance_lunch_log")
      .delete()
      .eq("user_id", user.id)
      .eq("date", menu.date)
    if (logError) {
      log.error({ err: logError.message, userId: user.id, date: menu.date }, "lunch register cleanup failed")
    }

    const votes = await loadVotesForMenu(dataClient, menu.id)

    return NextResponse.json({
      success: true,
      votes,
      tallies: tallyVotes(menu.groups, votes),
      myVote: null,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/hr/lunch/vote")
    return NextResponse.json({ error: "Failed to withdraw your vote" }, { status: 500 })
  }
}
