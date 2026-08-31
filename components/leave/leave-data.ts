import type { LeaveBalance, LeaveRequest, LeaveType } from "@/app/(app)/leave/page"
import { toLocalISODate } from "@/lib/utils/date"
import {
  countLeaveDays,
  describeSegments,
  nextWorkingDayAfter,
  firstWorkingDayOnOrAfter,
  segmentsWorkingDays,
  NO_HOLIDAYS,
  type HolidaySet,
  type LeaveRangeBreakdown,
} from "@/lib/hr/leave-days"

export type LeaveDepartmentBookedDate = {
  date: string
  status?: "approved" | "pending" | "both"
  count: number
  employees: string[]
  approved_employees?: string[]
  pending_employees?: string[]
}

export type LeaveHoliday = {
  date: string
  name: string
}

export type LeaveCalendarData = {
  blackout_months: number[]
  department_booked_dates: LeaveDepartmentBookedDate[]
  /** Public holidays in the booking window — never deducted from the balance. */
  holidays: LeaveHoliday[]
}

/** Date -> holiday name, for greying out calendar cells and naming them. */
export function holidayNameMap(calendar: LeaveCalendarData): Map<string, string> {
  return new Map((calendar.holidays || []).map((holiday) => [holiday.date, holiday.name] as const))
}

export function holidaySetFrom(calendar: LeaveCalendarData): HolidaySet {
  return new Set((calendar.holidays || []).map((holiday) => holiday.date))
}

export type LeaveRelieverDebug = {
  reason?: string
  user_id?: string
  requester_profile_id?: string
  requester_department?: string | null
  requester_department_id?: string | null
  resolution_source?: string
  total_profiles_scanned?: number
  matched_profiles?: number
  options_count?: number
}

/** Loose shape covering all leave API JSON responses */
type LeaveApiPayload = {
  data?: unknown
  history?: unknown
  error?: string
  balances?: unknown
  reliever_options?: unknown
  reliever_debug?: unknown
}

export type LeaveReviewHistoryItem = {
  id: string
  leave_request_id: string
  status?: string | null
  comments?: string | null
  approved_at?: string | null
  stage_code?: string | null
  request?: LeaveRequest | null
}

