import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAuthContext } from "@/lib/correspondence/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-department-codes")

const UpdateDepartmentCodeSchema = z.object({
  department_name: z.string().trim().min(1, "department_name and department_code are required"),
  department_code: z.string().trim().min(1, "department_name and department_code are required"),
  is_active: z.boolean().optional().default(true),
})

export async function GET() {
  try {
    const { supabase, user } = await getAuthContext()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data, error } = await supabase
      .from("correspondence_department_codes")
      .select("*")
      .order("department_name", { ascending: true })

    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/department-codes:")
    return NextResponse.json({ error: "Failed to fetch department codes" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`correspondence-department-codes:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const codesScope = await getRequestScope()
    if (!codesScope?.isAdminLike || codesScope.scopeMode === "lead") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateDepartmentCodeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const departmentName = parsed.data.department_name
    const departmentCode = parsed.data.department_code.trim().toUpperCase()
    const isActive = parsed.data.is_active

    const { data, error } = await supabase
      .from("correspondence_department_codes")
      .upsert(
        {
          department_name: departmentName,
          department_code: departmentCode,
          is_active: isActive,
        },
        { onConflict: "department_name" }
      )
      .select("*")
      .single()

    if (error) throw error

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "correspondence_department_code",
        entityId: data.id,
        newValues: { department_name: departmentName, department_code: departmentCode, is_active: isActive },
        context: { actorId: user.id, source: "api", route: "/api/correspondence/department-codes" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/correspondence/department-codes:")
    return NextResponse.json({ error: "Failed to update department code" }, { status: 500 })
  }
}
