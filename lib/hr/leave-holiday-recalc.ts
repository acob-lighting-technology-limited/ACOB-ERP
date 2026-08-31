/**
 * Re-prices leave that was booked before a public holiday was declared.
 *
 * When HR adds a holiday that lands inside leave someone has already booked,
 * the dates stay exactly as approved and the day is handed back instead: a
 * request that cost 5 days becomes 4, and because entitlement is derived from
 * `leave_requests.days_count` (see lib/hr/leave-entitlement.ts) that refund
 * reaches the employee's balance with no separate balance write.
 *
 * Deliberately NOT done here: pushing the end date out to preserve the original
 * day count. That would silently move an approved return date, invalidating the
 * reliever's coverage and the roster after everyone had already signed off.
 *
 * Only leave that has not started yet is touched. Leave in progress or already
 * taken is left exactly as it was — the days were lived, and rewriting history
 * would desync attendance records that have already been scored.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"
import {
  addIsoDays,
  countLeaveDays,
  nextWorkingDayAfter,
  trimRangeToWorkingDays,
  type HolidaySet,
  type LeaveSegmentInput,
} from "@/lib/hr/leave-days"
import { getHolidaySet, getLeaveRequestSegments, notifyUsers, syncAttendanceForApprovedLeave } from "@/lib/hr/leave-workflow"

const log = logger("leave-holiday-recalc")

/** Statuses whose days_count still counts against entitlement. */
const REPRICEABLE_STATUSES = ["pending", "pending_evidence", "approved"] as const

type LeaveRequestRow = {
  id: string
  user_id: string
  status: string
  start_date: string
  end_date: string
  resume_date: string | null
  days_count: number | null
}

export type LeaveRepriceOutcome = {
  leaveRequestId: string
  userId: string
  previousDays: number
  newDays: number
  previousEndDate: string
  newEndDate: string
}

export type LeaveRepriceResult = {
  /** Requests whose day count or end date changed. */
  updated: LeaveRepriceOutcome[]
  /**
   * Requests where every selected day became a holiday, leaving nothing to
   * deduct. These are left untouched on purpose — cancelling somebody's leave
   * automatically is HR's call, not the system's.
   */
  needsReview: { leaveRequestId: string; userId: string }[]
}

/**
 * Re-prices every not-yet-started request overlapping `[fromDate, toDate]`.
 * Call after adding or removing holidays; it reads the calendar fresh, so it
 * corrects in both directions (a removed holiday re-deducts the day).
 */
export async function repriceLeaveForHolidayChange(
  supabase: SupabaseClient,
  params: { fromDate: string; toDate: string; actorId?: string; reason?: string }
): Promise<LeaveRepriceResult> {
  const result: LeaveRepriceResult = { updated: [], needsReview: [] }
  const today = toLocalISODate()

  // Only future leave. A request starting today has already begun as far as
  // attendance is concerned.
  const earliestStart = params.fromDate > today ? params.fromDate : today

  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, user_id, status, start_date, end_date, resume_date, days_count")
    .in("status", REPRICEABLE_STATUSES as unknown as string[])
    .gt("start_date", today)
    .lte("start_date", params.toDate)
    .gte("end_date", earliestStart)

  if (error) {
    log.error({ err: error, ...params }, "Failed to load leave requests for holiday reprice")
    return result
  }

  const requests = (data || []) as LeaveRequestRow[]
  if (!requests.length) return result

  // One calendar fetch covering every affected request, plus a month of
  // lookahead for the resumption-date walk.
  const spanStart = requests.reduce((min, row) => (row.start_date < min ? row.start_date : min), requests[0].start_date)
  const spanEnd = requests.reduce((max, row) => (row.end_date > max ? row.end_date : max), requests[0].end_date)
  const lookaheadEnd = addIsoDays(spanEnd, 30)

  let holidays: HolidaySet
  try {
    holidays = await getHolidaySet(supabase, null, spanStart, lookaheadEnd)
  } catch (holidayError) {
    log.error({ err: String(holidayError) }, "Failed to load holiday calendar for reprice")
    return result
  }

  for (const request of requests) {
    try {
      const outcome = await repriceSingleRequest(supabase, request, holidays, params)
      if (outcome === "needs_review") {
        result.needsReview.push({ leaveRequestId: request.id, userId: request.user_id })
      } else if (outcome) {
        result.updated.push(outcome)
      }
    } catch (repriceError) {
      log.error({ err: String(repriceError), leaveRequestId: request.id }, "Failed to reprice leave request")
    }
  }

  return result
}

