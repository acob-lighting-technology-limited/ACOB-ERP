import { isLate } from "@/lib/hr/attendance-utils"
import { toLocalISODate } from "@/lib/utils/date"
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"

export function isLateWithPolicy(clockIn: string | null | undefined, lateCutoff: string): boolean {
  if (!clockIn) return false
  const [h, m] = clockIn.split(":").map(Number)
  const [ch, cm] = lateCutoff.split(":").map(Number)
  if (isNaN(h) || isNaN(m) || isNaN(ch) || isNaN(cm)) return false
  return h * 60 + m > ch * 60 + cm
}

export type UnifiedAttendanceStatus =
  | "holiday"
  | "exempted"
  | "waiver"
  | "waived"
  | "early"
  | "present"
  | "late"
  | "lateness_with_permission"
  | "early_departure"
  | "early_departure_with_permission"
  | "early_closure"
  | "late_resumption"
  | "incomplete"
  | "absent"
  | "absent_with_permission"
  | "out_of_station"
  | "on_leave"
  | "lwop"
  | "weekend"
  | "no_record"
  | "half_day"

/** Tailwind colour classes for every canonical attendance status (with dark mode support). */
export const ATTENDANCE_STATUS_COLORS: Record<UnifiedAttendanceStatus, string> = {
  early: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 border-green-200 dark:border-green-800",
  present: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  late: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
  lateness_with_permission:
    "bg-gradient-to-r from-amber-100 to-green-100 text-green-800 border-amber-200 dark:from-amber-950/40 dark:to-green-950/40 dark:text-green-300",
  early_departure:
    "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  early_departure_with_permission:
    "bg-gradient-to-r from-orange-100 to-green-100 text-green-800 border-orange-200 dark:from-orange-950/40 dark:to-green-950/40 dark:text-green-300",
  early_closure:
    "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  late_resumption: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  incomplete: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
  absent: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800",
  absent_with_permission:
    "bg-gradient-to-r from-red-100 to-green-100 text-green-800 border-red-200 dark:from-red-950/40 dark:to-green-950/40 dark:text-green-300",
  out_of_station:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
  waiver: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  waived: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  exempted:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border-violet-200 dark:border-violet-800",
  on_leave:
    "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  // Deliberately not purple like paid leave — an unpaid day should not read as a benefit.
  lwop: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  holiday: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  weekend: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  no_record: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  half_day:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
}

/** Human-readable labels for statuses whose raw value would look bad in the UI. */
export const ATTENDANCE_STATUS_LABELS: Record<UnifiedAttendanceStatus, string> = {
  early: "Early",
  present: "Present",
  late: "Late",
  lateness_with_permission: "LWP",
  early_departure: "Left Early",
  early_departure_with_permission: "LEWP",
  early_closure: "Early Closure",
  late_resumption: "Late Resumption",
  incomplete: "Incomplete",
  absent: "Absent",
  absent_with_permission: "AWP",
  out_of_station: "OOS",
  waiver: "Waiver",
  waived: "Waiver",
  exempted: "Exempted",
  on_leave: "On Leave",
  lwop: "LWOP",
  holiday: "Holiday",
  weekend: "Weekend",
  no_record: "No Record",
  half_day: "Half Day",
}
export const DB_WRITABLE_STATUSES = [
  "early",
  "present",
  "late",
  "absent",
  "incomplete",
  "waiver",
  "lateness_with_permission",
  "absent_with_permission",
  "early_departure_with_permission",
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
  { value: "early", label: "Early" },
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "incomplete", label: "Incomplete" },
  { value: "waiver", label: "Waiver" },
  { value: "lateness_with_permission", label: "LWP" },
  { value: "absent_with_permission", label: "AWP" },
  { value: "early_departure_with_permission", label: "LEWP" },
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
  if (status in ATTENDANCE_STATUS_COLORS) return status as UnifiedAttendanceStatus
  if ((DB_WRITABLE_STATUSES as readonly string[]).includes(status)) return status as UnifiedAttendanceStatus
  return null
}

export type AttendanceLike = {
  clock_in?: string | null
  clock_out?: string | null
  status?: string | null
  waived?: boolean | null
}

/** Returns true if a clock_out time string is before endTime. */
export function isEarlyDeparture(clockOut: string, endTime: string = "17:00"): boolean {
  const [h, m] = clockOut.split(":").map(Number)
  const [eh, em] = endTime.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(eh) || !Number.isFinite(em)) return false
  return h * 60 + m < eh * 60 + em
}

/** Day-level early office-closure context (org-wide), if the date is a closure day. */
export type EarlyClosureInfo = { closeTime: string } | null | undefined

/**
 * Early-departure facts for a completed day, independent of the primary status label.
 * Used to render the secondary "Left Early" chip when the primary status is "Late"
 * (late + left-early both show). `approved` = the early-out was granted permission
 * (LEWP); it forgives the early-out hours but never the lateness.
 */
