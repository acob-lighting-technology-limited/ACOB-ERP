import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import {
  hydrateMenu,
  normalizeMenuGroups,
  notifyStaffOfMenu,
  writeMenuGroups,
  type MenuGroupInput,
} from "@/lib/hr/lunch-menu-server"
import {
  deadlineForDate,
  isValidDeadlineTime,
  loadLunchSettings,
  lunchCostBreakdown,
  type LunchMenuStatus,
} from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-menu")
export const dynamic = "force-dynamic"

const MENU_COLUMNS = "id, date, status, voting_deadline, published_at, closed_at, archived_at"

type RouteContext = { params: Promise<{ menuId: string }> }

async function countVotes(client: SupabaseClient, menuId: string) {
  const { count } = await client.from("lunch_votes").select("id", { count: "exact", head: true }).eq("menu_id", menuId)
  return count || 0
}

/**
 * Drops every vote on a menu along with the lunch register rows they created.
 *
 * Rebuilding a menu's categories cascade-deletes their selections, which would
 * otherwise leave vote rows claiming a meal with nothing chosen — and leave
 * payroll charging for it. Clearing both together keeps the two in step.
 */
async function clearVotes(client: SupabaseClient, menuId: string, date: string) {
  const { data: voteRows } = await client.from("lunch_votes").select("user_id").eq("menu_id", menuId)
  const userIds = (voteRows || []).map((row) => row.user_id as string)

  const { error } = await client.from("lunch_votes").delete().eq("menu_id", menuId)
  if (error) throw new Error(`Failed to clear votes: ${error.message}`)

  if (userIds.length > 0) {
    const { error: logError } = await client
      .from("attendance_lunch_log")
      .delete()
      .eq("date", date)
      .in("user_id", userIds)
    if (logError) log.error({ err: logError.message, date }, "lunch register cleanup failed")
  }

  return userIds.length
}

/**
 * Removes every lunch charge for a day without touching the votes that created
 * them — what archiving needs, and the opposite of clearVotes.
 */
async function clearCharges(client: SupabaseClient, date: string) {
  const { error } = await client.from("attendance_lunch_log").delete().eq("date", date)
  if (error) log.error({ err: error.message, date }, "lunch charge cleanup failed")
}

/**
 * Rebuilds the day's charges from the votes still on record. Used when a
 * cancelled day is restored — the votes never went away, so the deduction can
 * be reinstated exactly as it was.
 */
async function restoreCharges(client: SupabaseClient, menuId: string, date: string, actorId: string) {
  const { data: voteRows } = await client
    .from("lunch_votes")
    .select("user_id")
    .eq("menu_id", menuId)
    .eq("is_eating", true)

  const userIds = (voteRows || []).map((row) => row.user_id as string)
  if (userIds.length === 0) return 0

  const settings = await loadLunchSettings(client)
  const { cost, companySubsidy, employeeDeduction } = lunchCostBreakdown(settings)

  const { error } = await client.from("attendance_lunch_log").upsert(
    userIds.map((userId) => ({
      user_id: userId,
      date,
      cost,
      company_subsidy: companySubsidy,
      employee_deduction: employeeDeduction,
      created_by: actorId,
    })),
    { onConflict: "user_id,date" }
  )
  if (error) log.error({ err: error.message, date }, "lunch charge restore failed")

  return userIds.length
}

