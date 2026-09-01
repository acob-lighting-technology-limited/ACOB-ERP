"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  MessageSquare,
  AlertTriangle,
  Send,
  Building2,
  CalendarDays,
  Target,
  User,
  Gauge,
  Star,
  Users,
} from "lucide-react"
import type { Task } from "@/types/task"
import { TaskStatusControl } from "@/components/tasks/TaskStatusControl"
import { formatWATDateTime, formatWATDate } from "@/lib/utils/date"
import { formatFullName } from "@/lib/utils"
import { TASK_RATING_LABELS, TASK_WEIGHT_DEFAULT, TASK_WEIGHT_LABELS } from "@/lib/tasks/scoring"
import {
  DetailActionBar,
  DetailCallout,
  DetailField,
  DetailFieldGrid,
  DetailSectionHeading,
  DetailTimelineEntry,
} from "@/components/ui/detail-dialog"

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
  /** True when this user may approve, rate, reject or reassign the task. */
  canReview?: boolean
  /** Called after a status change so the list behind the dialog refreshes. */
  onChanged?: () => void | Promise<void>
  /** Posts a comment and refreshes taskUpdates. */
  onAddComment?: (content: string) => Promise<void>
  isPostingComment?: boolean
}

export function UserTaskDetailsDialog({
  open,
  onOpenChange,
  selectedTask,
  taskUpdates,
  canReview = false,
  onChanged,
  onAddComment,
  isPostingComment = false,
}: UserTaskDetailsDialogProps) {
  const [commentDraft, setCommentDraft] = useState("")

  if (!selectedTask) return null

  const isOverdue = Boolean(
    selectedTask.due_date &&
      new Date(selectedTask.due_date).getTime() < new Date().setHours(0, 0, 0, 0) &&
      !["completed", "reassigned", "cancelled"].includes(selectedTask.status)
  )

  const assignedByName = selectedTask.assigned_by_user
    ? formatFullName(selectedTask.assigned_by_user.first_name, selectedTask.assigned_by_user.last_name)
    : "System"

  const assignedToName = selectedTask.assigned_to_user
    ? formatFullName(selectedTask.assigned_to_user.first_name, selectedTask.assigned_to_user.last_name)
    : selectedTask.assignment_type === "department"
      ? `${selectedTask.department || "The department"} · whole department`
      : "Nobody"

  const dueLabel = selectedTask.due_date ? formatWATDate(selectedTask.due_date) : "No deadline"
  const startLabel = selectedTask.task_start_date ? formatWATDate(selectedTask.task_start_date) : null
  const endSource = selectedTask.task_end_date || selectedTask.due_date

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        `max-h`, not a fixed `h`: a task with no description and no comments gets
        a short dialog instead of a near-full screen of empty space.
      */}
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* ── Header: identity, and each fact exactly once ─────────────────── */}
        <DialogHeader className="space-y-2 border-b px-4 py-4 text-left sm:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTask.work_item_number && (
              <Badge variant="outline" className="font-mono text-[11px]">
                {selectedTask.work_item_number}
              </Badge>
            )}
            <Badge
              variant={["high", "urgent"].includes(selectedTask.priority) ? "destructive" : "outline"}
              className="text-[11px] capitalize"
            >
              {selectedTask.priority}
            </Badge>
            {isOverdue && (
              <Badge variant="destructive" className="gap-1 text-[11px]">
                <AlertTriangle className="h-3 w-3" />
                Overdue
              </Badge>
            )}
          </div>

          <DialogTitle className="text-base leading-snug font-semibold">{selectedTask.title}</DialogTitle>

          <DialogDescription className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>Assigned by {assignedByName}</span>
            {selectedTask.department && (
              <>
                <span aria-hidden>·</span>
                <span>{selectedTask.department}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className={isOverdue ? "text-destructive font-medium" : undefined}>Due {dueLabel}</span>
          </DialogDescription>
        </DialogHeader>

        {/* ── The action, pinned directly under the header ─────────────────── */}
        {/* Moving a task forward is why this dialog gets opened, so it sits above
            the scroll rather than inside a tab you have to find. */}
        <DetailActionBar label="Move this task to">
          <TaskStatusControl task={selectedTask} canReview={canReview} onChanged={() => onChanged?.()} />
        </DetailActionBar>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-4 py-4 sm:px-6">
            {/* Anything that needs answering comes before the reference data. */}
            {(selectedTask.unable_to_complete_reason ||
              selectedTask.failure_reason ||
              selectedTask.extension_reason) && (
              <div className="space-y-2">
                {selectedTask.unable_to_complete_reason && (
                  <DetailCallout tone="amber" label="Reported blocker">
                    {selectedTask.unable_to_complete_reason}
                  </DetailCallout>
                )}
                {selectedTask.failure_reason && (
                  <DetailCallout tone="rose" label="Failure note">
                    {selectedTask.failure_reason}
                  </DetailCallout>
                )}
                {selectedTask.extension_reason && (
                  <DetailCallout tone="blue" label="Extension granted for">
                    {selectedTask.extension_reason}
                  </DetailCallout>
                )}
              </div>
            )}

            {selectedTask.description && (
              <section className="space-y-1.5">
                <DetailSectionHeading>What was asked for</DetailSectionHeading>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedTask.description}</p>
              </section>
            )}

            <section className="space-y-3">
              <DetailSectionHeading>Details</DetailSectionHeading>
              <DetailFieldGrid>
                <DetailField icon={User} label="Assigned to">
                  {assignedToName}
                </DetailField>
                <DetailField icon={CalendarDays} label="Period">
                  {startLabel || "—"} to {endSource ? formatWATDate(endSource) : "no deadline"}
                </DetailField>
                <DetailField icon={Target} label="Strategic goal">
                  {selectedTask.goal_title || <span className="text-muted-foreground">Ad-hoc / operational</span>}
                </DetailField>
                <DetailField icon={Target} label="Corporate KPI">
                  {selectedTask.kpi_measure || <span className="text-muted-foreground">Not linked</span>}
                </DetailField>
                <DetailField icon={Gauge} label="Weight">
                  {selectedTask.weight ?? TASK_WEIGHT_DEFAULT} —{" "}
                  {TASK_WEIGHT_LABELS[selectedTask.weight ?? TASK_WEIGHT_DEFAULT]}
                </DetailField>
                <DetailField icon={Star} label="Rating">
                  {selectedTask.rating ? (
                    `${selectedTask.rating}/5 — ${TASK_RATING_LABELS[selectedTask.rating]}`
                  ) : (
                    <span className="text-muted-foreground">Not yet rated</span>
                  )}
                </DetailField>
                <DetailField icon={Building2} label="Created">
                  {formatWATDateTime(selectedTask.created_at)}
                </DetailField>
                {selectedTask.reviewed_by_user && (
                  <DetailField icon={User} label="Reviewed by">
                    {formatFullName(selectedTask.reviewed_by_user.first_name, selectedTask.reviewed_by_user.last_name)}
                    {selectedTask.reviewed_at && (
                      <span className="text-muted-foreground"> · {formatWATDateTime(selectedTask.reviewed_at)}</span>
                    )}
                  </DetailField>
                )}
                {selectedTask.group_id && (
                  <DetailField icon={Users} label="Shared task">
                    Assigned to several people
                  </DetailField>
                )}
              </DetailFieldGrid>
            </section>

            {/* ── Activity, in the same scroll rather than behind a tab ─────── */}
            {/* It is usually a handful of entries, and hiding it cost a click to
                find out whether anything had happened at all. */}
            <section className="space-y-3">
              <DetailSectionHeading count={taskUpdates.length}>Activity</DetailSectionHeading>

              {onAddComment && (
                <div className="space-y-2">
                  <Textarea
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Post a progress note or update…"
                    className="min-h-[68px] text-sm"
                    aria-label="Add a comment"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={isPostingComment || !commentDraft.trim()}
                      onClick={async () => {
                        await onAddComment(commentDraft.trim())
                        setCommentDraft("")
                      }}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {isPostingComment ? "Posting…" : "Post comment"}
                    </Button>
                  </div>
                </div>
              )}

              {taskUpdates.length > 0 ? (
                <ul className="space-y-3">
                  {taskUpdates.map((update) => (
                    <DetailTimelineEntry
                      key={update.id}
                      title={update.user ? formatFullName(update.user.first_name, update.user.last_name) : "System"}
                      timestamp={formatWATDateTime(update.created_at)}
                    >
                      {update.content}
                    </DetailTimelineEntry>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4" />
                  No updates yet.
                </p>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
