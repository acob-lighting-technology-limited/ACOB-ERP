"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api-client"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import { isLate } from "@/lib/hr/attendance-utils"
import type { UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"

interface AppealableRow {
  id: string
  date: string
  dayLabel: string
  dateLabel: string
  normalizedStatus: UnifiedAttendanceStatus
  clock_in?: string | null
  clock_out?: string | null
}

interface AppealDialogProps {
  row: AppealableRow
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editAppeal?: { id: string; appeal_reason: string } | null
  lwpAwpCountThisMonth?: number
}

type RequestedStatus =
  | "absent_with_permission"
  | "lateness_with_permission"
  | "incomplete_with_permission"
  | "out_of_station"

const REQUESTED_LABELS: Record<RequestedStatus, string> = {
  absent_with_permission: "AWP — Absent With Permission",
  lateness_with_permission: "LWP — Lateness With Permission",
  incomplete_with_permission: "IWP — Incomplete With Permission",
  out_of_station: "OOS — Out of Station",
}

export function AppealDialog({
  row,
  open,
  onClose,
  onSuccess,
  editAppeal,
  lwpAwpCountThisMonth = 0,
}: AppealDialogProps) {
  const [submitting, setSubmitting] = useState(false)

  // Absence mode state
  const [absentRequestedStatus, setAbsentRequestedStatus] = useState<"absent_with_permission" | "out_of_station">(
    "absent_with_permission"
  )
  const [absentReason, setAbsentReason] = useState("")

  // Exception checkboxes state (when punches exist)
  const [checkLwp, setCheckLwp] = useState(false)
  const [lwpReason, setLwpReason] = useState("")

  const [checkIwp, setCheckIwp] = useState(false)
  const [iwpReason, setIwpReason] = useState("")

  const [checkOos, setCheckOos] = useState(false)
  const [oosReason, setOosReason] = useState("")

  const isAbsentDay = row.normalizedStatus === "absent" || (!row.clock_in && !row.clock_out)
  const hasLateArrival = Boolean(row.clock_in && isLate(row.clock_in))
  const hasMissingClockOut = Boolean(!row.clock_out || row.normalizedStatus === "incomplete")

  // Reset state when dialog opens or editing changes
  useEffect(() => {
    if (editAppeal) {
      setAbsentReason(editAppeal.appeal_reason)
      setLwpReason(editAppeal.appeal_reason)
      setIwpReason(editAppeal.appeal_reason)
      setOosReason(editAppeal.appeal_reason)
    } else {
      setAbsentReason("")
      setLwpReason("")
      setIwpReason("")
      setOosReason("")
    }

    if (isAbsentDay) {
      setAbsentRequestedStatus("absent_with_permission")
    } else {
      // Default checkboxes based on day's infractions
      setCheckLwp(hasLateArrival)
      setCheckIwp(hasMissingClockOut)
      setCheckOos(false)
    }
  }, [editAppeal, open, row.normalizedStatus, isAbsentDay, hasLateArrival, hasMissingClockOut])

  // Quota check
  const isPermissionRequested = isAbsentDay ? absentRequestedStatus === "absent_with_permission" : checkLwp || checkIwp
  const isQuotaReached = isPermissionRequested && lwpAwpCountThisMonth >= 3 && !editAppeal

  // Validation
  let isValid = false
  if (!isQuotaReached && !submitting) {
    if (editAppeal) {
      isValid = (absentReason || lwpReason).trim().length >= 10
    } else if (isAbsentDay) {
      isValid = absentReason.trim().length >= 10
    } else if (checkOos) {
      isValid = oosReason.trim().length >= 10
    } else {
      const lwpValid = !checkLwp || lwpReason.trim().length >= 10
      const iwpValid = !checkIwp || iwpReason.trim().length >= 10
      const atLeastOneChecked = checkLwp || checkIwp
      isValid = atLeastOneChecked && lwpValid && iwpValid
    }
  }

  async function handleSubmit() {
    if (!isValid) return
    setSubmitting(true)

    try {
      let finalStatus: RequestedStatus = "absent_with_permission"
      let finalReason = ""

      if (editAppeal) {
        finalReason = (absentReason || lwpReason || iwpReason || oosReason).trim()
      } else if (isAbsentDay) {
        finalStatus = absentRequestedStatus
        finalReason = absentReason.trim()
      } else if (checkOos) {
        finalStatus = "out_of_station"
        finalReason = oosReason.trim()
      } else if (checkLwp && checkIwp) {
        finalStatus = "lateness_with_permission"
        finalReason = `Lateness Reason:\n${lwpReason.trim()}\n\nMissed Clock-Out Reason:\n${iwpReason.trim()}`
      } else if (checkIwp) {
        finalStatus = "incomplete_with_permission"
        finalReason = iwpReason.trim()
      } else if (checkLwp) {
        finalStatus = "lateness_with_permission"
        finalReason = lwpReason.trim()
      }

      const url = "/api/hr/attendance/appeals"
      const method = editAppeal ? "PATCH" : "POST"
      const body = editAppeal
        ? { id: editAppeal.id, appeal_reason: finalReason }
        : {
            appeal_date: row.date,
            requested_status: finalStatus,
            appeal_reason: finalReason,
          }

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save appeal")

      toast.success(editAppeal ? "Appeal updated successfully" : "Appeal submitted successfully")
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save appeal")
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editAppeal ? "Edit Attendance Appeal" : "Submit Attendance Appeal"}</DialogTitle>
          <DialogDescription>
            {editAppeal
              ? "Update your reason for this appeal."
              : "Select the permissions you are requesting and provide a reason for each."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Monthly Quota Badge */}
          <div className="bg-muted/60 flex items-center justify-between rounded-md border px-3 py-2 text-xs">
            <span className="text-muted-foreground font-medium">Monthly Quota (LWP / IWP / AWP)</span>
            <Badge
              variant={lwpAwpCountThisMonth >= 3 ? "destructive" : lwpAwpCountThisMonth >= 2 ? "outline" : "secondary"}
            >
              {lwpAwpCountThisMonth} of 3 used this month
            </Badge>
          </div>

          {isQuotaReached && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <strong>Monthly Limit Reached (3/3):</strong> You have used all 3 allowed permissions for this month.
              Department leads cannot grant additional permissions. You can select <em>Out of Station (OOS)</em> or
              contact an admin.
            </div>
          )}

          {/* Day info */}
          <div className="bg-muted/50 space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Day</span>
              <span className="font-medium">{row.dayLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{row.dateLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current Status</span>
              <Badge className={ATTENDANCE_STATUS_COLORS[row.normalizedStatus] ?? "bg-gray-100 text-gray-800"}>
                {ATTENDANCE_STATUS_LABELS[row.normalizedStatus] ?? row.normalizedStatus}
              </Badge>
            </div>
            {row.clock_in && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Punches</span>
                <span>
                  In: <strong>{row.clock_in.slice(0, 5)}</strong> | Out:{" "}
                  <strong>{row.clock_out ? row.clock_out.slice(0, 5) : "Missing"}</strong>
                </span>
              </div>
            )}
          </div>

          {/* Editing existing appeal */}
          {editAppeal ? (
            <div className="space-y-2">
              <Label htmlFor="appeal-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="appeal-reason"
                value={absentReason || lwpReason}
                onChange={(e) => {
                  setAbsentReason(e.target.value)
                  setLwpReason(e.target.value)
                }}
                rows={4}
                disabled={submitting}
                className="resize-none"
              />
              <p className="text-muted-foreground text-xs">
                {(absentReason || lwpReason).trim().length} / 10 minimum characters
              </p>
            </div>
          ) : isAbsentDay ? (
            /* Absent Day Mode */
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="absent-status">Requesting</Label>
                <Select
                  value={absentRequestedStatus}
                  onValueChange={(v) => setAbsentRequestedStatus(v as "absent_with_permission" | "out_of_station")}
                  disabled={submitting}
                >
                  <SelectTrigger id="absent-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absent_with_permission">{REQUESTED_LABELS.absent_with_permission}</SelectItem>
                    <SelectItem value="out_of_station">{REQUESTED_LABELS.out_of_station}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="absent-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="absent-reason"
                  placeholder="Provide a reason for your absence (minimum 10 characters)…"
                  value={absentReason}
                  onChange={(e) => setAbsentReason(e.target.value)}
                  rows={4}
                  disabled={submitting}
                  className="resize-none"
                />
                <p className="text-muted-foreground text-xs">{absentReason.trim().length} / 10 minimum characters</p>
              </div>
            </div>
          ) : (
            /* Exception Checkboxes Mode (Way 1: Modular checkboxes + separate reason per checked item) */
            <div className="space-y-4">
              <Label className="text-sm font-semibold">Select Exceptions to Excuse:</Label>

              {/* OOS Option */}
              <div className="bg-card space-y-3 rounded-lg border p-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="check-oos"
                    checked={checkOos}
                    onCheckedChange={(c) => {
                      const val = Boolean(c)
                      setCheckOos(val)
                      if (val) {
                        setCheckLwp(false)
                        setCheckIwp(false)
                      }
                    }}
                    disabled={submitting}
                  />
                  <Label htmlFor="check-oos" className="cursor-pointer font-medium">
                    Out of Station (OOS) — Away on company business / site visit
                  </Label>
                </div>

                {checkOos && (
                  <div className="space-y-1.5 pl-6">
                    <Label htmlFor="oos-reason" className="text-xs">
                      OOS Details <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="oos-reason"
                      placeholder="Explain your site visit or official duty (min 10 characters)…"
                      value={oosReason}
                      onChange={(e) => setOosReason(e.target.value)}
                      rows={3}
                      disabled={submitting}
                      className="resize-none text-xs"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      {oosReason.trim().length} / 10 minimum characters
                    </p>
                  </div>
                )}
              </div>

              {!checkOos && (
                <>
                  {/* LWP Checkbox + Dedicated Reason */}
                  {(hasLateArrival || !hasMissingClockOut) && (
                    <div className="bg-card space-y-3 rounded-lg border p-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="check-lwp"
                          checked={checkLwp}
                          onCheckedChange={(c) => setCheckLwp(Boolean(c))}
                          disabled={submitting}
                        />
                        <Label htmlFor="check-lwp" className="cursor-pointer font-medium">
                          Excuse Late Arrival (LWP)
                        </Label>
                      </div>

                      {checkLwp && (
                        <div className="space-y-1.5 pl-6">
                          <Label htmlFor="lwp-reason" className="text-xs">
                            Lateness Reason <span className="text-destructive">*</span>
                          </Label>
                          <Textarea
                            id="lwp-reason"
                            placeholder="Why were you late? (min 10 characters)…"
                            value={lwpReason}
                            onChange={(e) => setLwpReason(e.target.value)}
                            rows={3}
                            disabled={submitting}
                            className="resize-none text-xs"
                          />
                          <p className="text-muted-foreground text-[11px]">
                            {lwpReason.trim().length} / 10 minimum characters
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* IWP Checkbox + Dedicated Reason */}
                  {(hasMissingClockOut || !hasLateArrival) && (
                    <div className="bg-card space-y-3 rounded-lg border p-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="check-iwp"
                          checked={checkIwp}
                          onCheckedChange={(c) => setCheckIwp(Boolean(c))}
                          disabled={submitting}
                        />
                        <Label htmlFor="check-iwp" className="cursor-pointer font-medium">
                          Excuse Missing Clock-Out (IWP)
                        </Label>
                      </div>

                      {checkIwp && (
                        <div className="space-y-1.5 pl-6">
                          <Label htmlFor="iwp-reason" className="text-xs">
                            Missed Clock-Out Reason <span className="text-destructive">*</span>
                          </Label>
                          <Textarea
                            id="iwp-reason"
                            placeholder="Why did you miss clocking out? (min 10 characters)…"
                            value={iwpReason}
                            onChange={(e) => setIwpReason(e.target.value)}
                            rows={3}
                            disabled={submitting}
                            className="resize-none text-xs"
                          />
                          <p className="text-muted-foreground text-[11px]">
                            {iwpReason.trim().length} / 10 minimum characters
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting ? (editAppeal ? "Saving…" : "Submitting…") : editAppeal ? "Save Changes" : "Submit Appeal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
