import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"

export const dynamic = "force-dynamic"

const AuditSchema = z.object({
  action: z.string().min(1),
  entityId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// Fail-open audit log for the weekly-summary mail send flow. Actor is always
// the resolved caller — never client-supplied.
export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = AuditSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { action, entityId, metadata } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  await writeAuditLog(
    db,
    {
      action: "send",
      entityType: "mail_summary",
      entityId,
      metadata: { ...(metadata || {}), event: action },
      context: {
        actorId: scope.userId,
        department: scope.department || "Admin and HR",
        source: "api",
        route: "/admin/reports/weekly-summary",
      },
    },
    { failOpen: true }
  )

  return NextResponse.json({ ok: true })
}
