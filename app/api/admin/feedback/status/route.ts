import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"

export const dynamic = "force-dynamic"

const Schema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  oldStatus: z.string().optional().nullable(),
})

// Update a feedback record's status and write the audit entry server-side.
export async function PATCH(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult

  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { id, status, oldStatus } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  const { error } = await db.from("feedback").update({ status, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog(
    db,
    {
      action: "update",
      entityType: "feedback",
      entityId: id,
      oldValues: { status: oldStatus ?? null },
      newValues: { status },
      metadata: { event: "feedback_status_updated" },
      context: { actorId: scope.userId, source: "api", route: "/admin/feedback" },
    },
    { failOpen: true }
  )

  return NextResponse.json({ ok: true })
}