export async function fetchLeaveData(currentUserId: string) {
  const [requestRes, queueRes, typesRes, relieversRes, calendarRes] = await Promise.all([
    fetch("/api/hr/leave/requests?limit=100").catch(() => null),
    fetch("/api/hr/leave/queue").catch(() => null),
    fetch("/api/hr/leave/types").catch(() => null),
    fetch("/api/hr/leave/relievers").catch(() => null),
    fetch("/api/hr/leave/calendar").catch(() => null),
  ])

  const parseJson = async (res: Response | null): Promise<LeaveApiPayload> => (res ? res.json().catch(() => ({})) : {})

  const [requestPayload, queuePayload, typesPayload, relieversPayload, calendarPayload] = await Promise.all([
    parseJson(requestRes),
    parseJson(queueRes),
    parseJson(typesRes),
    parseJson(relieversRes),
    parseJson(calendarRes),
  ])

  // Log per-endpoint failures but do NOT throw — partial data is still useful
  const warnings: string[] = []
  if (!requestRes?.ok) warnings.push(`requests: ${requestPayload.error || requestRes?.statusText || "network error"}`)
  if (!queueRes?.ok) warnings.push(`queue: ${queuePayload.error || queueRes?.statusText || "network error"}`)
  if (!typesRes?.ok) warnings.push(`types: ${typesPayload.error || typesRes?.statusText || "network error"}`)
  if (!relieversRes?.ok)
    warnings.push(`relievers: ${relieversPayload.error || relieversRes?.statusText || "network error"}`)
  if (!calendarRes?.ok)
    warnings.push(`calendar: ${calendarPayload.error || calendarRes?.statusText || "network error"}`)

  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[leave-data] Partial fetch warnings: ${warnings.join(" | ")}`)
  }

  // Only throw if the critical requests endpoint fails — everything else degrades gracefully
  if (!requestRes?.ok) {
    throw new Error(`Leave requests fetch failed: ${requestPayload.error || requestRes?.statusText || "network error"}`)
  }

  const reqData = Array.isArray(requestPayload.data) ? requestPayload.data : []
  const ownedRequests = reqData.filter((row: LeaveRequest) => row.user_id === currentUserId)

  return {
    requests: ownedRequests as LeaveRequest[],
    balances: (Array.isArray(requestPayload.balances) ? requestPayload.balances : []) as LeaveBalance[],
    approverQueue: (queueRes?.ok && Array.isArray(queuePayload.data) ? queuePayload.data : []) as LeaveRequest[],
    pendingReviewHistory: (queueRes?.ok && Array.isArray(queuePayload.history)
      ? queuePayload.history
      : []) as LeaveReviewHistoryItem[],
    leaveTypes: (typesRes?.ok && Array.isArray(typesPayload.data) ? typesPayload.data : []) as LeaveType[],
    relieverOptions: (relieversRes?.ok && Array.isArray(relieversPayload.data)
      ? relieversPayload.data
      : Array.isArray(requestPayload.reliever_options)
        ? requestPayload.reliever_options
        : []) as { value: string; label: string }[],
    relieverDebug: (relieversPayload && typeof relieversPayload === "object" && "debug" in relieversPayload
      ? (relieversPayload as { debug?: LeaveRelieverDebug }).debug || null
      : requestPayload && typeof requestPayload === "object" && "reliever_debug" in requestPayload
        ? ((requestPayload as { reliever_debug?: LeaveRelieverDebug }).reliever_debug ?? null)
        : null) as LeaveRelieverDebug | null,
    leaveCalendar: (calendarRes?.ok && calendarPayload.data
      ? calendarPayload.data
      : { blackout_months: [12, 1], department_booked_dates: [], holidays: [] }) as LeaveCalendarData,
  }
}

export function addDays(startDate: string, days: number) {
  if (!startDate || days <= 0) return { endDate: "", resumeDate: "" }
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + days - 1)
  const resume = new Date(end)
  resume.setUTCDate(resume.getUTCDate() + 1)

  return {
    endDate: toLocalISODate(end),
    resumeDate: toLocalISODate(resume),
  }
}

export type LeaveSegment = { start_date: string; end_date: string }

/**
 * Inclusive working-day count between two ISO dates. Weekends never count, and
 * neither do public holidays — pass the set from `holidaySetFrom` so the number
 * shown matches what the server will deduct.
 */
export function countWeekdays(startIso: string, endIso: string, holidays: HolidaySet = NO_HOLIDAYS): number {
  if (!startIso || !endIso) return 0
  return countLeaveDays(startIso, endIso, holidays)
}

/** End date such that startIso..end contains exactly `workingDayCount` working days. */
export function endDateForWeekdaySpan(
  startIso: string,
  workingDayCount: number,
  holidays: HolidaySet = NO_HOLIDAYS
): string {
  if (!startIso || workingDayCount <= 0) return ""
  let cursor = firstWorkingDayOnOrAfter(startIso, holidays)
  for (let counted = 1; counted < workingDayCount; counted++) {
    cursor = nextWorkingDayAfter(cursor, holidays)
  }
  return cursor
}

export function segmentsTotalDays(segments: LeaveSegment[], holidays: HolidaySet = NO_HOLIDAYS): number {
  return segmentsWorkingDays(segments, holidays)
}

/** Working days, weekend days and named holidays across the whole request. */
export function segmentsBreakdown(segments: LeaveSegment[], holidays: HolidaySet = NO_HOLIDAYS): LeaveRangeBreakdown {
  return describeSegments(segments, holidays)
}

/** Client-side estimate of end/resume date across all committed segments (server is authoritative). */
export function segmentsPreview(segments: LeaveSegment[], holidays: HolidaySet = NO_HOLIDAYS) {
  if (!segments.length) return { endDate: "", resumeDate: "" }
  const endDate = segments.reduce((latest, segment) => (segment.end_date > latest ? segment.end_date : latest), segments[0].end_date)
  return { endDate, resumeDate: nextWorkingDayAfter(endDate, holidays) }
}

export function getTodayLocalIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
