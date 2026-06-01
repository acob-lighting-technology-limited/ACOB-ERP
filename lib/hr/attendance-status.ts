import { isLate } from "@/lib/hr/attendance-utils"
import { toLocalISODate } from "@/lib/utils/date"

export type UnifiedAttendanceStatus =
  | "holiday"
  | "exempted"
  | "waiver"
  | "present"
  | "late"
  | "incomplete"
  | "half_day"
  | "absent"
  | "on_leave"

/** Tailwind colour classes for every canonical attendance status. */
export const ATTENDANCE_STATUS_COLORS: Record<UnifiedAttendanceStatus, string> = {
  present: "bg-green-100 text-green-800",
  late: "bg-yellow-100 text-yellow-800",
  incomplete: "bg-cyan-100 text-cyan-800",
  half_day: "bg-orange-100 text-orange-800",
  absent: "bg-red-100 text-red-800",
  waiver: "bg-blue-100 text-blue-700",
  exempted: "bg-violet-100 text-violet-700",
  on_leave: "bg-purple-100 text-purple-800",
  holiday: "bg-sky-100 text-sky-700",
}

/** Human-readable labels for statuses whose raw value would look bad in the UI. */
export const ATTENDANCE_STATUS_LABELS: Record<UnifiedAttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  incomplete: "Incomplete",
  half_day: "Half Day",
  absent: "Absent",
  waiver: "Waiver",
  exempted: "Exempted",
  on_leave: "On Leave",
  holiday: "Holiday",
}

/**
 * Statuses that can be written directly to the attendance_records table by an admin.
 * "holiday", "on_leave", and "exempted" are derived from other tables (calendar /
 * leave_requests / exemption_periods) and must never be stored as a raw status value.
 */
export const DB_WRITABLE_STATUSES = ["present", "late", "absent", "incomplete", "half_day", "waiver"] as const
export type DbAttendanceStatus = (typeof DB_WRITABLE_STATUSES)[number]

export type AttendanceLike = {
  clock_in?: string | null
  clock_out?: string | null
  waived?: boolean | null
}

/** Returns true if a clock_out time string is before 17:00. */
export function isEarlyDeparture(clockOut: string): boolean {
  const [h, m] = clockOut.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false
  return h * 60 + m < 17 * 60
}

export function deriveUnifiedAttendanceStatus(input: {
  record?: AttendanceLike | null
  isHoliday?: boolean
  isOnLeave?: boolean
  isExempted?: boolean
  recordDate?: string
}): UnifiedAttendanceStatus {
  if (input.isHoliday) return "holiday"
  if (input.isOnLeave) return "on_leave"
  if (input.isExempted) return "exempted"
  const rec = input.record
  if (!rec) return "absent"
  if (rec.waived) return "waiver"
  if (!rec.clock_in && !rec.clock_out) return "absent"

  const today = toLocalISODate()
  const isPastDate = Boolean(input.recordDate && input.recordDate < today)

  // clock_in present, no clock_out:
  // - past day  → incomplete (no second punch on a finished day)
  // - today (still in progress) → optimistic present/late based on 08:20 cutoff
  if (rec.clock_in && !rec.clock_out) {
    return isPastDate ? "incomplete" : isLate(rec.clock_in) ? "late" : "present"
  }
  if (!rec.clock_in) return "incomplete"
  // Same-second double-fire — treat as incomplete
  if (rec.clock_out && rec.clock_out <= rec.clock_in) return "incomplete"
  // Clocked out before 17:00 → half day (left early), regardless of date
  if (rec.clock_out && isEarlyDeparture(rec.clock_out)) return "half_day"
  return isLate(rec.clock_in) ? "late" : "present"
}
