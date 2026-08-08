import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-reviews")
export const dynamic = "force-dynamic"

/**
 * Columns returned to HR. user_id is deliberately absent — staff are told their
 * feedback is anonymous, and this endpoint is the only way it reaches an admin
 * screen. Do not add it, and do not join profiles here.
 */
const ANONYMOUS_REVIEW_COLUMNS = "id, menu_id, rating, comment, created_at"

type ReviewRow = {
  id: string
  menu_id: string
  rating: number
  comment: string | null
  created_at: string
}

type MenuRow = { id: string; date: string }

/**
 * Anonymous lunch feedback for HR, grouped by the day it refers to.
 *
 * Returns each menu's average rating, rating count and the comments left on it,
 * with no author attached.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const from = request.nextUrl.searchParams.get("from")
    const to = request.nextUrl.searchParams.get("to")

    let menuQuery = dataClient.from("lunch_menus").select("id, date").order("date", { ascending: false })
    if (from) menuQuery = menuQuery.gte("date", from)
    if (to) menuQuery = menuQuery.lte("date", to)

    const { data: menus, error: menuError } = await menuQuery.returns<MenuRow[]>()
    if (menuError) throw menuError

    const menuIds = (menus || []).map((menu) => menu.id)
    if (menuIds.length === 0) return NextResponse.json({ data: [] })

    const { data: reviews, error: reviewError } = await dataClient
      .from("lunch_reviews")
      .select(ANONYMOUS_REVIEW_COLUMNS)
      .in("menu_id", menuIds)
      .order("created_at", { ascending: false })
      .returns<ReviewRow[]>()

    if (reviewError) throw reviewError

    const byMenu = new Map<string, ReviewRow[]>()
    for (const review of reviews || []) {
      byMenu.set(review.menu_id, [...(byMenu.get(review.menu_id) || []), review])
    }

    const data = (menus || [])
      .map((menu) => {
        const rows = byMenu.get(menu.id) || []
        const total = rows.reduce((sum, row) => sum + row.rating, 0)
        return {
          menu_id: menu.id,
          date: menu.date,
          review_count: rows.length,
          average_rating: rows.length > 0 ? Number((total / rows.length).toFixed(2)) : null,
          comments: rows
            .filter((row) => Boolean(row.comment))
            .map((row) => ({ id: row.id, rating: row.rating, comment: row.comment, created_at: row.created_at })),
        }
      })
      .filter((entry) => entry.review_count > 0)

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "GET /api/admin/hr/lunch/reviews failed")
    return NextResponse.json({ error: "Failed to load lunch reviews" }, { status: 500 })
  }
}
