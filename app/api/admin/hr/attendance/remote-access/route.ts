import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("admin-remote-access")
export const dynamic = "force-dynamic"

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-remote-access:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = String(profile?.role || "")
  if (!["developer", "admin", "super_admin"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { supabase }
}

/**
 * GET /api/admin/hr/attendance/remote-access
 * Returns all employees with their remote check-in eligibility, face photo status,
 * and last remote check-in date.
 */
export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { searchParams } = request.nextUrl
  const dept = searchParams.get("department") || ""

  let profileQuery = dataClient
    .from("profiles")
    .select("id, first_name, last_name, employee_number, department, remote_checkin_enabled, face_reference_url")
    .eq("employment_status", "active")
    .order("first_name", { ascending: true })

  if (dept && dept !== "all") {
    profileQuery = profileQuery.eq("department", dept)
  }

  const { data: profiles, error: profileError } = await profileQuery
  if (profileError) {
    log.error({ err: String(profileError) }, "Failed to fetch profiles for remote access")
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ data: [], departments: [] })
  }

  // Fetch last remote clock-in per employee
  const userIds = profiles.map((p) => p.id)
  const { data: lastCheckins } = await dataClient
    .from("attendance_records")
    .select("user_id, date")
    .in("user_id", userIds)
    .eq("source", "remote_web")
    .order("date", { ascending: false })

  const lastCheckinMap = new Map<string, string>()
  for (const row of lastCheckins ?? []) {
    if (!lastCheckinMap.has(row.user_id)) {
      lastCheckinMap.set(row.user_id, row.date)
    }
  }

  const data = profiles.map((p) => ({
    user_id: p.id,
    employee_number: String(p.employee_number || "").trim(),
    user_name: `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim(),
    department: String(p.department || ""),
    remote_checkin_enabled: Boolean(p.remote_checkin_enabled),
    face_photo_set: Boolean(p.face_reference_url),
    last_remote_checkin: lastCheckinMap.get(p.id) ?? null,
  }))

  const departments = Array.from(new Set(profiles.map((p) => String(p.department || "").trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b)
  )

  return NextResponse.json({ data, departments })
}
