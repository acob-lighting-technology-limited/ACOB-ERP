import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

const log = logger("admin-hr-attendance-timeline")
export const dynamic = "force-dynamic"

type EventRow = {
  id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  source: string | null
  comment: string | null
  actor_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

/**
 * Unified per-day attendance timeline. Keyed on (user_id, date) — NOT a record id — so
 * days with no attendance_record (absent / OOS / exempt / holiday) still have history.
 * Returns the append-only events for the day plus contextual markers (holiday / on leave /
 * exempt) that affect the derived status but aren't themselves per-user events.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-timeline:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const userId = String(request.nextUrl.searchParams.get("user_id") || "")
    const date = String(request.nextUrl.searchParams.get("date") || "")
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "user_id and a valid date are required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Scope-check the target employee's department
    const depts = getScopedDepartments(scope)
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

    const [{ data: events }, { data: holiday }, { data: leave }, { data: exemptPeriod }, { data: profile }] =
      await Promise.all([
        dataClient
          .from("attendance_events")
          .select("id, event_type, from_status, to_status, source, comment, actor_id, metadata, created_at")
          .eq("user_id", userId)
          .eq("event_date", date)
          .order("created_at", { ascending: true })
          .returns<EventRow[]>(),
        dataClient.from("holiday_calendar").select("name, created_by").eq("holiday_date", date).maybeSingle(),
        dataClient
          .from("leave_requests")
          .select("leave_type")
          .eq("user_id", userId)
          .eq("status", "approved")
          .lte("start_date", date)
          .gte("end_date", date)
          .maybeSingle(),
        dataClient
          .from("attendance_exempt_periods")
          .select("reason")
          .eq("user_id", userId)
          .lte("start_date", date)
          .gte("end_date", date)
          .maybeSingle(),
        dataClient.from("profiles").select("attendance_exempt").eq("id", userId).maybeSingle(),
      ])

    const rows = events ?? []
    const holidayCreatedBy = (holiday as { created_by?: string | null } | null)?.created_by ?? null
    const actorIds = [...new Set([...rows.map((r) => r.actor_id), holidayCreatedBy].filter(Boolean))] as string[]
    const actorMap = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: actors } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name")
        .in("id", actorIds)
      for (const a of actors ?? []) {
        actorMap.set(a.id, a.full_name?.trim() || [a.first_name, a.last_name].filter(Boolean).join(" ") || "Unknown")
      }
    }

    const timeline = rows.map((r) => ({
      id: r.id,
      event_type: r.event_type,
      from_status: r.from_status,
      to_status: r.to_status,
      source: r.source,
      comment: r.comment,
      created_at: r.created_at,
      actor_name: r.actor_id ? (actorMap.get(r.actor_id) ?? "Unknown") : null,
      metadata: r.metadata,
    }))

    return NextResponse.json({
      data: {
        events: timeline,
        context: {
          holiday: holiday?.name ? String(holiday.name) : null,
          holiday_added_by: holidayCreatedBy ? (actorMap.get(holidayCreatedBy) ?? null) : null,
          on_leave: leave ? String((leave as { leave_type?: string }).leave_type || "leave") : null,
          exempt: Boolean(exemptPeriod) || Boolean(profile?.attendance_exempt),
          exempt_reason: (exemptPeriod as { reason?: string | null } | null)?.reason ?? null,
        },
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/timeline")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
