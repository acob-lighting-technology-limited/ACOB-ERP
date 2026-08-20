import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { toLocalISODate } from "@/lib/utils/date"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("api-hr-lunch-reviews")
export const dynamic = "force-dynamic"

const ReviewSchema = z.object({
  menuId: z.string().uuid("A menu is required"),
  rating: z.coerce.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
  comment: z.string().trim().max(2000, "Comment is too long").optional().nullable(),
})

/**
 * The caller's own review for a menu, so the form can show what they already
 * said. Reviews are anonymous to HR but not to their author.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const menuId = request.nextUrl.searchParams.get("menu_id")

    let query = supabase
      .from("lunch_reviews")
      .select("id, menu_id, rating, comment, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (menuId) query = query.eq("menu_id", menuId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "GET /api/hr/lunch/reviews failed")
    return NextResponse.json({ error: "Failed to load your lunch reviews" }, { status: 500 })
  }
}

/**
 * Leave (or revise) a review for a day's food. Only past menus can be
 * reviewed — there is nothing to say about food not yet served.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-lunch-reviews:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = ReviewSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { menuId, rating } = parsed.data
    const comment = parsed.data.comment?.trim() || null

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: menu } = await dataClient
      .from("lunch_menus")
      .select("id, date")
      .eq("id", menuId)
      .maybeSingle<{ id: string; date: string }>()

    if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 })

    if (menu.date > toLocalISODate()) {
      return NextResponse.json({ error: "You can only review food that has already been served" }, { status: 400 })
    }

    // Upsert on (menu_id, user_id) so revising a review replaces it rather than
    // stacking duplicates.
    const { data, error } = await dataClient
      .from("lunch_reviews")
      .upsert(
        { menu_id: menuId, user_id: user.id, rating, comment, updated_at: new Date().toISOString() },
        { onConflict: "menu_id,user_id" }
      )
      .select("id, menu_id, rating, comment, created_at, updated_at")
      .single()

    if (error) throw error

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "POST /api/hr/lunch/reviews failed")
    return NextResponse.json({ error: "Failed to save your review" }, { status: 500 })
  }
}

/**
 * Deletes the caller's own review for a menu.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const menuId = request.nextUrl.searchParams.get("menu_id")
    if (!menuId) return NextResponse.json({ error: "menu_id is required" }, { status: 400 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { error } = await dataClient.from("lunch_reviews").delete().eq("menu_id", menuId).eq("user_id", user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "DELETE /api/hr/lunch/reviews failed")
    return NextResponse.json({ error: "Failed to delete your review" }, { status: 500 })
  }
}
