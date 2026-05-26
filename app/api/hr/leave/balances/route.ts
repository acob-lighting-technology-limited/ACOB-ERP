import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"

const log = logger("hr-leave-balances")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const userId = searchParams.get("user_id") || user.id

    if (userId !== user.id) {
      const scope = await getRequestScope()
      if (!scope?.isAdminLike) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { data: balances, error } = await supabase
      .from("leave_balances")
      .select(
        `
        *,
        leave_type:leave_types!leave_balances_leave_type_id_fkey (
          id,
          name,
          description,
          max_days,
          requires_approval
        )
      `
      )
      .eq("user_id", userId)
      .order("leave_type_id")

    if (error) {
      log.error({ err: String(error) }, "Error fetching leave balances:")
      return NextResponse.json({ error: "Failed to fetch leave balances" }, { status: 500 })
    }

    return NextResponse.json({ data: balances })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/balances:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
