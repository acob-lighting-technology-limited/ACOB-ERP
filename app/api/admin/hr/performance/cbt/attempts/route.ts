import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("admin-hr-performance-cbt-attempts")
export const dynamic = "force-dynamic"

type AttemptJoinRow = {
  id: string
  created_at: string
  submitted_at: string | null
  status: string
  score: number | null
  company_email: string | null
  cbt_details: {
    last_name?: string
    company_email?: string
    dob_day?: number
    dob_month?: number
    dob_year?: number
  } | null
  review_cycle_id: string
  profiles: {
    id: string
    first_name: string | null
    last_name: string | null
    department: string | null
  } | null
  review_cycles: {
    id: string
    name: string
    review_type: string | null
    start_date: string | null
    end_date: string | null
  } | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) {
      return contextResult.response
    }

    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.pms.cbt.manage")
    if (!routeAccess.ok) {
      return routeAccess.response
    }

    const { data: attempts, error } = await supabase
      .from("cbt_attempts")
      .select(
        `
        id,
        created_at,
        submitted_at,
        status,
        score,
        company_email,
        cbt_details,
        review_cycle_id,
        profiles (
          id,
          first_name,
          last_name,
          department
        ),
        review_cycles (
          id,
          name,
          review_type,
          start_date,
          end_date
        )
      `
      )
      .order("created_at", { ascending: false })
      .returns<AttemptJoinRow[]>()

    if (error) {
      log.error({ err: String(error) }, "Error fetching CBT attempt logs")
      return NextResponse.json({ error: "Failed to fetch CBT attempt logs" }, { status: 500 })
    }

    return NextResponse.json({ data: attempts || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/performance/cbt/attempts")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
