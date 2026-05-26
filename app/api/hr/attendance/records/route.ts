import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

const log = logger("hr-attendance-records")
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
    const userId = user.id
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    let query = supabase
      .from("attendance_records")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })

    if (startDate) {
      query = query.gte("date", startDate)
    }

    if (endDate) {
      query = query.lte("date", endDate)
    }

    const { data: records, error } = await query

    if (error) {
      log.error({ err: String(error) }, "Error fetching attendance records:")
      return NextResponse.json({ error: "Failed to fetch attendance records" }, { status: 500 })
    }

    return NextResponse.json({ data: records })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/attendance/records:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
