import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/correspondence/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"

const log = logger("correspondence-requesters")

interface RequesterProfileRow {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  department?: string | null
  lead_departments?: string[] | null
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getAuthContext()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const departmentName = request.nextUrl.searchParams.get("department_name")?.trim()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data, error } = await dataClient
      .from("profiles")
      .select("id, full_name, first_name, last_name, department, lead_departments")
      .eq("employment_status", "active")
      .order("full_name", { ascending: true })
      .returns<RequesterProfileRow[]>()

    if (error) throw error

    const allowedDepartments = departmentName
      ? new Set(getDepartmentAliases(departmentName).map((department) => normalizeDepartmentName(department)))
      : null

    const profiles = (data || [])
      .filter((profile) => {
        if (!allowedDepartments) return true
        const department = profile.department ? normalizeDepartmentName(profile.department) : ""
        const leadDepartments = (profile.lead_departments || []).map((item) => normalizeDepartmentName(item))
        return allowedDepartments.has(department) || leadDepartments.some((item) => allowedDepartments.has(item))
      })
      .map((p) => ({
        id: p.id,
        full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Unknown",
      }))

    return NextResponse.json({ data: profiles })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/requesters:")
    return NextResponse.json({ error: "Failed to fetch requesters" }, { status: 500 })
  }
}
