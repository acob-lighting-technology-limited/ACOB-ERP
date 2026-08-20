"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/ui/patterns"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import {
  MessageSquare,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  HeadphonesIcon,
  Target,
  User,
  Calendar,
  AlertTriangle,
  Send,
  XCircle,
  Play,
} from "lucide-react"
import type { Task } from "@/types/task"
import { formatWATDateTime, formatWATDate } from "@/lib/utils/date"
import { formatFullName } from "@/lib/utils"
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/lib/tasks/constants"

interface TaskUpdate {
  id: string
  content?: string
  update_type: string
  created_at: string
  user?: {
    first_name: string
    last_name: string
  }
}

interface UserTaskDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTask: Task | null
  taskUpdates: TaskUpdate[]
  newStatus: string
  isSaving: boolean
  onUpdateStatus: (status: string, reason?: string) => Promise<void>
}

export function UserTaskDetailsDialog({
  open,
  onOpenChange,
  selectedTask,
  taskUpdates,
  isSaving,
  onUpdateStatus,
}: UserTaskDetailsDialogProps) {
  const [showUnableDialog, setShowUnableDialog] = useState(false)
  const [unableReason, setUnableReason] = useState("")
  const [submitComment, setSubmitComment] = useState("")
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)

  if (!selectedTask) return null

  const statusCfg = TASK_STATUS_CONFIG[selectedTask.status as TaskStatus] || TASK_STATUS_CONFIG.pending

  const isOverdue =
    selectedTask.due_date &&
    new Date(selectedTask.due_date).getTime() < new Date().setHours(0, 0, 0, 0) &&
    !["completed", "reassigned", "cancelled"].includes(selectedTask.status)

  const handleStartTask = () => {
    onUpdateStatus("in_progress")
  }

  const handleConfirmSubmitForReview = async () => {
    await onUpdateStatus("submitted_for_review", submitComment)
    setShowSubmitDialog(false)
    setSubmitComment("")
  }

  const handleConfirmUnableToComplete = async () => {
    if (!unableReason.trim()) return
    await onUpdateStatus("unable_to_complete", unableReason)
    setShowUnableDialog(false)
    setUnableReason("")
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Task Details"
      description="Review task information, progress, and activity history."
      desktopClassName="max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      <div className="space-y-3 pt-2">
        {/* Main Task Header Card */}
        <Card className="border">
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="space-y-1">
              {selectedTask.work_item_number && (
                <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                  {selectedTask.work_item_number}
                </div>
              )}
              <div className="text-foreground text-base leading-tight font-semibold">{selectedTask.title}</div>
              {selectedTask.description && (
                <p className="text-muted-foreground pt-1 text-xs leading-relaxed whitespace-pre-wrap">
                  {selectedTask.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="outline" className={`gap-1 text-xs capitalize ${statusCfg.color}`}>
                {statusCfg.label}
              </Badge>
              <Badge variant="outline" className="text-xs capitalize">
                {selectedTask.priority} priority
              </Badge>
              {selectedTask.department && (
                <Badge variant="outline" className="text-xs">
                  {selectedTask.department}
                </Badge>
              )}
              {isOverdue && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  Overdue
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Task Metadata & Attribution Grid */}
        <div className="bg-muted/20 grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs">
          <div>
            <span className="text-muted-foreground block text-[11px]">Assigned By:</span>
            <span className="text-foreground font-medium">
              {selectedTask.assigned_by_user
                ? formatFullName(selectedTask.assigned_by_user.first_name, selectedTask.assigned_by_user.last_name)
                : "System"}
            </span>
          </div>

          <div>
            <span className="text-muted-foreground block text-[11px]">Due Date:</span>
            <span className={`font-medium ${isOverdue ? "text-destructive font-semibold" : "text-foreground"}`}>
              {selectedTask.due_date ? formatWATDate(selectedTask.due_date) : "No deadline"}
            </span>
          </div>

          <div>
            <span className="text-muted-foreground block text-[11px]">Strategic Goal:</span>
            <span className="text-foreground font-medium">
              {selectedTask.goal_title || (
                <span className="text-muted-foreground italic">None (Ad-Hoc / Operational)</span>
              )}
            </span>
          </div>

          <div>
            <span className="text-muted-foreground block text-[11px]">Created At:</span>
            <span className="text-foreground font-medium">{formatWATDateTime(selectedTask.created_at)}</span>
          </div>

          {selectedTask.reviewed_by_user && (
            <div className="col-span-2 border-t pt-1">
              <span className="text-muted-foreground block text-[11px]">Reviewed / Decided By:</span>
              <span className="text-foreground font-medium">
                {formatFullName(selectedTask.reviewed_by_user.first_name, selectedTask.reviewed_by_user.last_name)}
                {selectedTask.reviewed_at && ` on ${formatWATDateTime(selectedTask.reviewed_at)}`}
              </span>
            </div>
          )}

          {selectedTask.unable_to_complete_reason && (
            <div className="col-span-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
              <span className="mb-0.5 block font-semibold">Reported Issue / Reason:</span>
              {selectedTask.unable_to_complete_reason}
            </div>
          )}

          {selectedTask.failure_reason && (
            <div className="col-span-2 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-800 dark:text-rose-300">
              <span className="mb-0.5 block font-semibold">Failure Note:</span>
              {selectedTask.failure_reason}
            </div>
          )}

          {selectedTask.extension_reason && (
            <div className="col-span-2 rounded border border-blue-500/30 bg-blue-500/10 p-2 text-blue-800 dark:text-blue-300">
              <span className="mb-0.5 block font-semibold">Extension Reason:</span>
              {selectedTask.extension_reason}
            </div>
          )}
        </div>

        {/* Employee Actions Section */}
        <div className="space-y-2.5 rounded-lg border p-3.5">
          <Label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">My Actions</Label>

          {selectedTask.status === "pending" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleStartTask} disabled={isSaving} className="gap-1.5">
                <Play className="h-3.5 w-3.5" />
                Start Working on Task
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUnableDialog(true)}
                disabled={isSaving}
                className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              >
                Cannot Complete / Flag Blocked
              </Button>
            </div>
          )}

          {selectedTask.status === "in_progress" && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => setShowSubmitDialog(true)}
                disabled={isSaving}
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Send className="h-3.5 w-3.5" />
                Submit Task for Review
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUnableDialog(true)}
                disabled={isSaving}
                className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              >
                Unable to Complete
              </Button>
            </div>
          )}

          {selectedTask.status === "submitted_for_review" && (
            <div className="flex items-center justify-between rounded border border-purple-500/30 bg-purple-500/10 p-2.5 text-xs text-purple-800 dark:text-purple-300">
              <span>Task submitted for review. Waiting for department lead / admin approval.</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-purple-700 hover:bg-purple-500/20"
                onClick={() => onUpdateStatus("in_progress")}
              >
                Revert to In Progress
              </Button>
            </div>
          )}

          {selectedTask.status === "completed" && (
            <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>This task has been approved and completed. KPI achievement recorded.</span>
            </div>
          )}

          {selectedTask.status === "unable_to_complete" && (
            <div className="flex items-center justify-between rounded border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs text-orange-800 dark:text-orange-300">
              <span>Issue reported. Department lead / admin will review, reassign, or extend deadline.</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-orange-700 hover:bg-orange-500/20"
                onClick={() => onUpdateStatus("in_progress")}
              >
                Resume Task
              </Button>
            </div>
          )}

          {/* Submit for Review Modal */}
          {showSubmitDialog && (
            <div className="bg-muted/30 mt-2 space-y-2 rounded-lg border p-3">
              <Label className="text-xs font-semibold">Completion Note / Deliverables (Optional)</Label>
              <Textarea
                value={submitComment}
                onChange={(e) => setSubmitComment(e.target.value)}
                placeholder="Add links, completion notes, or comments for the lead..."
                className="min-h-[60px] text-xs"
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setShowSubmitDialog(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleConfirmSubmitForReview} disabled={isSaving}>
                  Confirm Submission
                </Button>
              </div>
            </div>
          )}

          {/* Unable to Complete Modal */}
          {showUnableDialog && (
            <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              <Label className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Reason for being unable to complete *
              </Label>
              <Textarea
                value={unableReason}
                onChange={(e) => setUnableReason(e.target.value)}
                placeholder="Explain the blocker, missing dependencies, or issue..."
                className="bg-background min-h-[60px] text-xs"
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setShowUnableDialog(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleConfirmUnableToComplete}
                  disabled={isSaving || !unableReason.trim()}
                >
                  Submit Issue Report
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Activity Updates History */}
        <section className="space-y-2 pt-2">
          <h3 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
            <MessageSquare className="h-3.5 w-3.5" />
            Activity History
          </h3>
          {taskUpdates.length > 0 ? (
            <div className="max-h-40 space-y-2.5 overflow-y-auto pr-1">
              {taskUpdates.map((update) => (
                <div key={update.id} className="border-primary/30 border-l-2 py-0.5 pl-3">
                  {update.user && (
                    <p className="text-foreground text-xs font-medium">
                      {formatFullName(update.user.first_name, update.user.last_name)}
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs leading-relaxed">{update.content}</p>
                  <p className="text-muted-foreground text-[10px]">{formatWATDateTime(update.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No updates yet"
              description="Task comments and status changes will appear here."
              icon={MessageSquare}
              className="border-0 px-0 py-2"
            />
          )}
        </section>
      </div>
    </ResponsiveModal>
  )
}
