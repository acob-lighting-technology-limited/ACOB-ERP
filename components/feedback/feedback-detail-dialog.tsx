"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatName } from "@/lib/utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import type { FeedbackRecord } from "@/components/feedback/types"

function getTypeColor(type: string): string {
  switch (type) {
    case "concern":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "complaint":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    case "suggestion":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "required_item":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "open":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "resolved":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    case "closed":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

interface FeedbackDetailDialogProps {
  feedback: FeedbackRecord | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onUpdateStatus: (newStatus: string) => void
  isUpdating: boolean
}

export function FeedbackDetailDialog({
  feedback,
  isOpen,
  onOpenChange,
  onUpdateStatus,
  isUpdating,
}: FeedbackDetailDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Feedback Details</DialogTitle>
          <DialogDescription>View and manage feedback details</DialogDescription>
        </DialogHeader>

        {feedback && (
          <div className="space-y-6">
            {feedback.target_lead_id && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Feedback About (Department Lead)</Label>
                <div className="border-primary/30 bg-primary/5 rounded-lg border p-4">
                  <p className="text-lg font-medium">
                    {formatName(feedback.target_lead?.first_name)} {formatName(feedback.target_lead?.last_name)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {feedback.target_department || feedback.target_lead?.department || "—"}
                  </p>
                  <p className="text-muted-foreground mt-2 border-t pt-2 text-xs">
                    Fully anonymous upward feedback. The submitter is not recorded anywhere, and this record is never
                    shown to the lead named above.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Submitted By</Label>
              <div className="bg-muted/50 rounded-lg border p-4">
                {feedback.user_id ? (
                  <>
                    <p className="text-lg font-medium">
                      {formatName(feedback.profiles?.first_name)} {formatName(feedback.profiles?.last_name)}
                    </p>
                    <p className="text-muted-foreground text-sm">{feedback.profiles?.company_email}</p>
                    <p className="text-muted-foreground text-sm">{feedback.profiles?.department}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-lg font-medium italic">Anonymous Submission</p>
                )}
                <div className="mt-2 border-t pt-2">
                  {/* Lead feedback is stamped to the day only — showing a clock time here would imply a precision that is deliberately not recorded. */}
                  <p className="text-muted-foreground text-xs">
                    Submitted:{" "}
                    {feedback.target_lead_id
                      ? `${formatWATDate(feedback.created_at)} (date only — submission time is not recorded)`
                      : formatWATDateTime(feedback.created_at)}
                  </p>
                  {feedback.updated_at !== feedback.created_at && (
                    <p className="text-muted-foreground text-xs">Updated: {formatWATDateTime(feedback.updated_at)}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Feedback Type</Label>
                <div>
                  <Badge className={getTypeColor(feedback.feedback_type)}>{feedback.feedback_type}</Badge>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Current Status</Label>
                <div>
                  <Badge className={getStatusColor(feedback.status)}>{feedback.status}</Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Title</Label>
              <div className="bg-muted/50 rounded-lg border p-3">
                <p className="font-medium">{feedback.title}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Description</Label>
              <div className="bg-muted/50 min-h-[100px] rounded-lg border p-4">
                <p className="whitespace-pre-wrap">{feedback.description || "No description provided."}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Update Status</Label>
              <Select value={feedback.status} onValueChange={(value) => onUpdateStatus(value)} disabled={isUpdating}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 border-t pt-4">
              <Button onClick={() => onOpenChange(false)} variant="outline" className="flex-1">
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
