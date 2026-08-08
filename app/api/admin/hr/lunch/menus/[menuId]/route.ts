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
import { deadlineForDate, isValidDeadlineTime, type LunchMenuStatus } from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-menu")
export const dynamic = "force-dynamic"

const MENU_COLUMNS = "id, date, status, voting_deadline, published_at, closed_at"

type RouteContext = { params: Promise<{ menuId: string }> }

async function countVotes(client: SupabaseClient, menuId: string) {
  const { count } = await client.from("lunch_votes").select("id", { count: "exact", head: true }).eq("menu_id", menuId)
  return count || 0
}

/**
 * Edits a menu: publish, close, reopen, or replace its structure.
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
      if ((await countVotes(dataClient, menuId)) > 0) {
        return NextResponse.json(
          { error: "Votes have already been cast — clear them before changing the options." },
          { status: 409 }
        )
      }
      const groups = normalizeMenuGroups(body.groups)
      if ("error" in groups) return NextResponse.json({ error: groups.error }, { status: 400 })
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

/** Deletes a menu. Refused once votes exist, so a poll can't vanish mid-day. */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { menuId } = await params
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    if ((await countVotes(dataClient, menuId)) > 0) {
      return NextResponse.json({ error: "This menu already has votes and cannot be deleted." }, { status: 409 })
    }

    const { error } = await dataClient.from("lunch_menus").delete().eq("id", menuId)
    if (error) throw new Error(`Failed to delete menu: ${error.message}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/admin/hr/lunch/menus/[menuId]")
    return NextResponse.json({ error: "Failed to delete menu" }, { status: 500 })
  }
}
