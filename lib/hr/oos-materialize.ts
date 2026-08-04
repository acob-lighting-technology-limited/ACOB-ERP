import type { SupabaseClient } from "@supabase/supabase-js"
import { recordAttendanceEvents } from "@/lib/hr/attendance-events"
import { toLocalISODate } from "@/lib/utils/date"

/** Inclusive list of workday ISO dates between start and end (weekends skipped). */
export function oosWorkdays(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + "T00:00:00Z")
  const last = new Date(end + "T00:00:00Z")
  while (cur <= last) {
    const iso = toLocalISODate(cur)
    const day = new Date(iso + "T12:00:00Z").getUTCDay()
    if (day !== 0 && day !== 6) dates.push(iso)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/**
 * Materialize OOS into attendance_records for the given user/date pairs.
 *
 * OOS stays materialized (not derived) so every existing reader of attendance_records
 * keeps seeing it. Applies the same override rule as the bulk endpoint:
 *   - fully-present day (clock-in AND clock-out) → NEVER converted (person was in office),
 *   - incomplete day (clock-in, no clock-out)     → overridden (the "left mid-day" case),
 *   - empty day                                   → fresh OOS record.
 * Overrides preserve the punches, so removing OOS re-derives the real status.
 */
export async function materializeOos(
  dataClient: SupabaseClient,
  userIds: string[],
  dates: string[],
  comment: string,
  actorId: string | null
): Promise<{ created: number; overrode: number; skipped: number }> {
  if (userIds.length === 0 || dates.length === 0) return { created: 0, overrode: 0, skipped: 0 }

  type ExistingRow = { id: string; user_id: string; date: string; clock_in: string | null; clock_out: string | null }
  const { data: existingRecords } = await dataClient
    .from("attendance_records")
    .select("id, user_id, date, clock_in, clock_out")
    .in("user_id", userIds)
    .in("date", dates)
  const existingByKey = new Map<string, ExistingRow>()
  for (const r of (existingRecords ?? []) as ExistingRow[]) existingByKey.set(`${r.user_id}::${r.date}`, r)

  const toInsert: Record<string, unknown>[] = []
  const overrides: ExistingRow[] = []
  let skipped = 0
  for (const userId of userIds) {
    for (const date of dates) {
      const existing = existingByKey.get(`${userId}::${date}`)
      if (existing) {
        if (existing.clock_in && existing.clock_out) {
          skipped++
          continue
        }
        overrides.push(existing)
        continue
      }
      toInsert.push({
        user_id: userId,
        date,
        status: "out_of_station",
        source: "manual",
        manual_comment: comment,
        waived: false,
      })
    }
  }

  let overrode = 0
  if (overrides.length > 0) {
    const { error } = await dataClient
      .from("attendance_records")
      .update({ status: "out_of_station", source: "manual", manual_comment: comment, waived: false })
      .in(
        "id",
        overrides.map((o) => o.id)
      )
    if (!error) {
      overrode = overrides.length
      await recordAttendanceEvents(
        dataClient,
        overrides.map((o) => ({
          userId: o.user_id,
          eventDate: o.date,
          eventType: "bulk_grant" as const,
          attendanceRecordId: o.id,
          toStatus: "out_of_station",
          source: "manual" as const,
          comment,
          actorId,
          metadata: { override: true, had_punch: Boolean(o.clock_in || o.clock_out), oos_period: true },
        }))
      )
    }
  }

  let created = 0
  if (toInsert.length > 0) {
    const { data: inserted, error } = await dataClient
      .from("attendance_records")
      .insert(toInsert)
      .select("id, user_id, date")
    if (!error && inserted) {
      created = inserted.length
      await recordAttendanceEvents(
        dataClient,
        (inserted as Array<{ id: string; user_id: string; date: string }>).map((row) => ({
          userId: row.user_id,
          eventDate: row.date,
          eventType: "bulk_grant" as const,
          attendanceRecordId: row.id,
          toStatus: "out_of_station",
          source: "manual" as const,
          comment,
          actorId,
          metadata: { oos_period: true },
        }))
      )
    }
  }

  return { created, overrode, skipped }
}
