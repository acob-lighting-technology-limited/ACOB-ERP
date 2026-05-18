import { ABSENT_DEDUCTION, latenessDeduction, earlyDepartureDeduction } from "@/lib/hr/attendance-utils"

export type UnifiedAttendanceStatus =
  | "holiday"
  | "exempted"
  | "waiver"
  | "present"
  | "late"
  | "incomplete"
  | "absent"
  | "on_leave"

/** Tailwind colour classes for every canonical attendance status. */
export const ATTENDANCE_STATUS_COLORS: Record<UnifiedAttendanceStatus, string> = {
  present: "bg-green-100 text-green-800",
  late: "bg-yellow-100 text-yellow-800",
  incomplete: "bg-cyan-100 text-cyan-800",
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
export const DB_WRITABLE_STATUSES = ["present", "late", "absent", "incomplete", "waiver"] as const
export type DbAttendanceStatus = (typeof DB_WRITABLE_STATUSES)[number]

export type AttendanceLike = {
  clock_in?: string | null
  clock_out?: string | null
  waived?: boolean | null
}

export function deriveUnifiedAttendanceStatus(input: {
  record?: AttendanceLike | null
  isHoliday?: boolean
  isOnLeave?: boolean
  isExempted?: boolean
}): UnifiedAttendanceStatus {
  if (input.isHoliday) return "holiday"
  if (input.isOnLeave) return "on_leave"
  if (input.isExempted) return "exempted"
  const rec = input.record
  if (!rec) return "absent"
  if (rec.waived) return "waiver"
  if (!rec.clock_in && !rec.clock_out) return "absent"
  if (!rec.clock_in || !rec.clock_out) return "incomplete"
  return latenessDeduction(rec.clock_in) > 0 ? "late" : "present"
}

export function deductionForStatus(
  status: UnifiedAttendanceStatus,
  clockIn?: string | null,
  clockOut?: string | null
): number {
  if (status === "absent") return ABSENT_DEDUCTION
  if (status === "late" || status === "present")
    return latenessDeduction(clockIn || null) + earlyDepartureDeduction(clockOut || null)
  return 0
}
