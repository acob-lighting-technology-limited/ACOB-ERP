import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

const log = logger("admin-hr-attendance-leave-manual")
export const dynamic = "force-dynamic"

const ManualLeaveSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leave_type: z.string().min(1).max(50),
  comment: z.string().trim().min(3, "A comment of at least 3 characters is required").max(500),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-manual:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const parsed = ManualLeaveSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { user_ids, start_date, end_date, leave_type, comment } = parsed.data

    if (end_date < start_date) {
      return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Validate all user_ids are within caller's scope
    const depts = getScopedDepartments(scope)
    let allowedIds: string[] = user_ids
    if (depts !== null) {
      const { data: scopedProfiles } = await dataClient
        .from("profiles")
        .select("id")
        .in("id", user_ids)
        .in("department", depts)
      allowedIds = (scopedProfiles ?? []).map((p) => p.id)
      if (allowedIds.length === 0) {
        return NextResponse.json({ error: "None of the selected employees are within your scope" }, { status: 403 })
      }
    }

    // Insert one leave_request per employee (status: approved, bypassing normal workflow)
    const toInsert = allowedIds.map((userId) => ({
      user_id: userId,
      leave_type,
      start_date,
      end_date,
      status: "approved",
      notes: comment,
      approved_by: scope.userId,
      admin_manual: true,
    }))

    const { error } = await dataClient.from("leave_requests").insert(toInsert)

    if (error) {
      log.error({ err: JSON.stringify(error) }, "Manual leave insert failed")
      // Check if the column admin_manual doesn't exist yet — fall back without it
      if (error.code === "42703") {
        // column does not exist — retry without admin_manual
        const fallback = allowedIds.map((userId) => ({
          user_id: userId,
          leave_type,
          start_date,
          end_date,
          status: "approved",
          notes: comment,
          approved_by: scope.userId,
        }))
        const { error: fallbackError } = await dataClient.from("leave_requests").insert(fallback)
        if (fallbackError) {
          log.error({ err: JSON.stringify(fallbackError) }, "Manual leave fallback insert failed")
          return NextResponse.json({ error: "Failed to add leave records" }, { status: 500 })
        }
      } else {
        return NextResponse.json({ error: "Failed to add leave records" }, { status: 500 })
      }
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "leave_request_manual",
        entityId: `manual-leave-${start_date}-${end_date}`,
        newValues: { user_ids: allowedIds, start_date, end_date, leave_type, comment },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/leave/manual" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      message: `Leave added for ${allowedIds.length} employee(s)`,
      created: allowedIds.length,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/leave/manual")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