/**
 * Edits a menu: publish, close, reopen, archive, or replace its structure.
 *
 * The voting cut-off normally comes from lunch_settings; passing
 * deadline_time overrides it for this one day, and null clears the override.
 * The structure may only be replaced while no votes exist, since rebuilding
 * groups would orphan every selection already cast.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { menuId } = await params
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = (await request.json()) as {
      status?: LunchMenuStatus
      deadline_time?: string | null
      groups?: MenuGroupInput[]
      /** Required to rebuild the dishes once votes exist — it discards them. */
      clear_votes?: boolean
      /** Cancels or reinstates the day, taking the lunch charges with it. */
      archived?: boolean
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data: menu } = await dataClient.from("lunch_menus").select(MENU_COLUMNS).eq("id", menuId).maybeSingle()
    if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    // null clears the override, sending the menu back to the settings time;
    // omitting the field entirely leaves whatever the menu already had.
    if (body.deadline_time !== undefined) {
      if (body.deadline_time === null) {
        updates.voting_deadline = null
      } else if (!isValidDeadlineTime(body.deadline_time)) {
        return NextResponse.json({ error: "deadline_time must be HH:MM" }, { status: 400 })
      } else {
        updates.voting_deadline = deadlineForDate(menu.date, body.deadline_time).toISOString()
      }
    }

    // Cancelling a day drops its charges but keeps the votes on record;
    // reinstating rebuilds the charges from those same votes.
    if (body.archived !== undefined) {
      if (body.archived) {
        updates.archived_at = new Date().toISOString()
        updates.archived_by = scope.userId
        await clearCharges(dataClient, menu.date)
      } else {
        // Only one live menu per date, so a replacement built in the meantime
        // blocks the restore — say so rather than letting the unique index
        // throw something unreadable.
        const { data: live } = await dataClient
          .from("lunch_menus")
          .select("id")
          .eq("date", menu.date)
          .is("archived_at", null)
          .maybeSingle()

        if (live && live.id !== menuId) {
          return NextResponse.json(
            {
              error:
                "Another menu is already up for that day. Cancel that one first if you want this one back instead.",
            },
            { status: 409 }
          )
        }

        updates.archived_at = null
        updates.archived_by = null
        await restoreCharges(dataClient, menuId, menu.date, scope.userId)
      }
    }

    let publishing = false
    if (body.status !== undefined) {
      if (!["draft", "published", "closed"].includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 })
      }
      updates.status = body.status
      if (body.status === "published") {
        publishing = menu.status !== "published"
        if (!menu.published_at) updates.published_at = new Date().toISOString()
        updates.closed_at = null
      }
      if (body.status === "closed") updates.closed_at = new Date().toISOString()
    }

    if (body.groups !== undefined) {
      const groups = normalizeMenuGroups(body.groups)
      if ("error" in groups) return NextResponse.json({ error: groups.error }, { status: 400 })

      const voteCount = await countVotes(dataClient, menuId)
      if (voteCount > 0 && !body.clear_votes) {
        return NextResponse.json(
          {
            error: `${voteCount} ${voteCount === 1 ? "person has" : "people have"} already voted. Changing the dishes clears those votes.`,
            requiresClearVotes: true,
            voteCount,
          },
          { status: 409 }
        )
      }
      if (voteCount > 0) await clearVotes(dataClient, menuId, menu.date)
      await writeMenuGroups(dataClient, menuId, groups.value)
    }

    const { data: updated, error: updateError } = await dataClient
      .from("lunch_menus")
      .update(updates)
      .eq("id", menuId)
      .select(MENU_COLUMNS)
      .single()

    if (updateError || !updated) throw new Error(`Failed to update menu: ${updateError?.message}`)

    if (publishing) {
      await notifyStaffOfMenu(dataClient, menuId, updated.date, scope.userId)
    }

    return NextResponse.json({ success: true, menu: await hydrateMenu(dataClient, updated) })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/admin/hr/lunch/menus/[menuId]")
    return NextResponse.json({ error: "Failed to update menu" }, { status: 500 })
  }
}

/**
 * Deletes a menu. When votes exist the caller must pass clear_votes, which
 * also removes the lunch register rows those votes created so nobody is
 * charged for a meal whose menu no longer exists.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { menuId } = await params
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data: menu } = await dataClient.from("lunch_menus").select("id, date").eq("id", menuId).maybeSingle()
    if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 })

    // Always clean up votes and lunch charges on permanent delete
    await clearVotes(dataClient, menuId, menu.date)

    // Also clean up reviews on permanent delete
    await dataClient.from("lunch_reviews").delete().eq("menu_id", menuId)

    const { error } = await dataClient.from("lunch_menus").delete().eq("id", menuId)
    if (error) throw new Error(`Failed to delete menu: ${error.message}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/admin/hr/lunch/menus/[menuId]")
    return NextResponse.json({ error: "Failed to delete menu" }, { status: 500 })
  }
}
