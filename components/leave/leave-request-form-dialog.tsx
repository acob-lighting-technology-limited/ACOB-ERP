"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { CalendarDays, Plus, X } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import type { LeaveType, LeaveBalance } from "@/app/(app)/leave/page"
import {
  countWeekdays,
  getTodayLocalIsoDate,
  holidayNameMap,
  holidaySetFrom,
  segmentsBreakdown,
  segmentsTotalDays,
} from "@/components/leave/leave-data"
import type { LeaveCalendarData, LeaveRelieverDebug, LeaveSegment } from "@/components/leave/leave-data"
import { isWeekend as isWeekendIso, trimRangeToWorkingDays, type HolidaySet } from "@/lib/hr/leave-days"

function prettyEligibility(status: string) {
  if (status === "eligible") return "Eligible"
  if (status === "missing_evidence") return "Missing Evidence"
  return "Not Eligible"
}

function prettyDocName(name: string) {
  return name.replaceAll("_", " ")
}

export interface LeaveRequestFormData {
  leave_type_id: string
  segments: LeaveSegment[]
  emergency_override: boolean
  reason: string
  reliever_identifier: string
  handover_file: File | null
  handover_checklist_url: string | null
  attachment: File | null
}

interface LeaveRequestFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRequestId: string | null
  formData: LeaveRequestFormData
  setFormData: React.Dispatch<React.SetStateAction<LeaveRequestFormData>>
  leaveTypes: LeaveType[]
  relieverOptions: { value: string; label: string }[]
  relieverDebug: LeaveRelieverDebug | null
  selectedLeaveType: LeaveType | undefined
  selectedBalance: LeaveBalance | undefined
  requiresAttachmentOnCreate: boolean
  availableDays: number
  availableDaysByType: Record<string, number>
  approvalRouteStages: Array<{
    stage_code: string
    role_code: string
    label: string
  }>
  preview: { endDate: string; resumeDate: string }
  leaveCalendar: LeaveCalendarData
  canSubmit: boolean
  submitting: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
}

function toIsoLocalDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseIsoLocalDate(value: string) {
  return new Date(`${value}T00:00:00`)
}

function formatSegmentLabel(segment: LeaveSegment, holidays: HolidaySet) {
  const days = countWeekdays(segment.start_date, segment.end_date, holidays)
  const range = segment.start_date === segment.end_date ? segment.start_date : `${segment.start_date} to ${segment.end_date}`
  return `${range} (${days} day${days === 1 ? "" : "s"} deducted)`
}

