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
import { Textarea } from "@/components/ui/textarea"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import type { UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"

export interface AppealRow {
  id: string
  user_id: string
  user_name: string
  department: string
  appeal_date: string
  current_status: string
  requested_status: string
  appeal_reason: string
  resolution_note: string | null
  status: "pending" | "approved" | "rejected"
  created_at: string
}

interface AppealReviewDialogProps {
  appeal: AppealRow | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function AppealReviewDialog({ appeal, open, onClose, onSuccess }: AppealReviewDialogProps) {
  const [note, setNote] = useState("")
  const [approvingLoad, setApprovingLoad] = useState(false)
  const [rejectingLoad, setRejectingLoad] = useState(false)

  // Sync note when appeal changes
  useEffect(() => {
    setNote("")
  }, [appeal])

  const currentNote = appeal ? note : ""
  const isLoading = approvingLoad || rejectingLoad

  async function handleAction(action: "approve" | "reject") {
    if (!appeal) return
    const noteValue = currentNote.trim()
    if (action === "reject" && !noteValue) {
      toast.error("A resolution note is required when rejecting an appeal")
      return
    }

    const setter = action === "approve" ? setApprovingLoad : setRejectingLoad
    setter(true)
    try {
      const res = await fetch("/api/admin/hr/attendance/appeals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: appeal.id,
          action,
          resolution_note: noteValue || null,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? `Failed to ${action} appeal`)
      toast.success(action === "approve" ? "Appeal approved" : "Appeal rejected")
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} appeal`)
    } finally {
      setter(false)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose()
  }

  // Reset note when a new appeal opens
  function handleNoteChange(value: string) {
    setNote(value)
  }

  // When the dialog opens with a new appeal, seed the note
  const displayNote = appeal ? note : ""

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review Appeal</DialogTitle>
          <DialogDescription>
            {appeal ? `${appeal.user_name} — ${appeal.appeal_date}` : "No appeal selected"}
          </DialogDescription>
        </DialogHeader>

        {appeal && (
          <div className="space-y-4 py-2">
            {/* Employee & date summary */}
            <div className="bg-muted/50 space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Employee</span>
                <div className="text-right">
                  <div className="font-medium">{appeal.user_name}</div>
                  <div className="text-muted-foreground text-xs">{appeal.department}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Appeal Date</span>
                <span className="font-medium">{appeal.appeal_date}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Status</span>
                <Badge
                  className={
                    ATTENDANCE_STATUS_COLORS[appeal.current_status as UnifiedAttendanceStatus] ??
                    "bg-gray-100 text-gray-800"
                  }
                >
                  {ATTENDANCE_STATUS_LABELS[appeal.current_status as UnifiedAttendanceStatus] ?? appeal.current_status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Requesting</span>
                <Badge
                  className={
                    ATTENDANCE_STATUS_COLORS[appeal.requested_status as UnifiedAttendanceStatus] ??
                    "bg-blue-100 text-blue-800"
                  }
                >
                  {ATTENDANCE_STATUS_LABELS[appeal.requested_status as UnifiedAttendanceStatus] ??
                    appeal.requested_status}
                </Badge>
              </div>
            </div>

            {/* Employee's original reason */}
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Employee&apos;s Reason
              </p>
              <p className="text-sm leading-relaxed">{appeal.appeal_reason}</p>
            </div>

            {/* Resolution note */}
            <div className="space-y-2">
              <Label htmlFor="resolution-note">
                Resolution Note <span className="text-muted-foreground text-xs">(required for rejection)</span>
              </Label>
              <Textarea
                id="resolution-note"
                placeholder="Add a note explaining your decision…"
                value={displayNote}
                onChange={(e) => handleNoteChange(e.target.value)}
                rows={3}
                disabled={isLoading}
                className="resize-none"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleAction("reject")}
            disabled={isLoading || !appeal || !currentNote.trim()}
          >
            {rejectingLoad ? "Rejecting…" : "Reject"}
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => void handleAction("approve")}
            disabled={isLoading || !appeal || !currentNote.trim()}
          >
            {approvingLoad ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
