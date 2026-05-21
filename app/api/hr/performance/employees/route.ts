import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"

const log = logger("hr-performance-employees")

type EmployeeRow = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
  department_id: string | null
}

/**
 * GET /api/hr/performance/employees
 *
 * Returns the list of employees the current admin/lead is authorized to see.
 * Respects the middleware-injected scope:
 *   - Global admin  → all employees
 *   - Lead / admin in lead mode → only employees in managed departments
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await getRequestScope()
    if (!scope) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const scopedDepts = getScopedDepartments(scope)

    let query = supabase
      .from("profiles")
      .select("id, first_name, last_name, department, department_id")
      .eq("employment_status", "active")
      .order("first_name", { ascending: true })

    if (scopedDepts !== null) {
      // Lead or admin in lead mode — restrict to scoped departments
      if (scopedDepts.length === 0) {
        return NextResponse.json({ data: [] })
      }
      query = query.in("department", scopedDepts)
    }

    const { data, error } = await query.returns<EmployeeRow[]>()
    if (error) {
      log.error({ err: String(error) }, "Failed to fetch employees")
      return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/employees")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
