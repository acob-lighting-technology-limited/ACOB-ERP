import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

const log = logger("api-hr-lunch-view")
export const dynamic = "force-dynamic"

/**
 * Records an authenticated employee's view of a published lunch menu.
 * Only views up to 23:59:59 WAT on the menu's scheduled date are tracked.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { menuId?: string }
    const menuId = body.menuId
    if (!menuId) {
      return NextResponse.json({ error: "menuId is required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Load menu to verify existence and date window
    const { data: menu, error: menuErr } = await dataClient
      .from("lunch_menus")
      .select("id, date, status, published_at")
      .eq("id", menuId)
      .maybeSingle()

    if (menuErr || !menu) {
      return NextResponse.json({ error: "Menu not found" }, { status: 404 })
    }

    if (menu.status === "draft") {
      return NextResponse.json({ success: false, message: "Draft menus are not tracked" })
    }

    // Tracking window: from publication until 23:59:59 WAT on the menu's scheduled day
    const endOfDayWAT = new Date(`${menu.date}T23:59:59+01:00`).getTime()
    const now = Date.now()

    if (now > endOfDayWAT) {
      // Past the end of that day's window
      return NextResponse.json({ success: true, tracked: false, reason: "past_window" })
    }

    // Atomic insert-or-increment; the RPC derives the user from auth.uid().
    const { error: viewErr } = await supabase.rpc("record_lunch_menu_view", { p_menu_id: menu.id })

    if (viewErr) {
      // Surfaced rather than swallowed: a silent failure here is invisible
      // everywhere except an admin wondering why the view count never moves.
      log.error({ err: viewErr.message, menuId: menu.id }, "failed to record lunch menu view")
      return NextResponse.json({ error: "Failed to record menu view" }, { status: 500 })
    }

    return NextResponse.json({ success: true, tracked: true })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/lunch/view")
    return NextResponse.json({ error: "Failed to record menu view" }, { status: 500 })
  }
}
