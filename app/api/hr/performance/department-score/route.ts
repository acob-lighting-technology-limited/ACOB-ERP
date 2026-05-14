import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { computeDepartmentPerformanceScore } from "@/lib/performance/scoring"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("hr-performance-department-score")

const DepartmentScoreQuerySchema = z.object({
  department: z.string().trim().min(1, "department is required"),
  cycle_id: z.string().trim().optional().nullable(),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<{
        role?: string | null
        department?: string | null
        is_department_lead?: boolean | null
        lead_departments?: string[] | null
      }>()

    const parsed = DepartmentScoreQuerySchema.safeParse({
      department: new URL(request.url).searchParams.get("department"),
      cycle_id: new URL(request.url).searchParams.get("cycle_id"),
    })

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 })
    }

    const department = parsed.data.department
    const deptScope = await getRequestScope()
    const isGlobalAdmin = deptScope?.isAdminLike === true && deptScope.scopeMode !== "lead"
    const managedDepartments = Array.isArray(profile?.lead_departments) ? profile.lead_departments : []
    const canAccessDepartment =
      isGlobalAdmin ||
      profile?.department === department ||
      (profile?.is_department_lead === true &&
        (managedDepartments.includes(department) || profile.department === department))

    if (!canAccessDepartment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const score = await computeDepartmentPerformanceScore(supabase, {
      department,
      cycleId: parsed.data.cycle_id || null,
    })

    return NextResponse.json({ data: score })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET /api/hr/performance/department-score")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
