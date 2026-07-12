import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { freezeExemptionAtToday } from "@/lib/hr/exemptions"

const BulkExemptionSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  mode: z.enum(["off", "weekly", "monthly", "infinite", "period"]),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  weeks: z.array(z.number().int().min(1).max(6)).optional(),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
  const rl = await rateLimit(`admin-attendance-exemptions-bulk:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return { error: scopeResult.response }
  return { supabase: scopeResult.supabase, userId: scopeResult.scope.userId, scope: scopeResult.scope }
}

export async function PATCH(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = BulkExemptionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const { mode, reason } = parsed.data
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const attendance_exempt = mode === "infinite"

  // Filter requested user_ids to only those within this admin/lead's department scope
  let user_ids = parsed.data.user_ids
  const depts = getScopedDepartments(auth.scope)
  if (depts !== null) {
    if (depts.length === 0) return NextResponse.json({ error: "No accessible departments" }, { status: 403 })
    const { data: scopedProfiles } = await dataClient
      .from("profiles")
      .select("id")
      .in("id", user_ids)
      .in("department", depts)
    user_ids = (scopedProfiles ?? []).map((p) => p.id)
    if (user_ids.length === 0) return NextResponse.json({ error: "No accessible employees selected" }, { status: 403 })
  }

  // "Off" freezes each exemption at today rather than wiping history (see
  // freezeExemptionAtToday). Past exempt days are preserved; nothing new going forward.
  if (mode === "off") {
    for (const userId of user_ids) {
      await freezeExemptionAtToday(dataClient, userId, auth.userId)
    }
    return NextResponse.json({ message: "Exemptions stopped — history preserved up to today" })
  }

  for (const userId of user_ids) {
    const insertExemptRows = async (
      rows: Array<{
        user_id: string
        start_date: string
        end_date: string
        kind?: string
        reason?: string | null
        created_by?: string
      }>
    ) => {
      const { error: fullInsertError } = await dataClient.from("attendance_exempt_periods").insert(rows)
      if (!fullInsertError) return null
      const fallbackRowsWithKind = rows.map((row) => ({
        user_id: row.user_id,
        start_date: row.start_date,
        end_date: row.end_date,
        kind: row.kind === "weekly" ? "weekly" : "monthly",
      }))
      const { error: fallbackWithKindError } = await dataClient
        .from("attendance_exempt_periods")
        .insert(fallbackRowsWithKind)
      if (!fallbackWithKindError) return null

      const fallbackRowsMinimal = rows.map((row) => ({
        user_id: row.user_id,
        start_date: row.start_date,
        end_date: row.end_date,
        kind: row.kind === "weekly" ? "weekly" : "monthly",
      }))
      const { error: fallbackMinimalError } = await dataClient
        .from("attendance_exempt_periods")
        .insert(fallbackRowsMinimal)
      return fallbackMinimalError || null
    }

    const primaryPayload = {
      attendance_exempt,
      attendance_exempt_until: null,
      attendance_exempt_reason: reason || null,
      attendance_exempt_set_at: new Date().toISOString(),
      attendance_exempt_set_by: auth.userId,
    }
    const { error: profileError } = await dataClient.from("profiles").update(primaryPayload).eq("id", userId)
    if (profileError) {
      // Backward-compat fallback for environments that may not have all audit columns yet.
      const fallbackPayload = {
        attendance_exempt,
        attendance_exempt_until: null,
        attendance_exempt_reason: reason || null,
      }
      const { error: fallbackError } = await dataClient.from("profiles").update(fallbackPayload).eq("id", userId)
      if (fallbackError) {
        const minimalPayload = { attendance_exempt }
        const { error: minimalError } = await dataClient.from("profiles").update(minimalPayload).eq("id", userId)
        if (minimalError) {
          return NextResponse.json(
            { error: `Failed to update exemption profile for ${userId}: ${minimalError.message || "unknown error"}` },
            { status: 500 }
          )
        }
      }
    }

    const { error: deletePeriodsError } = await dataClient
      .from("attendance_exempt_periods")
      .delete()
      .eq("user_id", userId)
    if (deletePeriodsError) {
      return NextResponse.json(
        { error: `Failed to reset exemption periods for ${userId}: ${deletePeriodsError.message || "unknown error"}` },
        { status: 500 }
      )
    }

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
          user_id: userId,
          start_date: r!.start,
          end_date: r!.end,
          kind: "weekly",
          reason: reason || null,
          created_by: auth.userId,
        }))
      if (rows.length > 0) {
        const insertError = await insertExemptRows(rows)
        if (insertError) {
          return NextResponse.json(
            { error: `Failed to save weekly exemption for ${userId}: ${insertError.message || "unknown error"}` },
            { status: 500 }
          )
        }
      }
    } else if (mode === "monthly") {
      const months = parsed.data.months || []
      if (months.length === 0) return NextResponse.json({ error: "Select at least one month" }, { status: 400 })
      const rows = months.map((ym) => {
        const range = monthRange(ym)
        return {
          user_id: userId,
          start_date: formatDateUTC(range.start),
          end_date: formatDateUTC(range.end),
          kind: "monthly",
          reason: reason || null,
          created_by: auth.userId,
        }
      })
      if (rows.length > 0) {
        const insertError = await insertExemptRows(rows)
        if (insertError) {
          return NextResponse.json(
            { error: `Failed to save monthly exemption for ${userId}: ${insertError.message || "unknown error"}` },
            { status: 500 }
          )
        }
      }
    } else if (mode === "period") {
      const startDate = parsed.data.start_date
      const endDate = parsed.data.end_date
      if (!startDate || !endDate || startDate > endDate) {
        return NextResponse.json({ error: "Choose a valid start and end date" }, { status: 400 })
      }
      const insertError = await insertExemptRows([
        {
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
          // DB currently only allows weekly/monthly; custom period is persisted as monthly-kind range.
          kind: "monthly",
          reason: reason || null,
          created_by: auth.userId,
        },
      ])
      if (insertError) {
        return NextResponse.json(
          { error: `Failed to save custom period exemption for ${userId}: ${insertError.message || "unknown error"}` },
          { status: 500 }
        )
      }
    }
  }

  return NextResponse.json({ message: "Exemption settings saved" })
}
