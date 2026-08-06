import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

const log = logger("admin-hr-leave-employees")
export const dynamic = "force-dynamic"

type ProfileOptionRow = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
  department?: string | null
  employment_status?: string | null
}

/**
 * Employee picker options for the admin "Add Leave" dialog. Department-scoped:
 * global admins see everyone, department leads see only their own departments —
 * the same scope the manual-leave POST enforces server-side.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-employees:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const depts = getScopedDepartments(scope)
    if (depts !== null && depts.length === 0) return NextResponse.json({ data: [] })

    let query = dataClient
      .from("profiles")
      .select("id, full_name, first_name, last_name, company_email, department, employment_status")
      .order("first_name", { ascending: true })
    if (depts !== null) query = query.in("department", depts)

    const { data, error } = await query
    if (error) {
      log.error({ err: String(error) }, "Failed to fetch leave employee options")
      return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
    }

    const options = ((data ?? []) as ProfileOptionRow[])
      .filter((p) => isAssignableEmploymentStatus(p.employment_status, { allowLegacyNullStatus: false }))
      .map((p) => ({
        value: p.id,
        label:
          p.full_name?.trim() || `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.company_email || "Unnamed",
        department: p.department ?? null,
      }))
      .filter((o) => Boolean(o.value))

    return NextResponse.json({ data: options })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/leave/employees")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
