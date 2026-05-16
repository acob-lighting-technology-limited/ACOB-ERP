import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

const ExemptionSchema = z.object({
  user_id: z.string().uuid(),
  mode: z.enum(["off", "weekly", "monthly", "infinite"]),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  weeks: z.array(z.number().int().min(1).max(6)).optional(),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
  reason: z.string().max(240).optional().nullable(),
})

function monthRange(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return { start, end }
}

function formatDateUTC(date: Date) {
  return date.toISOString().slice(0, 10)
}

function weekRangeInMonth(yearMonth: string, weekIndex: number) {
  const { start, end } = monthRange(yearMonth)
  const rangeStart = new Date(start)
  rangeStart.setUTCDate(start.getUTCDate() + (weekIndex - 1) * 7)
  const rangeEnd = new Date(rangeStart)
  rangeEnd.setUTCDate(rangeStart.getUTCDate() + 6)
  if (rangeStart > end) return null
  if (rangeEnd > end) rangeEnd.setTime(end.getTime())
  return { start: formatDateUTC(rangeStart), end: formatDateUTC(rangeEnd) }
}

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-exemptions:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return { error: scopeResult.response }
  return { supabase: scopeResult.supabase, user: { id: scopeResult.scope.userId }, scope: scopeResult.scope }
}

export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const userId = String(request.nextUrl.searchParams.get("user_id") || "")
  if (!userId) return NextResponse.json({ error: "user_id is required" }, { status: 400 })

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  // Validate target user is within this admin/lead's scope
  const depts = getScopedDepartments(auth.scope)
  if (depts !== null) {
    const { data: targetProfile } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", userId)
      .maybeSingle()
    if (!targetProfile || !depts.includes(targetProfile.department || "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }
  const { data: profile } = await dataClient
    .from("profiles")
    .select("attendance_exempt, attendance_exempt_reason")
    .eq("id", userId)
    .maybeSingle()
  const { data: periods } = await dataClient
    .from("attendance_exempt_periods")
    .select("id, start_date, end_date, kind, reason")
    .eq("user_id", userId)
    .order("start_date", { ascending: true })

  return NextResponse.json({
    data: {
      attendance_exempt: Boolean(profile?.attendance_exempt),
      reason: profile?.attendance_exempt_reason || null,
      periods: periods || [],
    },
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = ExemptionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const { user_id, mode, reason } = parsed.data
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  // Validate target user is within this admin/lead's scope
  const depts = getScopedDepartments(auth.scope)
  if (depts !== null) {
    const { data: targetProfile } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", user_id)
      .maybeSingle()
    if (!targetProfile || !depts.includes(targetProfile.department || "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }
  const attendance_exempt = mode === "infinite"

  const { error } = await dataClient
    .from("profiles")
    .update({
      attendance_exempt,
      attendance_exempt_until: null,
      attendance_exempt_reason: reason || null,
      attendance_exempt_set_at: new Date().toISOString(),
      attendance_exempt_set_by: auth.user.id,
    })
    .eq("id", user_id)
  if (error) return NextResponse.json({ error: "Failed to update exemption" }, { status: 500 })

  // Reset existing windows each save for deterministic config.
  await dataClient.from("attendance_exempt_periods").delete().eq("user_id", user_id)

  if (mode === "weekly") {
    const month = parsed.data.month
    const weeks = parsed.data.weeks || []
    if (!month || weeks.length === 0) {
      return NextResponse.json({ error: "Select a month and at least one week" }, { status: 400 })
    }
    const rows = weeks
      .map((w) => weekRangeInMonth(month, w))
      .filter(Boolean)
      .map((r) => ({
        user_id,
        start_date: r!.start,
        end_date: r!.end,
        kind: "weekly",
        reason: reason || null,
        created_by: auth.user.id,
      }))
    if (rows.length > 0) await dataClient.from("attendance_exempt_periods").insert(rows)
  } else if (mode === "monthly") {
    const months = parsed.data.months || []
    if (months.length === 0) {
      return NextResponse.json({ error: "Select at least one month" }, { status: 400 })
    }
    const rows = months.map((ym) => {
      const range = monthRange(ym)
      return {
        user_id,
        start_date: formatDateUTC(range.start),
        end_date: formatDateUTC(range.end),
        kind: "monthly",
        reason: reason || null,
        created_by: auth.user.id,
      }
    })
    if (rows.length > 0) await dataClient.from("attendance_exempt_periods").insert(rows)
  }

  await writeAuditLog(
    auth.supabase,
    {
      action: "update",
      entityType: "attendance_exemption",
      entityId: user_id,
      newValues: { mode, attendance_exempt, reason: reason || null },
      context: { actorId: auth.user.id, source: "api", route: "/api/admin/hr/attendance/exemptions" },
    },
    { failOpen: true }
  )

  return NextResponse.json({ message: "Exemption settings saved" })
}
