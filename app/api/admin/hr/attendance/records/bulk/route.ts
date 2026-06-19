import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { DB_WRITABLE_STATUSES } from "@/lib/hr/attendance-status"
import { toLocalISODate } from "@/lib/utils/date"

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
  waiver_reason: z.string().trim().max(500).optional().nullable(),
  manual_comment: z.string().trim().min(3, "A comment of at least 3 characters is required").max(500),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-bulk:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const parsed = BulkCreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { user_ids, start_date, end_date, status, waiver_reason, manual_comment } = parsed.data

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

    // Find existing records to avoid duplicates (upsert strategy: skip existing)
    const { data: existingRecords } = await dataClient
      .from("attendance_records")
      .select("user_id, date")
      .in("user_id", allowedIds)
      .in("date", dates)

    const existingSet = new Set(
      (existingRecords ?? []).map((r: { user_id: string; date: string }) => `${r.user_id}::${r.date}`)
    )

    // Build records to insert
    const toInsert: Record<string, unknown>[] = []
    for (const userId of allowedIds) {
      for (const date of dates) {
        if (existingSet.has(`${userId}::${date}`)) continue
        const row: Record<string, unknown> = {
          user_id: userId,
          date,
          status,
          source: "manual",
          manual_comment,
          waived: status === "waiver",
        }
        if (waiver_reason) row.waiver_reason = waiver_reason
        toInsert.push(row)
      }
    }

    if (toInsert.length === 0) {
      return NextResponse.json({
        message: "All records already exist — no new records created",
        created: 0,
        skipped: allowedIds.length * dates.length,
      })
    }

    // Insert in chunks of 500 to avoid Postgres limits
    const chunkSize = 500
    let totalCreated = 0
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize)
      const { error, count } = await dataClient.from("attendance_records").insert(chunk).select()
      if (error) {
        log.error({ err: JSON.stringify(error) }, "Bulk insert failed")
        return NextResponse.json({ error: "Failed to create records" }, { status: 500 })
      }
      totalCreated += count ?? chunk.length
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

    return NextResponse.json({
      message: `Created ${totalCreated} record(s)`,
      created: totalCreated,
      skipped: toInsert.length === 0 ? allowedIds.length * dates.length : 0,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/records/bulk")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
