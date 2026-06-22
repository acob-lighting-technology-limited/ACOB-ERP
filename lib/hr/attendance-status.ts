import { isLate } from "@/lib/hr/attendance-utils"
import { toLocalISODate } from "@/lib/utils/date"

export type UnifiedAttendanceStatus =
  | "holiday"
  | "exempted"
  | "waiver"
  | "present"
  | "late"
  | "lateness_with_permission"
  | "incomplete"
  | "absent"
  | "absent_with_permission"
  | "out_of_station"
  | "on_leave"

/** Tailwind colour classes for every canonical attendance status. */
export const ATTENDANCE_STATUS_COLORS: Record<UnifiedAttendanceStatus, string> = {
  present: "bg-green-100 text-green-800",
  late: "bg-yellow-100 text-yellow-800",
  lateness_with_permission:
    "bg-gradient-to-r from-amber-100 to-green-100 text-green-800 border-amber-200 dark:from-amber-950/40 dark:to-green-950/40 dark:text-green-300",
  incomplete: "bg-cyan-100 text-cyan-800",
  absent: "bg-red-100 text-red-800",
  absent_with_permission:
    "bg-gradient-to-r from-red-100 to-green-100 text-green-800 border-red-200 dark:from-red-950/40 dark:to-green-950/40 dark:text-green-300",
  out_of_station: "bg-indigo-100 text-indigo-800",
  waiver: "bg-blue-100 text-blue-700",
  exempted: "bg-violet-100 text-violet-700",
  on_leave: "bg-purple-100 text-purple-800",
  holiday: "bg-sky-100 text-sky-700",
}

/** Human-readable labels for statuses whose raw value would look bad in the UI. */
export const ATTENDANCE_STATUS_LABELS: Record<UnifiedAttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  lateness_with_permission: "LWP",
  incomplete: "Incomplete",
  absent: "Absent",
  absent_with_permission: "AWP",
  out_of_station: "OOS",
  waiver: "Waiver",
  exempted: "Exempted",
  on_leave: "On Leave",
  holiday: "Holiday",
}
export const DB_WRITABLE_STATUSES = [
  "present",
  "late",
  "absent",
  "incomplete",
  "waiver",
  "lateness_with_permission",
  "absent_with_permission",
  "out_of_station",
] as const
export type DbAttendanceStatus = (typeof DB_WRITABLE_STATUSES)[number]

export const PERMISSION_ATTENDANCE_STATUSES = [
  "lateness_with_permission",
  "absent_with_permission",
  "out_of_station",
] as const
export type PermissionAttendanceStatus = (typeof PERMISSION_ATTENDANCE_STATUSES)[number]

export const MANUAL_ATTENDANCE_STATUS_OPTIONS: Array<{ value: DbAttendanceStatus | "auto"; label: string }> = [
  { value: "auto", label: "Auto-derived" },
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "incomplete", label: "Incomplete" },
  { value: "waiver", label: "Waiver" },
  { value: "lateness_with_permission", label: "LWP" },
  { value: "absent_with_permission", label: "AWP" },
  { value: "out_of_station", label: "OOS" },
  { value: "absent", label: "Absent" },
]

export function isPermissionAttendanceStatus(status: string | null | undefined): status is PermissionAttendanceStatus {
  return PERMISSION_ATTENDANCE_STATUSES.includes(status as PermissionAttendanceStatus)
}

export function normalizeStoredAttendanceStatus(status: string | null | undefined): UnifiedAttendanceStatus | null {
  if (!status) return null
  if (status === "waived") return "waiver"
  if (status === "half_day") return "late"
  if ((DB_WRITABLE_STATUSES as readonly string[]).includes(status)) return status as UnifiedAttendanceStatus
  return null
}

export type AttendanceLike = {
  clock_in?: string | null
  clock_out?: string | null
  status?: string | null
  waived?: boolean | null
}

/** Returns true if a clock_out time string is before 17:00. */
export function isEarlyDeparture(clockOut: string): boolean {
  const [h, m] = clockOut.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false
  return h * 60 + m < 17 * 60
}

export interface ManualStatusEditOptions {
  /** Fully present and on-time — no LWP/AWP override is applicable. */
  isOnTimePresent: boolean
  showLWP: boolean
  showAWP: boolean
  /** Status choices to offer in the manual single-day editor. */
  options: Array<{ value: "lateness_with_permission" | "absent_with_permission"; label: string }>
  /** Sensible default status given the punches present. */
  initialStatus: "" | "lateness_with_permission" | "absent_with_permission"
}

/**
 * Single source of truth for which manual overrides (LWP/AWP) apply to a day, based on
 * its punches. Used by the per-day attendance editor so the rule isn't duplicated between
 * its "open" and "render" paths (and can be reused by any other single-day edit surface).
 */
export function getManualStatusEditOptions(
  record: { clock_in?: string | null; clock_out?: string | null } | null
): ManualStatusEditOptions {
  const clockIn = record?.clock_in ?? null
  const clockOut = record?.clock_out ?? null
  const hasClockIn = Boolean(clockIn)
  const hasClockOut = Boolean(clockOut)
  const hasAnyPunch = hasClockIn || hasClockOut

  const isLatePunch = hasClockIn && isLate(clockIn as string)
  const isEarlyOut = hasClockOut && isEarlyDeparture(clockOut as string)
  const isOnTimePresent = hasClockIn && hasClockOut && !isLatePunch && !isEarlyOut

  const showAWP = !hasAnyPunch
  const showLWP = hasAnyPunch && !isOnTimePresent

  const initialStatus: ManualStatusEditOptions["initialStatus"] = !hasAnyPunch
    ? "absent_with_permission"
    : !isOnTimePresent
      ? "lateness_with_permission"
      : ""

  const options: ManualStatusEditOptions["options"] = [
    ...(showLWP ? [{ value: "lateness_with_permission" as const, label: "LWP" }] : []),
    ...(showAWP ? [{ value: "absent_with_permission" as const, label: "AWP" }] : []),
  ]

  return { isOnTimePresent, showLWP, showAWP, options, initialStatus }
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
  const explicitStatus = normalizeStoredAttendanceStatus(rec.status)
  if (explicitStatus && isPermissionAttendanceStatus(explicitStatus)) return explicitStatus
  if (rec.waived) return "waiver"
  if (explicitStatus === "waiver") return "waiver"
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
  // Clocked out before 17:00 → late, unless an admin explicitly marks LWP.
  if (rec.clock_out && isEarlyDeparture(rec.clock_out)) return "late"
  return isLate(rec.clock_in) ? "late" : "present"
}