async function repriceSingleRequest(
  supabase: SupabaseClient,
  request: LeaveRequestRow,
  holidays: HolidaySet,
  params: { actorId?: string; reason?: string }
): Promise<LeaveRepriceOutcome | "needs_review" | null> {
  const storedSegments = await getLeaveRequestSegments(supabase, request.id, request.start_date, request.end_date)

  const trimmed = storedSegments
    .map((segment: LeaveSegmentInput) => trimRangeToWorkingDays(segment.start_date, segment.end_date, holidays))
    .filter((segment): segment is { start_date: string; end_date: string } => segment !== null)

  if (trimmed.length === 0) return "needs_review"

  const resolved = trimmed.map((segment, index) => ({
    start_date: segment.start_date,
    end_date: segment.end_date,
    days_count: countLeaveDays(segment.start_date, segment.end_date, holidays),
    segment_order: index + 1,
  }))

  const newDays = resolved.reduce((sum, segment) => sum + segment.days_count, 0)
  if (newDays <= 0) return "needs_review"

  const newStartDate = resolved[0].start_date
  const newEndDate = resolved[resolved.length - 1].end_date
  const newResumeDate = nextWorkingDayAfter(newEndDate, holidays)
  const previousDays = Number(request.days_count ?? 0)

  const unchanged =
    newDays === previousDays &&
    newStartDate === request.start_date &&
    newEndDate === request.end_date &&
    newResumeDate === (request.resume_date || newResumeDate)
  if (unchanged) return null

  const { error: updateError } = await supabase
    .from("leave_requests")
    .update({
      start_date: newStartDate,
      end_date: newEndDate,
      resume_date: newResumeDate,
      days_count: newDays,
    })
    .eq("id", request.id)

  if (updateError) {
    log.error({ err: updateError, leaveRequestId: request.id }, "Failed to update repriced leave request")
    return null
  }

  await supabase.from("leave_request_segments").delete().eq("leave_request_id", request.id)
  const { error: segmentsError } = await supabase.from("leave_request_segments").insert(
    resolved.map((segment) => ({
      leave_request_id: request.id,
      start_date: segment.start_date,
      end_date: segment.end_date,
      days_count: segment.days_count,
      segment_order: segment.segment_order,
    }))
  )
  if (segmentsError) {
    log.error({ err: segmentsError, leaveRequestId: request.id }, "Failed to rewrite repriced leave segments")
  }

  // Approved leave already wrote on_leave attendance rows across the old range;
  // clear and re-apply so a pulled-back end date does not leave stale days.
  if (request.status === "approved") {
    await syncAttendanceForApprovedLeave(
      supabase,
      request.user_id,
      [{ start_date: request.start_date, end_date: request.end_date }],
      "clear"
    )
    await syncAttendanceForApprovedLeave(supabase, request.user_id, resolved, "set")
  }

  const refunded = previousDays - newDays
  if (refunded !== 0) {
    const isRefund = refunded > 0
    const magnitude = Math.abs(refunded)
    await notifyUsers(supabase, {
      userIds: [request.user_id],
      actorId: params.actorId,
      entityId: request.id,
      title: isRefund ? "Leave days returned to your balance" : "Leave days adjusted",
      message: isRefund
        ? `A public holiday now falls inside your approved leave (${newStartDate} to ${newEndDate}), so ${magnitude} day(s) went back to your balance. Your dates and resumption date are unchanged unless shown below.`
        : `A public holiday inside your leave (${newStartDate} to ${newEndDate}) was removed, so ${magnitude} day(s) were deducted again. Your dates are unchanged.`,
      linkUrl: "/leave",
      details: [
        { label: "Period", value: `${newStartDate} to ${newEndDate}` },
        { label: "Days deducted", value: `${previousDays} -> ${newDays}` },
        { label: "Resumption Date", value: newResumeDate },
      ],
    })
  }

  return {
    leaveRequestId: request.id,
    userId: request.user_id,
    previousDays,
    newDays,
    previousEndDate: request.end_date,
    newEndDate,
  }
}
