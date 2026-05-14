import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"

const log = logger("admin-hr-attendance-records")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-records:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    const role = String(profile?.role || "")
    if (!["developer", "admin", "super_admin"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    const userId = searchParams.get("user_id")

    let query = supabase
      .from("attendance_records")
      .select(
        `id, user_id, date, clock_in, clock_out, total_hours, status, source, waived, waiver_reason,
         profile:profiles!attendance_records_user_id_fkey (first_name, last_name, full_name, department)`
      )
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500)

    if (startDate) query = query.gte("date", startDate)
    if (endDate) query = query.lte("date", endDate)
    if (userId) query = query.eq("user_id", userId)

    const { data, error } = await query

    if (error) {
      log.error({ err: String(error) }, "Failed to fetch admin attendance records")
      return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 })
    }

    const records = (data ?? []).map((r) => {
      const p = r.profile as { first_name?: string; last_name?: string; full_name?: string; department?: string } | null
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: name,
        department: p?.department ?? "",
        date: r.date,
        clock_in: r.clock_in,
        clock_out: r.clock_out,
        total_hours: r.total_hours,
        status: r.status,
        source: r.source,
        waived: r.waived,
        waiver_reason: r.waiver_reason,
      }
    })

    return NextResponse.json({ records })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/records")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
