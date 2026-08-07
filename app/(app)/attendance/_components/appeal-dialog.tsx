"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import type { UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"

// Minimal shape we need — mirrors AttendanceRow from attendance-content.tsx
interface AppealableRow {
  id: string
  date: string
  dayLabel: string
  dateLabel: string
  normalizedStatus: UnifiedAttendanceStatus
  clock_in: string | null | undefined
}

interface AppealDialogProps {
  row: AppealableRow
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editAppeal?: { id: string; appeal_reason: string } | null
}

type RequestedStatus = "absent_with_permission" | "lateness_with_permission" | "out_of_station"

const REQUESTED_LABELS: Record<RequestedStatus, string> = {
  absent_with_permission: "AWP — Absent With Permission",
  lateness_with_permission: "LWP — Lateness With Permission",
  out_of_station: "OOS — Out of Station",
}

const REQUESTED_HINTS: Record<RequestedStatus, string> = {
  absent_with_permission: "You were away with prior permission.",
  lateness_with_permission: "You arrived late with prior permission.",
  out_of_station: "You were away on company business — a site visit, field work or travel.",
}

/**
 * Which statuses this day may be appealed as. The permission status depends on what the day
 * came out as; out of station applies to any of them, since being away on company business can
 * leave no punch at all or a late one on the way back.
 */
function getRequestedOptions(status: UnifiedAttendanceStatus): RequestedStatus[] {
  const permission: RequestedStatus = status === "absent" ? "absent_with_permission" : "lateness_with_permission"
  return [permission, "out_of_station"]
}

export function AppealDialog({ row, open, onClose, onSuccess, editAppeal }: AppealDialogProps) {
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const options = getRequestedOptions(row.normalizedStatus)
  const [requestedStatus, setRequestedStatus] = useState<RequestedStatus>(options[0])

  // Sync reason state when editing changes or dialog opens
  useEffect(() => {
    if (editAppeal) {
      setReason(editAppeal.appeal_reason)
    } else {
      setReason("")
    }
    // Default back to the permission status each time; OOS is the deliberate choice.
    setRequestedStatus(getRequestedOptions(row.normalizedStatus)[0])
  }, [editAppeal, open, row.normalizedStatus])

  const isValid = reason.trim().length >= 10

  async function handleSubmit() {
    if (!isValid) return
    setSubmitting(true)
    try {
      const url = "/api/hr/attendance/appeals"
      const method = editAppeal ? "PATCH" : "POST"
      const body = editAppeal
        ? { id: editAppeal.id, appeal_reason: reason.trim() }
        : {
            appeal_date: row.date,
            requested_status: requestedStatus,
            appeal_reason: reason.trim(),
          }

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save appeal")
      toast.success(editAppeal ? "Appeal updated successfully" : "Appeal submitted successfully")
      setReason("")
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
      setReason("")
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editAppeal ? "Edit Attendance Appeal" : "Submit Attendance Appeal"}</DialogTitle>
          <DialogDescription>
            {editAppeal
              ? "Update your reason for this appeal."
              : "Request a status change for this attendance day. Your appeal will be reviewed by an admin."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
          </div>

          {/* Requested status — editing an appeal only changes the reason, so it is fixed there */}
          {editAppeal ? (
            <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">Requesting</p>
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                {REQUESTED_LABELS[requestedStatus]}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="requested-status">Requesting</Label>
              <Select
                value={requestedStatus}
                onValueChange={(v) => setRequestedStatus(v as RequestedStatus)}
                disabled={submitting}
              >
                <SelectTrigger id="requested-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {REQUESTED_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{REQUESTED_HINTS[requestedStatus]}</p>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="appeal-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="appeal-reason"
              placeholder="Provide a reason for this appeal (minimum 10 characters)…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              disabled={submitting}
              className="resize-none"
            />
            <p className="text-muted-foreground text-xs">{reason.trim().length} / 10 minimum characters</p>
          </div>
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
