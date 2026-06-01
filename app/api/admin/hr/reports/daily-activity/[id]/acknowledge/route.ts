import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

const log = logger("admin-hr-daily-activity-ack")
export const dynamic = "force-dynamic"

const Schema = z.object({ acknowledged: z.boolean().optional() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(`admin-daily-activity-ack:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const { id } = await params
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const parsed = Schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    const acknowledged = parsed.data.acknowledged ?? true

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: report } = await dataClient
      .from("daily_reports")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle()
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 })

    // Verify the report owner is within this admin/lead's scope
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      const { data: owner } = await dataClient
        .from("profiles")
        .select("department")
        .eq("id", report.user_id)
        .maybeSingle()
      if (!owner || !depts.includes(owner.department || "")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const patch = acknowledged
      ? { acknowledged_by: scope.userId, acknowledged_at: new Date().toISOString() }
      : { acknowledged_by: null, acknowledged_at: null }

    const { data: updated, error } = await dataClient
      .from("daily_reports")
      .update(patch)
      .eq("id", id)
      .select("id, acknowledged_at")
      .single()
    if (error) {
      log.error("Failed to update acknowledgement", error)
      return NextResponse.json({ error: "Failed to update report" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: acknowledged ? "acknowledge" : "update",
        entityType: "daily_report",
        entityId: id,
        newValues: patch,
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/reports/daily-activity/[id]/acknowledge" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updated, message: acknowledged ? "Report acknowledged" : "Acknowledgement removed" })
  } catch (error) {
    log.error("Error in PATCH acknowledge", error)
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
