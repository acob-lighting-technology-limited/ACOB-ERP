"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { FleetAttachment, FleetBooking } from "./fleet-types"

type BookingReviewDialogProps = {
  selectedBooking: FleetBooking | null
  attachments: FleetAttachment[]
  adminNote: string
  reviewing: boolean
  formatDateTime: (value: string) => string
  onAdminNoteChange: (value: string) => void
  onClose: () => void
  onReview: (action: "approve" | "reject") => void
}

export function BookingReviewDialog({
  selectedBooking,
  attachments,
  adminNote,
  reviewing,
  formatDateTime,
  onAdminNoteChange,
  onClose,
  onReview,
}: BookingReviewDialogProps) {
  return (
    <Dialog open={Boolean(selectedBooking)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review Resource Booking</DialogTitle>
          <DialogDescription>Confirm the reason and supporting files before approval.</DialogDescription>
        </DialogHeader>

        {selectedBooking ? (
          <div className="space-y-4 py-2">
            <div className="bg-muted/30 rounded border p-3">
              <p className="font-medium">{selectedBooking.resource?.name || "Resource"}</p>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(selectedBooking.start_at)} - {formatDateTime(selectedBooking.end_at)}
              </p>
              <p className="mt-2 text-sm">{selectedBooking.reason}</p>
            </div>

            {selectedBooking.status !== "pending" && (
              <div className="bg-muted/30 space-y-1 rounded border p-3 text-sm">
                <p className="text-muted-foreground text-xs uppercase">
                  {selectedBooking.status === "rejected" ? "Rejected by" : "Decision by"}
                </p>
                <p className="font-medium">
                  {selectedBooking.reviewer?.full_name || "Unknown"}
                  {selectedBooking.reviewer?.department ? ` — ${selectedBooking.reviewer.department}` : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {selectedBooking.reviewed_at ? formatDateTime(selectedBooking.reviewed_at) : "Time not recorded"}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Attachments</Label>
              {attachments.length === 0 ? (
                <p className="text-muted-foreground text-sm">No attachments provided.</p>
              ) : null}
              {attachments.map((file) => (
                <div key={file.id} className="flex items-center justify-between rounded border p-2 text-sm">
                  <div>
                    <p>{file.file_name}</p>
                    <p className="text-muted-foreground text-xs">
                      {file.mime_type} • {(file.file_size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  {file.signed_url ? (
                    <a
                      href={file.signed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary text-sm hover:underline"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">Unavailable</span>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Admin Note</Label>
              <Textarea
                value={adminNote}
                onChange={(event) => onAdminNoteChange(event.target.value)}
                rows={3}
                placeholder="Add a note to explain your decision..."
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {selectedBooking?.status === "pending" ? (
            <>
              <Button variant="destructive" onClick={() => onReview("reject")} disabled={reviewing}>
                Reject
              </Button>
              <Button onClick={() => onReview("approve")} disabled={reviewing}>
                Approve
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
