import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { freezeExemptionAtToday } from "@/lib/hr/exemptions"

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
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
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
  const listMode = request.nextUrl.searchParams.get("list") === "1"

  // List mode: every active exemption (timed periods + permanently-exempt employees)
  // within the caller's scope, for the Attendance Manager's "current entries" panel.
  if (listMode && !userId) {
    const dataClient = getServiceRoleClientOrFallback(auth.supabase)
    const depts = getScopedDepartments(auth.scope)

    let scopedUserIds: string[] | null = null
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ data: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ data: [] })
    }

    type PeriodRow = { id: string; user_id: string; start_date: string; end_date: string; reason?: string | null }
    type PermanentRow = {
      id: string
      full_name?: string | null
      first_name?: string | null
      last_name?: string | null
      attendance_exempt_reason?: string | null
    }

    // Selects below name optional columns (reason / attendance_exempt_reason) that
    // may be absent in older environments — a missing column errors the whole query,
    // which would silently drop rows. Fall back to the guaranteed columns so
    // permanently-exempt employees and period entries always surface.
    const fetchPeriods = async (): Promise<PeriodRow[]> => {
      const build = (cols: string) => {
        let q = dataClient
          .from("attendance_exempt_periods")
          .select(cols)
          .order("start_date", { ascending: false })
          .limit(1000)
        if (scopedUserIds !== null) q = q.in("user_id", scopedUserIds)
        return q
      }
      const withReason = await build("id, user_id, start_date, end_date, reason")
      const res = withReason.error ? await build("id, user_id, start_date, end_date") : withReason
      return (res.data ?? []) as unknown as PeriodRow[]
    }

    const fetchPermanent = async (): Promise<PermanentRow[]> => {
      const build = (cols: string) => {
        let q = dataClient.from("profiles").select(cols).eq("attendance_exempt", true)
        if (scopedUserIds !== null) q = q.in("id", scopedUserIds)
        return q
      }
      const withReason = await build("id, full_name, first_name, last_name, attendance_exempt_reason")
      const res = withReason.error ? await build("id, full_name, first_name, last_name") : withReason
      return (res.data ?? []) as unknown as PermanentRow[]
    }

    const [periods, permanent] = await Promise.all([fetchPeriods(), fetchPermanent()])

    const periodUserIds = [...new Set(periods.map((p) => p.user_id).filter(Boolean))]
    const nameMap = new Map<string, string>()
    for (const p of permanent) {
      nameMap.set(p.id, p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown")
    }
    const missingNameIds = periodUserIds.filter((id) => !nameMap.has(id))
    if (missingNameIds.length > 0) {
      const { data: extra } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name")
        .in("id", missingNameIds)
      for (const p of extra ?? []) {
        nameMap.set(p.id, p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown")
      }
    }

    const result = [
      ...permanent.map((p) => ({
        kind: "permanent" as const,
        id: null as string | null,
        user_id: p.id,
        user_name: nameMap.get(p.id) ?? "Unknown",
        start_date: null as string | null,
        end_date: null as string | null,
        reason: p.attendance_exempt_reason || null,
      })),
      ...periods.map((p) => ({
        kind: "period" as const,
        id: p.id as string | null,
        user_id: p.user_id,
        user_name: nameMap.get(p.user_id) ?? "Unknown",
        start_date: p.start_date as string | null,
        end_date: p.end_date as string | null,
        reason: p.reason || null,
      })),
    ]

    return NextResponse.json({ data: result })
  }

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

const AddPeriodSchema = z.object({
  user_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(240).optional().nullable(),
})

/**
 * Adds a single custom exemption window WITHOUT resetting the employee's other
 * periods (unlike the bulk PATCH, which deterministically rebuilds the whole set).
 * This is what the Attendance Manager uses for adding / editing one period so a
 * single edit can't wipe an employee's unrelated exemptions.
 */
export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = AddPeriodSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const { user_id, start_date, end_date, reason } = parsed.data
  if (end_date < start_date) {
    return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  // Scope-check the target employee's department
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

  // DB currently allows kind weekly|monthly; custom ranges persist as monthly-kind (mirrors bulk route).
  const { error } = await dataClient
    .from("attendance_exempt_periods")
    .insert({ user_id, start_date, end_date, kind: "monthly", reason: reason || null, created_by: auth.user.id })
  if (error) {
    const { error: minimalError } = await dataClient
      .from("attendance_exempt_periods")
      .insert({ user_id, start_date, end_date, kind: "monthly" })
    if (minimalError) {
      return NextResponse.json({ error: "Failed to add exemption period" }, { status: 500 })
    }
  }

  await writeAuditLog(
    auth.supabase,
    {
      action: "create",
      entityType: "attendance_exemption",
      entityId: user_id,
      newValues: { start_date, end_date, reason: reason || null, kind: "monthly" },
      context: { actorId: auth.user.id, source: "api", route: "/api/admin/hr/attendance/exemptions" },
    },
    { failOpen: true }
  )

  await recordAttendanceEvent(dataClient, {
    userId: user_id,
    eventDate: start_date,
    eventType: "exemption_added",
    toStatus: "exempted",
    source: "manual",
    comment: reason || null,
    actorId: auth.user.id,
    metadata: { start_date, end_date },
  })

  return NextResponse.json({ message: "Exemption period added" })
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

  // "Off" freezes the exemption at today instead of wiping history: an open infinite
  // exemption becomes a closed [start..today] window and future windows are dropped, so
  // past days stay exempt when re-derived. (Fixes the retroactive un-exempt bug.)
  if (mode === "off") {
    await freezeExemptionAtToday(dataClient, user_id, auth.user.id)
    await writeAuditLog(
      auth.supabase,
      {
        action: "update",
        entityType: "attendance_exemption",
        entityId: user_id,
        newValues: { mode: "off", attendance_exempt: false },
        context: { actorId: auth.user.id, source: "api", route: "/api/admin/hr/attendance/exemptions" },
      },
      { failOpen: true }
    )
    return NextResponse.json({ message: "Exemption stopped — history preserved up to today" })
  }

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

export async function DELETE(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const periodId = String(request.nextUrl.searchParams.get("period_id") || "")
  if (!periodId) return NextResponse.json({ error: "period_id is required" }, { status: 400 })

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  const { data: period } = await dataClient
    .from("attendance_exempt_periods")
    .select("id, user_id, start_date, end_date")
    .eq("id", periodId)
    .maybeSingle()
  if (!period) return NextResponse.json({ error: "Exemption period not found" }, { status: 404 })

  // Scope-check the owning employee's department
  const depts = getScopedDepartments(auth.scope)
  if (depts !== null) {
    const { data: targetProfile } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", period.user_id)
      .maybeSingle()
    if (!targetProfile || !depts.includes(targetProfile.department || "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const { error } = await dataClient.from("attendance_exempt_periods").delete().eq("id", periodId)
  if (error) return NextResponse.json({ error: "Failed to delete exemption period" }, { status: 500 })

  await writeAuditLog(
    auth.supabase,
    {
      action: "delete",
      entityType: "attendance_exemption",
      entityId: period.user_id,
      oldValues: { period_id: periodId, start_date: period.start_date, end_date: period.end_date },
      context: { actorId: auth.user.id, source: "api", route: "/api/admin/hr/attendance/exemptions" },
    },
    { failOpen: true }
  )

  await recordAttendanceEvent(dataClient, {
    userId: period.user_id,
    eventDate: period.start_date,
    eventType: "exemption_removed",
    source: "manual",
    actorId: auth.user.id,
    metadata: { period_id: periodId, start_date: period.start_date, end_date: period.end_date },
  })

  return NextResponse.json({ message: "Exemption period removed" })
}
