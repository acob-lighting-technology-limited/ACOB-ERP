import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvents } from "@/lib/hr/attendance-events"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import {
  DB_WRITABLE_STATUSES,
  deriveUnifiedAttendanceStatus,
  isPermissionAttendanceStatus,
} from "@/lib/hr/attendance-status"
import { toLocalISODate } from "@/lib/utils/date"
import { loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { validateLwpAwpMonthlyQuota } from "@/lib/hr/attendance-quota"

const log = logger("admin-hr-attendance-records-bulk")
export const dynamic = "force-dynamic"

// Helper to generate an inclusive list of ISO dates between two dates
function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + "T00:00:00Z")
  const last = new Date(end + "T00:00:00Z")
  while (cur <= last) {
    dates.push(toLocalISODate(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

function isWeekend(date: string): boolean {
  const d = new Date(date + "T12:00:00Z")
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

const BulkCreateSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(DB_WRITABLE_STATUSES),
  manual_comment: z.string().trim().min(3, "A comment of at least 3 characters is required").max(500),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-bulk:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult
    const policy = await loadAttendancePolicy(supabase)

    const parsed = BulkCreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { user_ids, start_date, end_date, status, manual_comment } = parsed.data

    if (status === "waiver" && !manual_comment.trim()) {
      return NextResponse.json({ error: "Waiver requires a reason or comment" }, { status: 400 })
    }

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

    // Generate all dates in the range (skip weekends)
    const dates = dateRange(start_date, end_date).filter((d) => !isWeekend(d))
    if (dates.length === 0) {
      return NextResponse.json({ error: "No workdays found in the specified date range" }, { status: 400 })
    }

    if (
      ["lateness_with_permission", "incomplete_with_permission", "absent_with_permission"].includes(status) &&
      !scope.isAdminLike
    ) {
      for (const uid of allowedIds) {
        const check = await validateLwpAwpMonthlyQuota({
          dataClient,
          userId: uid,
          targetStatus: status,
          date: start_date,
          isAdminLike: false,
        })
        if (!check.allowed) {
          return NextResponse.json({ error: check.error }, { status: 403 })
        }
      }
    }

    // Find existing records. Days that already have a record (including real clock-ins)
    // are OVERRIDDEN non-destructively: we change the status but PRESERVE the punches, so
    // the override is reversible (removing it re-derives the real status from the punches).
    type ExistingRow = { id: string; user_id: string; date: string; clock_in: string | null; clock_out: string | null }
    const { data: existingRecords } = await dataClient
      .from("attendance_records")
      .select("id, user_id, date, clock_in, clock_out")
      .in("user_id", allowedIds)
      .in("date", dates)

    const existingByKey = new Map<string, ExistingRow>()
    for (const r of (existingRecords ?? []) as ExistingRow[]) existingByKey.set(`${r.user_id}::${r.date}`, r)

    // Days with no record → insert; days with a record → override (preserve punches).
    const toInsert: Record<string, unknown>[] = []
    const overrides: ExistingRow[] = []
    const skipped: ExistingRow[] = []
    for (const userId of allowedIds) {
      for (const date of dates) {
        const existing = existingByKey.get(`${userId}::${date}`)
        if (existing) {
          // OOS never overrides a fully-present day (clock-in AND clock-out): the person
          // was demonstrably in the office, so they cannot be out of station that day. A
          // day with a clock-in but NO clock-out is the "clocked in, then left for OOS
          // and never clocked out" case, which IS a legitimate override. Waiver keeps
          // overriding any day — its purpose is to forgive a late/complete clock-in.
          if (status === "out_of_station" && existing.clock_in && existing.clock_out) {
            skipped.push(existing)
            continue
          }
          overrides.push(existing)
          continue
        }
        const row: Record<string, unknown> = {
          user_id: userId,
          date,
          status,
          source: "manual",
          manual_comment,
          waived: status === "waiver",
        }
        toInsert.push(row)
      }
    }

    // Override existing records' status while keeping their clock-ins/outs intact.
    const overridden = overrides.filter((o) => Boolean(o.clock_in || o.clock_out))
    if (overrides.length > 0) {
      const update: Record<string, unknown> = {
        status,
        source: "manual",
        manual_comment,
        waived: status === "waiver",
      }
      const { error: overrideError } = await dataClient
        .from("attendance_records")
        .update(update)
        .in(
          "id",
          overrides.map((o) => o.id)
        )
      if (overrideError) {
        log.error({ err: JSON.stringify(overrideError) }, "Bulk override failed")
        return NextResponse.json({ error: "Failed to apply override" }, { status: 500 })
      }
      for (const o of overrides) {
        await writeAuditLog(
          supabase,
          {
            action: "update",
            entityType: "attendance_record",
            entityId: o.id,
            newValues: { user_id: o.user_id, status, source: "manual", manual_comment, waived: status === "waiver" },
            context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/records/bulk" },
          },
          { failOpen: true }
        )
      }
      await recordAttendanceEvents(
        dataClient,
        overrides.map((o) => ({
          userId: o.user_id,
          eventDate: o.date,
          eventType: "bulk_grant" as const,
          attendanceRecordId: o.id,
          toStatus: status,
          source: "manual" as const,
          comment: manual_comment,
          actorId: scope.userId,
          metadata: { override: true, had_punch: Boolean(o.clock_in || o.clock_out) },
        }))
      )
    }

    if (toInsert.length === 0 && overrides.length === 0) {
      return NextResponse.json({
        message:
          skipped.length > 0
            ? `Nothing applied — ${skipped.length} day(s) were already fully present and kept as-is`
            : "Nothing to apply",
        created: 0,
        overridden: 0,
        overrode: 0,
        skipped: skipped.length,
      })
    }

    if (toInsert.length === 0) {
      return NextResponse.json({
        message: `Override applied to ${overrides.length} record(s)`,
        created: 0,
        overridden: overridden.length,
        overrode: overrides.length,
        skipped: skipped.length,
      })
    }

    // Insert in chunks of 500 to avoid Postgres limits
    const chunkSize = 500
    let totalCreated = 0
    const createdRows: Array<{ id: string; user_id: string; date: string; status: string }> = []
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize)
      const {
        data: inserted,
        error,
        count,
      } = await dataClient.from("attendance_records").insert(chunk).select("id, user_id, date, status")
      if (error) {
        log.error({ err: JSON.stringify(error) }, "Bulk insert failed")
        return NextResponse.json({ error: "Failed to create records" }, { status: 500 })
      }
      if (inserted) createdRows.push(...(inserted as typeof createdRows))
      totalCreated += count ?? inserted?.length ?? chunk.length
    }

    // Per-record audit logs so each created record surfaces in its own edit history
    // (the aggregate log below is keyed on a synthetic id and is invisible to the
    // per-record history endpoint, which matches entity_type "attendance_record").
    for (const row of createdRows) {
      await writeAuditLog(
        supabase,
        {
          action: "create",
          entityType: "attendance_record",
          entityId: row.id,
          newValues: {
            user_id: row.user_id,
            status: row.status,
            date: row.date,
            source: "manual",
            manual_comment,
            waived: status === "waiver",
          },
          context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/records/bulk" },
        },
        { failOpen: true }
      )
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "attendance_record_bulk",
        entityId: `bulk-${status}-${start_date}-${end_date}`,
        newValues: { user_ids: allowedIds, start_date, end_date, status, manual_comment },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/records/bulk" },
      },
      { failOpen: true }
    )

    // Provenance: one timeline event per granted day.
    await recordAttendanceEvents(
      dataClient,
      createdRows.map((row) => ({
        userId: row.user_id,
        eventDate: row.date,
        eventType: "bulk_grant" as const,
        attendanceRecordId: row.id,
        toStatus: row.status,
        source: "manual" as const,
        comment: manual_comment,
        actorId: scope.userId,
      }))
    )

    return NextResponse.json({
      message: `Created ${totalCreated} record(s)`,
      created: totalCreated,
      overridden: overridden.length,
      overrode: overrides.length,
      skipped: skipped.length,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/records/bulk")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
})

export async function DELETE(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-bulk-delete:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult
    const policy = await loadAttendancePolicy(supabase)

    const parsed = BulkDeleteSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Load the target rows and restrict to the caller's department scope
    type TargetRow = {
      id: string
      user_id: string
      date: string
      status: string
      clock_in: string | null
      clock_out: string | null
    }
    const { data: rows } = await dataClient
      .from("attendance_records")
      .select("id, user_id, date, status, clock_in, clock_out")
      .in("id", parsed.data.ids)

    let target = (rows ?? []) as TargetRow[]
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      const userIds = [...new Set(target.map((r) => r.user_id))]
      const { data: scopedProfiles } = await dataClient
        .from("profiles")
        .select("id")
        .in("id", userIds)
        .in("department", depts)
      const allowed = new Set((scopedProfiles ?? []).map((p) => p.id))
      target = target.filter((r) => allowed.has(r.user_id))
    }

    if (target.length === 0) {
      return NextResponse.json({ error: "No deletable records found in your scope" }, { status: 403 })
    }

    // Graceful reversal: rows that have real punches were overrides — revert their status by
    // re-deriving from the punches (keeping the clock-ins). Rows with no punch were pure
    // manual records (OOS/waiver on an absent day) — delete them.
    const toRevert = target.filter((r) => Boolean(r.clock_in || r.clock_out))
    const toRemove = target.filter((r) => !(r.clock_in || r.clock_out))

    if (toRemove.length > 0) {
      const { error } = await dataClient
        .from("attendance_records")
        .delete()
        .in(
          "id",
          toRemove.map((r) => r.id)
        )
      if (error) {
        log.error({ err: JSON.stringify(error) }, "Bulk delete failed")
        return NextResponse.json({ error: "Failed to delete records" }, { status: 500 })
      }
    }

    for (const row of toRevert) {
      // Preserve individually-set permission statuses (LWP/AWP/OOS) so a bulk revert
      // targeting other records doesn't silently strip them. For all other statuses
      // (waiver, present, late, etc.) re-derive from the raw punches as intended.
      const preservedStatus = isPermissionAttendanceStatus(row.status) ? row.status : null
      const revertedStatus = deriveUnifiedAttendanceStatus(
        {
          record: { clock_in: row.clock_in, clock_out: row.clock_out, waived: false, status: preservedStatus },
          recordDate: row.date,
        },
        policy
      )
      await dataClient
        .from("attendance_records")
        .update({ status: revertedStatus, waived: false, manual_comment: null })
        .eq("id", row.id)
    }

    for (const row of target) {
      const reverted = Boolean(row.clock_in || row.clock_out)
      await writeAuditLog(
        supabase,
        {
          action: reverted ? "update" : "delete",
          entityType: "attendance_record",
          entityId: row.id,
          oldValues: { status: row.status, date: row.date, user_id: row.user_id },
          context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/records/bulk" },
        },
        { failOpen: true }
      )
    }

    // Provenance: reverted days log a manual_update (restored), removed days a bulk_delete.
    await recordAttendanceEvents(
      dataClient,
      target.map((row) => {
        const reverted = Boolean(row.clock_in || row.clock_out)
        return {
          userId: row.user_id,
          eventDate: row.date,
          eventType: reverted ? ("manual_update" as const) : ("bulk_delete" as const),
          attendanceRecordId: reverted ? row.id : null,
          fromStatus: row.status,
          source: "manual" as const,
          comment: reverted ? "Override removed — reverted to recorded attendance" : null,
          actorId: scope.userId,
        }
      })
    )

    return NextResponse.json({
      message: `Removed ${target.length} entr(ies)`,
      deleted: toRemove.length,
      reverted: toRevert.length,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/admin/hr/attendance/records/bulk")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
