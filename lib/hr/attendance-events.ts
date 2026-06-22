import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

const log = logger("attendance-events")

/**
 * Append-only provenance ledger for attendance. attendance_records is the SSOT for
 * current state; attendance_events records *what happened* so the per-day timeline and
 * editor attribution have a single, complete source. Writes are best-effort (fail-open)
 * so logging an event can never block a clock-in, an approval, or a manual edit.
 */

export type AttendanceEventType =
  | "device_punch_in"
  | "device_punch_out"
  | "self_clock_in"
  | "self_clock_out"
  | "remote_clock_in"
  | "remote_clock_out"
  | "manual_create"
  | "manual_update"
  | "manual_delete"
  | "bulk_grant"
  | "bulk_delete"
  | "appeal_requested"
  | "appeal_rejected"
  | "appeal_approved"
  | "appeal_auto_resolved"
  | "leave_granted"
  | "leave_revoked"
  | "exemption_added"
  | "exemption_removed"
  | "holiday_added"
  | "holiday_removed"
  | "marked_incomplete"

export type AttendanceEventSource = "hikvision" | "self" | "remote_web" | "manual" | "appeal" | "cron" | "system"

export interface AttendanceEventInput {
  userId: string
  eventDate: string
  eventType: AttendanceEventType
  attendanceRecordId?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  source?: AttendanceEventSource | null
  comment?: string | null
  actorId?: string | null
  metadata?: Record<string, unknown> | null
}

function toRow(input: AttendanceEventInput) {
  return {
    user_id: input.userId,
    event_date: input.eventDate,
    event_type: input.eventType,
    attendance_record_id: input.attendanceRecordId ?? null,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    source: input.source ?? null,
    comment: input.comment ?? null,
    actor_id: input.actorId ?? null,
    metadata: input.metadata ?? null,
  }
}

/** Append a single attendance event. Never throws — failures are logged and swallowed. */
export async function recordAttendanceEvent(client: SupabaseClient, input: AttendanceEventInput): Promise<void> {
  try {
    const { error } = await client.from("attendance_events").insert(toRow(input))
    if (error) {
      log.error(
        { err: error.message, eventType: input.eventType, userId: input.userId },
        "Failed to record attendance event"
      )
    }
  } catch (err) {
    log.error({ err: String(err), eventType: input.eventType }, "Failed to record attendance event")
  }
}

/** Append many attendance events in one insert. Never throws. */
export async function recordAttendanceEvents(client: SupabaseClient, inputs: AttendanceEventInput[]): Promise<void> {
  if (inputs.length === 0) return
  try {
    const { error } = await client.from("attendance_events").insert(inputs.map(toRow))
    if (error) {
      log.error({ err: error.message, count: inputs.length }, "Failed to record attendance events")
    }
  } catch (err) {
    log.error({ err: String(err), count: inputs.length }, "Failed to record attendance events")
  }
}
