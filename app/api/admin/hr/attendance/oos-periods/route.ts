import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { materializeOos, oosWorkdays } from "@/lib/hr/oos-materialize"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("admin-hr-attendance-oos-periods")
export const dynamic = "force-dynamic"

/**
 * Indefinite ("until stopped") Out-of-Station directives.
 *
 * Bounded OOS ranges are materialized immediately by /records/bulk. This endpoint
 * handles the open-ended case: it records the directive (attendance_oos_periods with a
 * NULL end_date), materializes OOS from the start date through today, and lets the
 * attendance cron extend it forward day by day. Stopping it closes end_date at today
 * so past OOS days are preserved and no new ones are created.
 */

const CreateSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(200),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reason: z.string().trim().min(3, "A comment of at least 3 characters is required").max(500),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-oos-periods:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope } = scopeResult
    const dataClient = getServiceRoleClientOrFallback(scopeResult.supabase)

    const parsed = CreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const today = toLocalISODate()
    const start = parsed.data.start_date && parsed.data.start_date < today ? parsed.data.start_date : today
    const reason = parsed.data.reason.trim()

    let allowedIds: string[] = parsed.data.user_ids
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      if (depts.length === 0) {
        return NextResponse.json({ error: "None of the selected employees are within your scope" }, { status: 403 })
      }
      const { data: scoped } = await dataClient
        .from("profiles")
        .select("id")
        .in("id", parsed.data.user_ids)
        .in("department", depts)
      allowedIds = (scoped ?? []).map((p) => p.id)
    }
    if (allowedIds.length === 0) {
      return NextResponse.json({ error: "None of the selected employees are within your scope" }, { status: 403 })
    }

    // Record the open directive (skip employees who already have an active open one).
    const { data: existingOpen } = await dataClient
      .from("attendance_oos_periods")
      .select("user_id")
      .in("user_id", allowedIds)
      .is("end_date", null)
      .eq("status", "active")
    const alreadyOpen = new Set((existingOpen ?? []).map((r) => r.user_id))
    const toOpen = allowedIds.filter((id) => !alreadyOpen.has(id))

    if (toOpen.length > 0) {
      const rows = toOpen.map((user_id) => ({
        user_id,
        start_date: start,
        end_date: null,
        kind: "infinite",
        reason,
        status: "active",
        created_by: scope.userId,
      }))
      const { error } = await dataClient.from("attendance_oos_periods").insert(rows)
      if (error) {
        log.error({ err: JSON.stringify(error) }, "Failed to create OOS periods")
        return NextResponse.json({ error: "Failed to create indefinite OOS" }, { status: 500 })
      }
    }

    // Materialize OOS from start through today so the roster reflects it right away.
    const dates = oosWorkdays(start, today)
    const result = await materializeOos(dataClient, allowedIds, dates, reason, scope.userId)

    await writeAuditLog(
      scopeResult.supabase,
      {
        action: "create",
        entityType: "attendance_oos_period",
        entityId: `oos-indefinite-${start}`,
        newValues: { user_ids: allowedIds, start_date: start, reason },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/oos-periods" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      message: `Indefinite OOS applied to ${allowedIds.length} employee(s)`,
      opened: toOpen.length,
      ...result,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/oos-periods")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope } = scopeResult
  const dataClient = getServiceRoleClientOrFallback(scopeResult.supabase)

  // Active, open-ended directives only (bounded OOS shows via the materialized list).
  let query = dataClient
    .from("attendance_oos_periods")
    .select("id, user_id, start_date, reason")
    .is("end_date", null)
    .eq("status", "active")
    .order("start_date", { ascending: false })

  const depts = getScopedDepartments(scope)
  if (depts !== null) {
    if (depts.length === 0) return NextResponse.json({ data: [] })
    const { data: scoped } = await dataClient.from("profiles").select("id").in("department", depts)
    const ids = (scoped ?? []).map((p) => p.id)
    if (ids.length === 0) return NextResponse.json({ data: [] })
    query = query.in("user_id", ids)
  }

  const { data: periods } = await query
  const userIds = [...new Set((periods ?? []).map((p) => p.user_id))]
  const nameMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await dataClient
      .from("profiles")
      .select("id, full_name, first_name, last_name")
      .in("id", userIds)
    for (const p of profiles ?? []) {
      nameMap.set(p.id, p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown")
    }
  }

  return NextResponse.json({
    data: (periods ?? []).map((p) => ({
      id: p.id,
      user_id: p.user_id,
      user_name: nameMap.get(p.user_id) ?? "Unknown",
      start_date: p.start_date,
      reason: p.reason ?? null,
    })),
  })
}

/**
 * Stop an indefinite OOS: close end_date at today and mark stopped. Materialized OOS days
 * up to today are preserved; the cron stops extending it. Use ?remove=1 to also delete
 * the directive row entirely (materialized records stay — remove them from the OOS list).
 */
export async function DELETE(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope } = scopeResult
  const dataClient = getServiceRoleClientOrFallback(scopeResult.supabase)

  const id = String(request.nextUrl.searchParams.get("id") || "")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const { data: period } = await dataClient
    .from("attendance_oos_periods")
    .select("id, user_id, start_date")
    .eq("id", id)
    .maybeSingle()
  if (!period) return NextResponse.json({ error: "OOS directive not found" }, { status: 404 })

  const depts = getScopedDepartments(scope)
  if (depts !== null) {
    const { data: target } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", period.user_id)
      .maybeSingle()
    if (!target || !depts.includes(target.department || "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const today = toLocalISODate()
  const { error } = await dataClient
    .from("attendance_oos_periods")
    .update({ end_date: today, status: "stopped" })
    .eq("id", id)
  if (error) {
    log.error({ err: JSON.stringify(error) }, "Failed to stop OOS period")
    return NextResponse.json({ error: "Failed to stop OOS" }, { status: 500 })
  }

  await writeAuditLog(
    scopeResult.supabase,
    {
      action: "update",
      entityType: "attendance_oos_period",
      entityId: id,
      newValues: { status: "stopped", end_date: today },
      oldValues: { user_id: period.user_id, start_date: period.start_date },
      context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/oos-periods" },
    },
    { failOpen: true }
  )

  return NextResponse.json({ message: "Indefinite OOS stopped — days up to today are kept" })
}