export function getEarlyDepartureFacts(
  rec: AttendanceLike | null | undefined,
  earlyClosure: EarlyClosureInfo,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): { leftEarly: boolean; approved: boolean; onClosureDay: boolean } {
  const onClosureDay = Boolean(earlyClosure?.closeTime)
  if (!rec?.clock_in || !rec?.clock_out || rec.clock_out <= rec.clock_in) {
    return { leftEarly: false, approved: false, onClosureDay }
  }
  const effectiveEnd = earlyClosure?.closeTime ?? policy.endTime
  return {
    leftEarly: isEarlyDeparture(rec.clock_out, effectiveEnd),
    approved: normalizeStoredAttendanceStatus(rec.status) === "early_departure_with_permission",
    onClosureDay,
  }
}

type ManualPermissionValue = "lateness_with_permission" | "absent_with_permission" | "early_departure_with_permission"

export interface ManualStatusEditOptions {
  /** Fully present and on-time — no LWP/AWP/LEWP override is applicable. */
  isOnTimePresent: boolean
  showLWP: boolean
  showAWP: boolean
  /** Early departure with permission is applicable (on-time arrival, left early). */
  showLEWP: boolean
  /** Status choices to offer in the manual single-day editor. */
  options: Array<{ value: ManualPermissionValue; label: string }>
  /** Sensible default status given the punches present. */
  initialStatus: "" | ManualPermissionValue
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
  // Left-early-with-permission applies when they arrived on time but left early.
  const showLEWP = isEarlyOut && !isLatePunch

  const initialStatus: ManualStatusEditOptions["initialStatus"] = !hasAnyPunch
    ? "absent_with_permission"
    : showLEWP
      ? "early_departure_with_permission"
      : !isOnTimePresent
        ? "lateness_with_permission"
        : ""

  const options: ManualStatusEditOptions["options"] = [
    ...(showLWP ? [{ value: "lateness_with_permission" as const, label: "LWP" }] : []),
    ...(showLEWP ? [{ value: "early_departure_with_permission" as const, label: "LEWP" }] : []),
    ...(showAWP ? [{ value: "absent_with_permission" as const, label: "AWP" }] : []),
  ]

  return { isOnTimePresent, showLWP, showAWP, showLEWP, options, initialStatus }
}

export function deriveUnifiedAttendanceStatus(
  input: {
    record?: AttendanceLike | null
    isHoliday?: boolean
    isOnLeave?: boolean
    /** Leave of an unpaid type (LWOP) — takes precedence over isOnLeave. */
    isOnUnpaidLeave?: boolean
    isExempted?: boolean
    recordDate?: string
    /** Org-wide early-closure context for this date, if any. */
    earlyClosure?: EarlyClosureInfo
    /** Org-wide late-resumption context for this date, if any. */
    lateResumption?: { resumptionTime: string } | null
  },
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): UnifiedAttendanceStatus {
  if (input.isHoliday) return "holiday"
  // Unpaid leave is checked first: it is still leave, but it must not present as the covered,
  // benign "On Leave" that paid leave gets.
  if (input.isOnUnpaidLeave) return "lwop"
  if (input.isOnLeave) return "on_leave"
  if (input.isExempted) return "exempted"
  const rec = input.record
  if (!rec) return "absent"
  const explicitStatus = normalizeStoredAttendanceStatus(rec.status)
  // Whole-day permission overrides (LWP/AWP/OOS) — LEWP is handled below because it
  // must not rescue a late arrival, only the early departure.
  if (explicitStatus && isPermissionAttendanceStatus(explicitStatus)) return explicitStatus
  if (rec.waived) return "waiver"
  if (explicitStatus === "waiver") return "waiver"
  if (!rec.clock_in && !rec.clock_out) return "absent"

  const today = toLocalISODate()
  const isPastDate = Boolean(input.recordDate && input.recordDate < today)

  const effectiveGraceCutoff = input.lateResumption?.resumptionTime ?? policy.lateCutoff

  // clock_in present, no clock_out:
  // - past day  → incomplete (no second punch on a finished day)
  // - today (still in progress) → optimistic early/late based on policy grace cutoff
  if (rec.clock_in && !rec.clock_out) {
    return isPastDate
      ? "incomplete"
      : isLateWithPolicy(rec.clock_in, effectiveGraceCutoff)
        ? "late"
        : input.lateResumption
          ? "late_resumption"
          : "early"
  }
  if (!rec.clock_in) return "incomplete"
  // Same-second double-fire — treat as incomplete
  if (rec.clock_out && rec.clock_out <= rec.clock_in) return "incomplete"

  // Both punches present. Late arrival always wins the primary label; the early
  // departure surfaces via a secondary chip (see getEarlyDepartureFacts).
  if (isLateWithPolicy(rec.clock_in, effectiveGraceCutoff)) return "late"

  const closeTime = input.earlyClosure?.closeTime ?? null
  const effectiveEnd = closeTime ?? policy.endTime
  const leftEarly = rec.clock_out ? isEarlyDeparture(rec.clock_out, effectiveEnd) : false

  // On time. Approved early-out (LEWP) shows as such; an unapproved early-out is
  // "Left Early"; leaving at/after an early-closure time is "Early Closure".
  if (explicitStatus === "early_departure_with_permission") return "early_departure_with_permission"
  if (leftEarly) return "early_departure"
  if (closeTime) return "early_closure"
  if (input.lateResumption) return "late_resumption"
  return "early"
}
