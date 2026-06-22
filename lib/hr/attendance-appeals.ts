import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"

const log = logger("attendance-appeals")

const AUTO_RESOLVE_STATUSES = new Set(["absent_with_permission", "lateness_with_permission"])

/**
 * App-level replacement for the old `auto_resolve_appeals` DB trigger. When an admin
 * manually sets a day to AWP/LWP, any matching pending appeal for that day is approved
 * and the resolution is recorded on the attendance timeline. Keeping this in the app
 * (instead of a hidden trigger) means every state transition is observable and testable.
 * Best-effort: never throws.
 */
export async function resolvePendingAppealOnManualStatus(
  client: SupabaseClient,
  params: {
    userId: string
    date: string
    status: string
    attendanceRecordId?: string | null
    comment?: string | null
    actorId?: string | null
  }
): Promise<void> {
  if (!AUTO_RESOLVE_STATUSES.has(params.status)) return
  try {
    const { data: pending } = await client
      .from("attendance_appeals")
      .select("id")
      .eq("user_id", params.userId)
      .eq("appeal_date", params.date)
      .eq("status", "pending")
      .maybeSingle<{ id: string }>()

    if (!pending) return

    const now = new Date().toISOString()
    const note = params.comment?.trim() || "Automatically approved via manual roster update"
    const { error } = await client
      .from("attendance_appeals")
      .update({
        status: "approved",
        resolution_note: note,
        reviewed_by: params.actorId ?? null,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", pending.id)
    if (error) {
      log.error({ err: error.message, appealId: pending.id }, "Failed to auto-resolve appeal")
      return
    }

    await recordAttendanceEvent(client, {
      userId: params.userId,
      eventDate: params.date,
      eventType: "appeal_auto_resolved",
      attendanceRecordId: params.attendanceRecordId ?? null,
      toStatus: params.status,
      source: "manual",
      comment: note,
      actorId: params.actorId ?? null,
      metadata: { appeal_id: pending.id },
    })
  } catch (err) {
    log.error({ err: String(err) }, "Failed to auto-resolve appeal")
  }
}
