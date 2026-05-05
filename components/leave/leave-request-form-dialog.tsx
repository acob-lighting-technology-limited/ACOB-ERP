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
import { CalendarDays } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import type { LeaveType, LeaveBalance } from "@/app/(app)/leave/page"
import { getTodayLocalIsoDate } from "@/components/leave/leave-data"
import type { LeaveCalendarData, LeaveRelieverDebug } from "@/components/leave/leave-data"

function prettyEligibility(status: string) {
  if (status === "eligible") return "Eligible"
  if (status === "missing_evidence") return "Missing Evidence"
  return "Not Eligible"
}

function prettyDocName(name: string) {
  return name.replaceAll("_", " ")
}

interface LeaveRequestFormData {
  leave_type_id: string
  start_date: string
  days_count: number
  emergency_override: boolean
  reason: string
  reliever_identifier: string
  handover_note: string
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

function daysInclusive(fromIso: string, toIso: string) {
  const from = parseIsoLocalDate(fromIso).getTime()
  const to = parseIsoLocalDate(toIso).getTime()
  return Math.floor((to - from) / (1000 * 60 * 60 * 24)) + 1
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
  const [lastClickedIso, setLastClickedIso] = useState<string | null>(null)
  const todayIso = getTodayLocalIsoDate()
  const blackoutMonthSet = new Set((leaveCalendar.blackout_months || [12, 1]).map((month) => Number(month)))
  const bookedMap = new Map((leaveCalendar.department_booked_dates || []).map((entry) => [entry.date, entry] as const))
  const policyMaxDays = Number(selectedLeaveType?.max_days || 0)
  const currentAvailableDays = Math.max(0, Number(availableDays || 0))
  const maxDaysAllowed =
    policyMaxDays > 0 ? Math.max(0, Math.min(policyMaxDays, currentAvailableDays)) : currentAvailableDays
  const selectedRange = useMemo(() => {
    if (pendingRangeStartIso) {
      return {
        from: parseIsoLocalDate(pendingRangeStartIso),
        to: undefined,
      }
    }
    if (!formData.start_date || !preview.endDate) return undefined
    return {
      from: parseIsoLocalDate(formData.start_date),
      to: parseIsoLocalDate(preview.endDate),
    }
  }, [formData.start_date, pendingRangeStartIso, preview.endDate])

  const isBlackoutDate = (date: Date) => blackoutMonthSet.has(date.getMonth() + 1)
  const isPastDate = (date: Date) => toIsoLocalDate(date) < todayIso
  const hasDepartmentBooking = (date: Date) => bookedMap.has(toIsoLocalDate(date))
  const exceedsLeaveTypeMax = (date: Date) => {
    if (!pendingRangeStartIso || !maxDaysAllowed) return false
    const clickedIso = toIsoLocalDate(date)
    if (clickedIso <= pendingRangeStartIso) return false
    return daysInclusive(pendingRangeStartIso, clickedIso) > maxDaysAllowed
  }
  const disableDay = (date: Date) =>
    maxDaysAllowed <= 0 ||
    isPastDate(date) ||
    (!formData.emergency_override && isBlackoutDate(date)) ||
    exceedsLeaveTypeMax(date)

  const selectedDateBooking = formData.start_date ? bookedMap.get(formData.start_date) : null

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
              onValueChange={(value) =>
                setFormData((prev) => {
                  const selectedAvailable = Math.max(0, Number(availableDaysByType[value] ?? 0))
                  const nextDays =
                    selectedAvailable > 0 ? Math.min(Math.max(1, Number(prev.days_count) || 1), selectedAvailable) : 0
                  return { ...prev, leave_type_id: value, days_count: nextDays }
                })
              }
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
                <Label>Pick Start Date (Calendar)</Label>
                <div className="rounded-md border p-3">
                  <Calendar
                    mode="range"
                    selected={selectedRange}
                    onDayClick={(day) => {
                      const clickedIso = toIsoLocalDate(day)
                      setLastClickedIso(clickedIso)
                    }}
                    onSelect={(range) => {
                      const hasCommittedRange =
                        !pendingRangeStartIso && Boolean(formData.start_date) && Boolean(preview.endDate)

                      // UX rule: once a range is already selected, next click should start a new range
                      // from the clicked day instead of extending the old one.
                      if (hasCommittedRange && lastClickedIso) {
                        setPendingRangeStartIso(lastClickedIso)
                        setFormData((prev) => ({
                          ...prev,
                          start_date: lastClickedIso,
                          days_count: 1,
                        }))
                        setLastClickedIso(null)
                        return
                      }

                      if (!range?.from) {
                        setPendingRangeStartIso(null)
                        setFormData((prev) => ({ ...prev, start_date: "" }))
                        setLastClickedIso(null)
                        return
                      }

                      const fromIso = toIsoLocalDate(range.from)
                      if (!range.to) {
                        if (maxDaysAllowed <= 0) {
                          setPendingRangeStartIso(null)
                          setFormData((prev) => ({
                            ...prev,
                            start_date: "",
                            days_count: 0,
                          }))
                          setLastClickedIso(null)
                          return
                        }
                        setPendingRangeStartIso(fromIso)
                        setFormData((prev) => ({
                          ...prev,
                          start_date: fromIso,
                          days_count: 1,
                        }))
                        setLastClickedIso(null)
                        return
                      }

                      const toIso = toIsoLocalDate(range.to)
                      const spanDays = daysInclusive(fromIso, toIso)
                      const clampedDays = maxDaysAllowed > 0 ? Math.min(spanDays, maxDaysAllowed) : 0
                      setPendingRangeStartIso(null)
                      setFormData((prev) => ({
                        ...prev,
                        start_date: fromIso,
                        days_count: clampedDays,
                      }))
                      setLastClickedIso(null)
                    }}
                    showOutsideDays
                    disabled={(date) => !formData.leave_type_id || disableDay(date)}
                    modifiers={{
                      blackout: (date) => isBlackoutDate(date),
                      department_busy: (date) => hasDepartmentBooking(date),
                      selected_range: selectedRange || undefined,
                    }}
                    modifiersClassNames={{
                      blackout: "line-through opacity-40",
                      department_busy: "bg-amber-100 text-amber-900 font-medium",
                      selected_range: "bg-blue-100 text-blue-900",
                    }}
                    className="mx-auto"
                  />
                  <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-4 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-3 w-3 rounded bg-amber-100" />
                      Department already booked
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="bg-muted h-3 w-3 rounded" />
                      Dec/Jan blocked (unless emergency)
                      <Switch
                        id="calendar-emergency-override"
                        checked={formData.emergency_override}
                        onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, emergency_override: checked }))}
                        aria-label="Emergency leave override"
                      />
                    </span>
                  </div>
                  {selectedDateBooking ? (
                    <p className="mt-2 text-xs text-amber-700">
                      {selectedDateBooking.count} teammate(s) already booked this date:{" "}
                      {selectedDateBooking.employees.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={formData.start_date}
                    onChange={(event) => {
                      setPendingRangeStartIso(null)
                      setFormData((prev) => ({ ...prev, start_date: event.target.value }))
                    }}
                    min={getTodayLocalIsoDate()}
                    disabled={!formData.leave_type_id}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Number of Days</Label>
                  <Input
                    type="number"
                    min={1}
                    max={maxDaysAllowed > 0 ? maxDaysAllowed : undefined}
                    value={formData.days_count}
                    onChange={(event) =>
                      setFormData((prev) => {
                        if (maxDaysAllowed <= 0) return { ...prev, days_count: 0 }
                        const parsedValue = Number(event.target.value || 1)
                        const normalized = Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : 1
                        const clamped = Math.min(normalized, maxDaysAllowed)
                        return { ...prev, days_count: Math.max(1, clamped) }
                      })
                    }
                    disabled={!formData.leave_type_id || maxDaysAllowed <= 0}
                  />
                </div>
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
            <Label>Reliever</Label>
            <SearchableSelect
              value={formData.reliever_identifier}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, reliever_identifier: value }))}
              options={relieverOptions}
              placeholder="Select reliever from your department"
              searchPlaceholder="Search your department..."
            />
          </div>

          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              rows={3}
              value={formData.reason}
              onChange={(event) => setFormData((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Provide leave reason"
            />
          </div>

          <div className="space-y-2">
            <Label>Handover Note</Label>
            <Textarea
              rows={3}
              value={formData.handover_note}
              onChange={(event) => setFormData((prev) => ({ ...prev, handover_note: event.target.value }))}
              placeholder="Summarize duties and handover details"
            />
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
