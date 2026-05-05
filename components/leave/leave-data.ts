import type { LeaveBalance, LeaveRequest, LeaveType } from "@/app/(app)/leave/page"

export type LeaveCalendarData = {
  blackout_months: number[]
  department_booked_dates: Array<{
    date: string
    count: number
    employees: string[]
  }>
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
      : { blackout_months: [12, 1], department_booked_dates: [] }) as LeaveCalendarData,
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
    endDate: end.toISOString().slice(0, 10),
    resumeDate: resume.toISOString().slice(0, 10),
  }
}

export function getTodayLocalIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
