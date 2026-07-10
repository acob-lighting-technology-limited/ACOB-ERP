import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const ScheduleSchema = z
  .object({
    schedule_type: z.enum(["one_time", "recurring"]),
    reminder_type: z.string().min(1),
    recipients: z.array(z.string()),
    is_active: z.boolean(),
    send_day: z.string().nullable(),
    send_time: z.string(),
    meeting_config: z.record(z.string(), z.unknown()),
    next_run_at: z.string(),
  })
  .passthrough()

// List active schedules for the composer ("meetings" and "communications" modes
// each request their own reminder_type subset).
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const mode = request.nextUrl.searchParams.get("mode") === "communications" ? "communications" : "meetings"
  const allowedTypes = mode === "communications" ? ["admin_broadcast"] : ["meeting", "knowledge_sharing"]

  const db = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await db
    .from("reminder_schedules")
    .select("*")
    .eq("is_active", true)
    .in("reminder_type", allowedTypes)
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = ScheduleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { error } = await db.from("reminder_schedules").insert(parsed.data)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