export function LeaveRequestFormDialog({
  open,
  onOpenChange,
  editingRequestId,
  formData,
  setFormData,
  leaveTypes,
  relieverOptions,
  relieverDebug,
  selectedLeaveType,
  selectedBalance: _selectedBalance,
  requiresAttachmentOnCreate,
  availableDays,
  availableDaysByType,
  approvalRouteStages,
  preview,
  leaveCalendar,
  canSubmit,
  submitting,
  onSubmit,
}: LeaveRequestFormDialogProps) {
  const [pendingRangeStartIso, setPendingRangeStartIso] = useState<string | null>(null)
  const [pendingRangeEndIso, setPendingRangeEndIso] = useState<string | null>(null)
  const todayIso = getTodayLocalIsoDate()
  const holidaySet = useMemo(() => holidaySetFrom(leaveCalendar), [leaveCalendar])
  const holidayNames = useMemo(() => holidayNameMap(leaveCalendar), [leaveCalendar])
  const blackoutMonthSet = new Set((leaveCalendar.blackout_months || [12, 1]).map((month) => Number(month)))
  const bookedMap = new Map((leaveCalendar.department_booked_dates || []).map((entry) => [entry.date, entry] as const))
  const policyMaxDays = Number(selectedLeaveType?.max_days || 0)
  const currentAvailableDays = Math.max(0, Number(availableDays || 0))
  const maxDaysAllowed =
    policyMaxDays > 0 ? Math.max(0, Math.min(policyMaxDays, currentAvailableDays)) : currentAvailableDays
  const committedDays = segmentsTotalDays(formData.segments, holidaySet)
  const committedBreakdown = segmentsBreakdown(formData.segments, holidaySet)
  const remainingAllowed = Math.max(0, maxDaysAllowed - committedDays)

  const committedDateSet = useMemo(() => {
    const set = new Set<string>()
    for (const segment of formData.segments) {
      let current = parseIsoLocalDate(segment.start_date)
      const end = parseIsoLocalDate(segment.end_date)
      while (current <= end) {
        set.add(toIsoLocalDate(current))
        current = new Date(current.getTime() + 24 * 60 * 60 * 1000)
      }
    }
    return set
  }, [formData.segments])

  const selectedRange = useMemo(() => {
    if (!pendingRangeStartIso) return undefined
    return {
      from: parseIsoLocalDate(pendingRangeStartIso),
      to: pendingRangeEndIso ? parseIsoLocalDate(pendingRangeEndIso) : undefined,
    }
  }, [pendingRangeStartIso, pendingRangeEndIso])

  const isBlackoutDate = (date: Date) => blackoutMonthSet.has(date.getMonth() + 1)
  const isWeekendDate = (date: Date) => isWeekendIso(toIsoLocalDate(date))
  const isHolidayDate = (date: Date) => holidaySet.has(toIsoLocalDate(date))
  const holidayLabel = (date: Date) => holidayNames.get(toIsoLocalDate(date)) || null
  const isPastDate = (date: Date) => toIsoLocalDate(date) < todayIso
  const isAlreadyCommitted = (date: Date) => committedDateSet.has(toIsoLocalDate(date))
  const getBookingForDate = (date: Date) => bookedMap.get(toIsoLocalDate(date))
  const hasApprovedDepartmentBooking = (date: Date) => {
    const booking = getBookingForDate(date)
    if (!booking) return false
    return (
      booking.status === "approved" ||
      booking.status === "both" ||
      Boolean(booking.approved_employees && booking.approved_employees.length > 0)
    )
  }
  const hasPendingDepartmentBooking = (date: Date) => {
    const booking = getBookingForDate(date)
    if (!booking) return false
    if (hasApprovedDepartmentBooking(date)) return false
    return (
      booking.status === "pending" ||
      Boolean(booking.pending_employees && booking.pending_employees.length > 0) ||
      !booking.status
    )
  }
  const exceedsLeaveTypeMax = (date: Date) => {
    if (!pendingRangeStartIso || !remainingAllowed) return false
    const clickedIso = toIsoLocalDate(date)
    if (clickedIso <= pendingRangeStartIso) return false
    return countWeekdays(pendingRangeStartIso, clickedIso, holidaySet) > remainingAllowed
  }
  // Weekends and public holidays are not deductible, so they can never be an
  // endpoint of a range. A range may still *span* them — react-day-picker only
  // blocks disabled days from being clicked, not from falling inside a range.
  const disableDay = (date: Date) =>
    (remainingAllowed <= 0 && !pendingRangeStartIso) ||
    isWeekendDate(date) ||
    isHolidayDate(date) ||
    isPastDate(date) ||
    isAlreadyCommitted(date) ||
    (!formData.emergency_override && isBlackoutDate(date)) ||
    exceedsLeaveTypeMax(date)

  function commitPendingRange() {
    if (!pendingRangeStartIso) return
    const endIso = pendingRangeEndIso || pendingRangeStartIso
    // Store the working-day range, not the raw selection: a Mon-Sun drag is
    // saved as Mon-Fri so the resumption date reads as the following Monday.
    const trimmed = trimRangeToWorkingDays(pendingRangeStartIso, endIso, holidaySet)
    const span = trimmed ? countWeekdays(trimmed.start_date, trimmed.end_date, holidaySet) : 0
    if (!trimmed || span <= 0 || span > remainingAllowed) {
      setPendingRangeStartIso(null)
      setPendingRangeEndIso(null)
      return
    }
    setFormData((prev) => ({
      ...prev,
      segments: [...prev.segments, trimmed],
    }))
    setPendingRangeStartIso(null)
    setPendingRangeEndIso(null)
  }

  function removeSegment(index: number) {
    setFormData((prev) => ({ ...prev, segments: prev.segments.filter((_, i) => i !== index) }))
  }

  // Explains the selection before it is added: how many days it will actually
  // cost, and which public holidays came along free.
  const pendingSelectionSummary = (() => {
    if (!pendingRangeStartIso) return ""
    const endIso = pendingRangeEndIso || pendingRangeStartIso
    const range = endIso === pendingRangeStartIso ? pendingRangeStartIso : `${pendingRangeStartIso} to ${endIso}`
    const breakdown = segmentsBreakdown([{ start_date: pendingRangeStartIso, end_date: endIso }], holidaySet)
    const parts = [`${breakdown.workingDays} day${breakdown.workingDays === 1 ? "" : "s"} deducted`]
    if (breakdown.weekendDays > 0) parts.push(`${breakdown.weekendDays} weekend day${breakdown.weekendDays === 1 ? "" : "s"} free`)
    for (const holidayIso of breakdown.holidayDates) {
      parts.push(`${holidayNames.get(holidayIso) || "public holiday"} free`)
    }
    return `Selected: ${range} — ${parts.join(", ")}`
  })()

  const lastCommittedDate = formData.segments.length
    ? [...formData.segments].sort((a, b) => a.end_date.localeCompare(b.end_date)).slice(-1)[0]?.end_date
    : null
  const selectedDateBooking = lastCommittedDate ? bookedMap.get(lastCommittedDate) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-[560px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {editingRequestId ? "Edit Leave Request" : "Submit Leave Request"}
            <ItemInfoButton
              title="Leave request workflow guide"
              summary="Leave requests move through approval stages, so the requester, reliever, and approvers all need enough context from the start."
              details={[
                {
                  label: "What happens after submission",
                  value:
                    "The request goes into approval flow, starting with the reliever and then moving through the relevant approvers until it is approved or rejected.",
                },
                {
                  label: "What approvers care about",
                  value:
                    "They need to know the leave type, exact dates, business impact, reliever coverage, and whether the handover is strong enough.",
                },
                {
                  label: "How to avoid rework",
                  value:
                    "Choose the right leave type, give a real reason, set a reliever, and write a useful handover note so the next person can decide quickly.",
                },
              ]}
            />
          </DialogTitle>
          <DialogDescription>
            Approval route for your role:{" "}
            {approvalRouteStages.length > 0
              ? approvalRouteStages.map((stage) => stage.label).join(" -> ")
              : "Not available"}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label>Leave Type</Label>
            <Select
              value={formData.leave_type_id}
              onValueChange={(value) => {
                setPendingRangeStartIso(null)
                setPendingRangeEndIso(null)
                setFormData((prev) => ({ ...prev, leave_type_id: value, segments: [] }))
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select leave type" />
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((leaveType) => {
                  const daysLeft = Math.max(0, Number(availableDaysByType[leaveType.id] ?? 0))
                  const disabled = leaveType.eligibility_status === "not_eligible" || daysLeft <= 0
                  return (
                    <SelectItem key={leaveType.id} value={leaveType.id} disabled={disabled}>
                      {leaveType.name} ({daysLeft} day{daysLeft === 1 ? "" : "s"} left, max {leaveType.max_days}) -{" "}
                      {prettyEligibility(leaveType.eligibility_status)}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">Available balance: {availableDays} days</p>
            {selectedLeaveType?.eligibility_reason && (
              <p className="text-muted-foreground text-xs">{selectedLeaveType.eligibility_reason}</p>
            )}
            {selectedLeaveType?.required_documents?.length ? (
              <p className="text-muted-foreground text-xs">
                Required documents: {selectedLeaveType.required_documents.map(prettyDocName).join(", ")}
              </p>
            ) : null}
          </div>

          {formData.leave_type_id ? (
            <>
              <div className="space-y-2">
                <Label>Pick Date Range(s) — weekends and public holidays don&apos;t count toward your balance</Label>
                <div className="rounded-md border p-3">
                  <Calendar
                    mode="range"
                    selected={selectedRange}
                    onSelect={(range) => {
                      if (!range?.from) {
                        setPendingRangeStartIso(null)
                        setPendingRangeEndIso(null)
                        return
                      }
                      setPendingRangeStartIso(toIsoLocalDate(range.from))
                      setPendingRangeEndIso(range.to ? toIsoLocalDate(range.to) : null)
                    }}
                    showOutsideDays
                    disabled={(date) => !formData.leave_type_id || disableDay(date)}
                    modifiers={{
                      blackout: (date) => isBlackoutDate(date),
                      holiday: (date) => isHolidayDate(date),
                      department_approved: (date) => hasApprovedDepartmentBooking(date),
                      department_pending: (date) => hasPendingDepartmentBooking(date),
                      committed: (date) => isAlreadyCommitted(date),
                      selected_range: selectedRange || undefined,
                    }}
                    modifiersClassNames={{
                      blackout: "line-through opacity-40",
                      holiday: "bg-violet-100 text-violet-900 font-medium dark:bg-violet-950/60 dark:text-violet-300",
                      department_approved: "bg-red-100 text-red-900 font-medium dark:bg-red-950/60 dark:text-red-300",
                      department_pending:
                        "bg-amber-100 text-amber-900 font-medium dark:bg-amber-950/60 dark:text-amber-300",
                      committed: "bg-emerald-100 text-emerald-900 font-medium dark:bg-emerald-950/60 dark:text-emerald-300",
                      selected_range: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300",
                    }}
                    className="mx-auto"
                  />
                  <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded border border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60" />
                      Added to request
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded border border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/60" />
                      Booked (Approved)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded border border-amber-300 bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60" />
                      Booked (Pending)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded border border-violet-300 bg-violet-100 dark:border-violet-800 dark:bg-violet-950/60" />
                      Public holiday (free)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="border-border bg-muted h-3 w-3 rounded border opacity-60" />
                      Dec/Jan blocked
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">
                      {pendingRangeStartIso ? pendingSelectionSummary : "Click a start date, then an end date."}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!pendingRangeStartIso}
                      onClick={commitPendingRange}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add range
                    </Button>
                  </div>

                  <div className="bg-muted/40 mt-3 flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="space-y-0.5">
                      <Label htmlFor="calendar-emergency-override" className="cursor-pointer text-xs font-medium">
                        Emergency leave override
                      </Label>
                      <p className="text-muted-foreground text-[11px]">
                        Allow selecting dates during the Dec/Jan blocked period
                      </p>
                    </div>
                    <Switch
                      id="calendar-emergency-override"
                      checked={formData.emergency_override}
                      onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, emergency_override: checked }))}
                      aria-label="Emergency leave override"
                    />
                  </div>

                  {selectedDateBooking ? (
                    <div className="bg-muted/30 mt-2.5 space-y-0.5 rounded-md border p-2 text-xs">
                      {selectedDateBooking.approved_employees && selectedDateBooking.approved_employees.length > 0 ? (
                        <p className="text-red-700 dark:text-red-400">
                          <span className="font-semibold">Approved leave:</span>{" "}
                          {selectedDateBooking.approved_employees.join(", ")}
                        </p>
                      ) : null}
                      {selectedDateBooking.pending_employees && selectedDateBooking.pending_employees.length > 0 ? (
                        <p className="text-amber-700 dark:text-amber-400">
                          <span className="font-semibold">Pending review:</span>{" "}
                          {selectedDateBooking.pending_employees.join(", ")}
                        </p>
                      ) : null}
                      {!selectedDateBooking.approved_employees?.length &&
                      !selectedDateBooking.pending_employees?.length ? (
                        <p className="text-amber-700 dark:text-amber-400">
                          {selectedDateBooking.count} teammate(s) already booked this date:{" "}
                          {selectedDateBooking.employees.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  Date Ranges Added ({committedDays} day{committedDays === 1 ? "" : "s"} deducted)
                </Label>
                {committedBreakdown.holidayDates.length > 0 || committedBreakdown.weekendDays > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {committedBreakdown.calendarDays} calendar day
                    {committedBreakdown.calendarDays === 1 ? "" : "s"} selected.{" "}
                    {committedBreakdown.weekendDays > 0
                      ? `${committedBreakdown.weekendDays} weekend day${committedBreakdown.weekendDays === 1 ? "" : "s"}`
                      : ""}
                    {committedBreakdown.weekendDays > 0 && committedBreakdown.holidayDates.length > 0 ? " and " : ""}
                    {committedBreakdown.holidayDates.length > 0
                      ? `${committedBreakdown.holidayDates.length} public holiday${committedBreakdown.holidayDates.length === 1 ? "" : "s"} (${committedBreakdown.holidayDates
                          .map((iso) => holidayNames.get(iso) || iso)
                          .join(", ")})`
                      : ""}{" "}
                    not deducted.
                  </p>
                ) : null}
                {formData.segments.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                    No date ranges added yet. Pick dates on the calendar above and click &quot;Add range&quot;. Add
                    more than one range for disjoint dates (e.g. 1st-3rd and 5th-7th).
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {formData.segments.map((segment, index) => (
                      <li
                        key={`${segment.start_date}-${segment.end_date}-${index}`}
                        className="bg-muted/40 flex items-center justify-between rounded-md border px-3 py-1.5 text-xs"
                      >
                        <span>{formatSegmentLabel(segment, holidaySet)}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => removeSegment(index)}
                          aria-label="Remove date range"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-muted/40 rounded-md border p-3 text-sm">
                <p>
                  Computed End Date: <span className="font-medium">{preview.endDate || "-"}</span>
                </p>
                <p>
                  Computed Resume Date: <span className="font-medium">{preview.resumeDate || "-"}</span>
                </p>
              </div>
            </>
          ) : (
            <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
              Select a leave type to show date picker and duration controls.
            </div>
          )}

          <div className="space-y-2">
            <Label>
              Reliever <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              value={formData.reliever_identifier}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, reliever_identifier: value }))}
              options={relieverOptions}
              placeholder="Select reliever from your department"
              searchPlaceholder="Search your department..."
            />
          </div>

          <div className="space-y-2">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              value={formData.reason}
              onChange={(event) => setFormData((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Provide leave reason"
            />
          </div>

          <div className="space-y-2">
            <Label>
              Handover Document <span className="text-destructive">*</span>
            </Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              required={!formData.handover_checklist_url}
              onChange={(event) => setFormData((prev) => ({ ...prev, handover_file: event.target.files?.[0] || null }))}
            />
            <p className="text-muted-foreground text-xs">
              {formData.handover_file
                ? `${formData.handover_file.name} (${Math.max(1, Math.round(formData.handover_file.size / 1024))} KB)`
                : formData.handover_checklist_url
                  ? "A handover document is already attached. Upload a new file to replace it."
                  : "Upload your formal handover document (PDF, Word, or Excel) detailing coverage."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Attachment {requiresAttachmentOnCreate ? "(Required)" : "(Optional)"}</Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              required={requiresAttachmentOnCreate}
              onChange={(event) => setFormData((prev) => ({ ...prev, attachment: event.target.files?.[0] || null }))}
            />
            <p className="text-muted-foreground text-xs">
              {requiresAttachmentOnCreate
                ? "This leave type requires evidence. Upload is compulsory before submit."
                : "Upload a supporting file to the leave SharePoint library."}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting
                ? editingRequestId
                  ? "Saving..."
                  : "Submitting..."
                : editingRequestId
                  ? "Save Changes"
                  : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
