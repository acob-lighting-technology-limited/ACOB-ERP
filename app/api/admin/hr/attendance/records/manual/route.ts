import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"

const log = logger("admin-hr-attendance-records-manual")
export const dynamic = "force-dynamic"

const ALLOWED_STATUSES = new Set(["out_of_station", "waiver"])

/**
 * Lists manually-created day records of a given status (OOS / Waiver) within the
 * caller's department scope. The Attendance Manager groups the flat rows into
 * contiguous date ranges per employee for display and bulk delete.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-records-manual:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const status = String(request.nextUrl.searchParams.get("status") || "")
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    const departmentParam = (request.nextUrl.searchParams.get("department") || "").trim()

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Resolve the set of user IDs visible to this admin/lead (mirrors records GET)
    let scopedUserIds: string[] | null = null
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ data: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ data: [] })
    }

    if (departmentParam && departmentParam.toLowerCase() !== "all") {
      const deptVariants = expandDepartmentScopeForQuery([departmentParam])
      const { data: deptProfiles } = await dataClient.from("profiles").select("id").in("department", deptVariants)
      const deptUserIds = (deptProfiles ?? []).map((p) => p.id)
      if (deptUserIds.length === 0) return NextResponse.json({ data: [] })
      scopedUserIds = scopedUserIds === null ? deptUserIds : scopedUserIds.filter((id) => deptUserIds.includes(id))
      if (scopedUserIds.length === 0) return NextResponse.json({ data: [] })
    }

    let query = dataClient
      .from("attendance_records")
      .select("id, user_id, date, status, manual_comment")
      .eq("status", status)
      .eq("source", "manual")
      .order("date", { ascending: false })
      .limit(2000)
    if (scopedUserIds !== null) query = query.in("user_id", scopedUserIds)

    const { data, error } = await query
    if (error) {
      log.error({ err: String(error) }, "Failed to fetch manual records")
      return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 })
    }

    const rows = data ?? []
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
    const profileMap = new Map<
      string,
      { full_name?: string; first_name?: string; last_name?: string; department?: string }
    >()
    if (userIds.length > 0) {
      const { data: profiles } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name, department")
        .in("id", userIds)
      for (const p of profiles ?? []) profileMap.set(p.id, p)
    }

    const result = rows.map((r) => {
      const p = profileMap.get(r.user_id)
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: name,
        department: p?.department ?? "",
        date: r.date,
        status: r.status,
        manual_comment: r.manual_comment ?? null,
      }
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/records/manual")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
