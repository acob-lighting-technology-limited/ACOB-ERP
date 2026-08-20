"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { EmptyState } from "@/components/ui/patterns"
import {
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Clock,
  Target,
  User,
  Calendar,
  AlertTriangle,
  Send,
  Play,
  Copy,
  Check,
  Building2,
  CalendarCheck2,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  ClipboardList,
} from "lucide-react"
import type { Task } from "@/types/task"
import { formatWATDateTime, formatWATDate } from "@/lib/utils/date"
import { formatFullName, cn } from "@/lib/utils"
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

type TaskTab = "overview" | "actions" | "activity"

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const f = (firstName || "").trim()[0] || ""
  const l = (lastName || "").trim()[0] || ""
  return (f + l).toUpperCase() || "TS"
}

export function UserTaskDetailsDialog({
  open,
  onOpenChange,
  selectedTask,
  taskUpdates,
  isSaving,
  onUpdateStatus,
}: UserTaskDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<TaskTab>("overview")
  const [showUnableDialog, setShowUnableDialog] = useState(false)
  const [unableReason, setUnableReason] = useState("")
  const [submitComment, setSubmitComment] = useState("")
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, fieldName: string) => {
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  if (!selectedTask) return null

  const statusCfg = TASK_STATUS_CONFIG[selectedTask.status as TaskStatus] || TASK_STATUS_CONFIG.pending

  const isOverdue =
    selectedTask.due_date &&
    new Date(selectedTask.due_date).getTime() < new Date().setHours(0, 0, 0, 0) &&
    !["completed", "reassigned", "cancelled"].includes(selectedTask.status)

  const handleStartTask = () => {
    void onUpdateStatus("in_progress")
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

  const assignedByName = selectedTask.assigned_by_user
    ? formatFullName(selectedTask.assigned_by_user.first_name, selectedTask.assigned_by_user.last_name)
    : "System"

  const tabs: Array<{ id: TaskTab; label: string; icon: typeof CalendarCheck2; count?: number }> = [
    { id: "overview", label: "Overview & Specs", icon: CalendarCheck2 },
    { id: "actions", label: "My Actions", icon: Play },
    { id: "activity", label: "Activity History", icon: MessageSquare, count: taskUpdates.length },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88dvh] max-h-[88dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        {/* Modal Header */}
        <DialogHeader className="bg-muted/20 border-b px-5 py-3.5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0 border shadow-xs">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                  {selectedTask.assigned_by_user
                    ? getInitials(selectedTask.assigned_by_user.first_name, selectedTask.assigned_by_user.last_name)
                    : "TK"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-base font-semibold">{selectedTask.title}</DialogTitle>
                  {selectedTask.work_item_number && (
                    <Badge
                      variant="outline"
                      className="border-blue-200 bg-blue-50/50 font-mono text-[11px] font-medium text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
                    >
                      {selectedTask.work_item_number}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span>Assigned by {assignedByName}</span>
                  {selectedTask.department && (
                    <>
                      <span>•</span>
                      <span>{selectedTask.department}</span>
                    </>
                  )}
                  {selectedTask.due_date && (
                    <>
                      <span>•</span>
                      <span className={isOverdue ? "text-destructive font-medium" : ""}>
                        Due: {formatWATDate(selectedTask.due_date)}
                      </span>
                    </>
                  )}
                </DialogDescription>
              </div>
            </div>

            {/* Quick Status Badges in Header */}
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className={cn("px-2.5 py-0.5 text-xs font-medium capitalize", statusCfg.color)}>
                {statusCfg.label}
              </Badge>
              <Badge variant="outline" className="text-xs capitalize">
                {selectedTask.priority}
              </Badge>
              {isOverdue && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  Overdue
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Tab Navigation Header */}
        <div className="bg-background border-b px-5 sm:px-6">
          <div className="flex gap-1">
            {tabs.map(({ id, label, icon: TabIcon, count }) => {
              const isActive = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  )}
                >
                  <TabIcon className="h-3.5 w-3.5" />
                  {label}
                  {count !== undefined && count > 0 && (
                    <span className="bg-muted text-muted-foreground ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-5 sm:p-6">
              {/* TAB 1: OVERVIEW & SPECS */}
              {activeTab === "overview" && (
                <div className="space-y-4">
                  {/* Hero Stat Cards */}
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                    <div className="bg-card rounded-lg border p-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                          Status
                        </span>
                        <div className="rounded-md bg-blue-500/10 p-1 text-blue-600 dark:text-blue-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      <div className="mt-1">
                        <span className="text-foreground block truncate text-sm font-semibold capitalize">
                          {statusCfg.label}
                        </span>
                      </div>
                    </div>

                    <div className="bg-card rounded-lg border p-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                          Due Date
                        </span>
                        <div
                          className={cn(
                            "rounded-md p-1",
                            isOverdue ? "bg-red-500/10 text-red-600" : "bg-purple-500/10 text-purple-600"
                          )}
                        >
                          <Calendar className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      <div className="mt-1">
                        <span
                          className={cn(
                            "block truncate text-sm font-semibold",
                            isOverdue ? "text-red-600" : "text-foreground"
                          )}
                        >
                          {selectedTask.due_date ? formatWATDate(selectedTask.due_date) : "No deadline"}
                        </span>
                      </div>
                    </div>

                    <div className="bg-card rounded-lg border p-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                          Priority
                        </span>
                        <div className="rounded-md bg-amber-500/10 p-1 text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      <div className="mt-1">
                        <span className="text-foreground block truncate text-sm font-semibold capitalize">
                          {selectedTask.priority}
                        </span>
                      </div>
                    </div>

                    <div className="bg-card rounded-lg border p-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                          Strategic Goal
                        </span>
                        <div className="rounded-md bg-emerald-500/10 p-1 text-emerald-600 dark:text-emerald-400">
                          <Target className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      <div className="mt-1">
                        <span className="text-foreground block truncate text-sm font-semibold">
                          {selectedTask.goal_title || "Ad-Hoc / Operational"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Task Description Card */}
                  {selectedTask.description && (
                    <div className="bg-card space-y-2 rounded-lg border p-4 shadow-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                        <ClipboardList className="text-primary h-3.5 w-3.5" /> Task Description & Deliverables
                      </span>
                      <p className="text-foreground/90 pt-1 text-xs leading-relaxed whitespace-pre-wrap">
                        {selectedTask.description}
                      </p>
                    </div>
                  )}

                  {/* 2-Column Metadata Grid */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Left Card: Assignment & Governance */}
                    <div className="bg-card space-y-3.5 rounded-lg border p-4 shadow-xs">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                          <User className="text-primary h-3.5 w-3.5" /> Assignment & People
                        </span>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Assigned By</span>
                          <span className="text-foreground mt-0.5 block font-medium">{assignedByName}</span>
                        </div>

                        <div>
                          <span className="text-muted-foreground block text-[11px]">Department</span>
                          <span className="text-foreground mt-0.5 block font-medium">
                            {selectedTask.department || "Unassigned"}
                          </span>
                        </div>

                        <div>
                          <span className="text-muted-foreground block text-[11px]">Created At</span>
                          <span className="text-foreground mt-0.5 block font-mono text-[11px]">
                            {formatWATDateTime(selectedTask.created_at)}
                          </span>
                        </div>

                        {selectedTask.reviewed_by_user && (
                          <div className="border-t pt-2.5">
                            <span className="text-muted-foreground block text-[11px]">Reviewed / Decided By</span>
                            <span className="text-foreground mt-0.5 block font-medium">
                              {formatFullName(
                                selectedTask.reviewed_by_user.first_name,
                                selectedTask.reviewed_by_user.last_name
                              )}
                              {selectedTask.reviewed_at && ` on ${formatWATDateTime(selectedTask.reviewed_at)}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Card: Context & Strategic Linkage */}
                    <div className="bg-card space-y-3.5 rounded-lg border p-4 shadow-xs">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                          <Target className="text-primary h-3.5 w-3.5" /> Governance & KPI Linkage
                        </span>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Strategic PMS Goal</span>
                          <span className="text-foreground mt-0.5 block font-medium">
                            {selectedTask.goal_title ? (
                              <span className="text-primary font-semibold">{selectedTask.goal_title}</span>
                            ) : (
                              <span className="text-muted-foreground italic">None (Ad-Hoc / Operational Task)</span>
                            )}
                          </span>
                        </div>

                        <div>
                          <span className="text-muted-foreground block text-[11px]">Work Item Number</span>
                          <span className="text-foreground mt-0.5 block font-mono text-[11px]">
                            {selectedTask.work_item_number || "—"}
                          </span>
                        </div>

                        {selectedTask.unable_to_complete_reason && (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-800 dark:text-amber-300">
                            <span className="block text-[11px] font-semibold">Reported Blocker:</span>
                            <span className="text-xs">{selectedTask.unable_to_complete_reason}</span>
                          </div>
                        )}

                        {selectedTask.failure_reason && (
                          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-800 dark:text-rose-300">
                            <span className="block text-[11px] font-semibold">Failure Note:</span>
                            <span className="text-xs">{selectedTask.failure_reason}</span>
                          </div>
                        )}

                        {selectedTask.extension_reason && (
                          <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-2.5 text-blue-800 dark:text-blue-300">
                            <span className="block text-[11px] font-semibold">Extension Granted For:</span>
                            <span className="text-xs">{selectedTask.extension_reason}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MY ACTIONS */}
              {activeTab === "actions" && (
                <div className="space-y-4">
                  {/* Action Cards based on State */}
                  <div className="bg-card space-y-3.5 rounded-lg border p-4 shadow-xs">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                        <Play className="text-primary h-3.5 w-3.5" /> Available Task Actions
                      </span>
                      <Badge variant="outline" className={cn("text-[10px] capitalize", statusCfg.color)}>
                        Current: {statusCfg.label}
                      </Badge>
                    </div>

                    {selectedTask.status === "pending" && (
                      <div className="space-y-3 pt-1">
                        <div className="bg-muted/20 text-muted-foreground rounded-lg border p-3 text-xs">
                          This task is currently pending. Start working on it to mark it in progress, or report an
                          impediment if you cannot complete it.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={handleStartTask}
                            disabled={isSaving}
                            className="h-8 gap-1.5 text-xs"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Start Working on Task
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowUnableDialog(true)}
                            disabled={isSaving}
                            className="h-8 border-amber-500/30 text-xs text-amber-600 hover:bg-amber-500/10"
                          >
                            Cannot Complete / Flag Blocked
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === "in_progress" && (
                      <div className="space-y-3 pt-1">
                        <div className="rounded-lg border bg-blue-50/40 p-3 text-xs text-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
                          Task is in progress. When you have finished the deliverables, submit it for review by your
                          lead or administrator.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => setShowSubmitDialog(true)}
                            disabled={isSaving}
                            className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Submit Task for Review
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowUnableDialog(true)}
                            disabled={isSaving}
                            className="h-8 border-amber-500/30 text-xs text-amber-600 hover:bg-amber-500/10"
                          >
                            Unable to Complete
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === "submitted_for_review" && (
                      <div className="space-y-3 pt-1">
                        <div className="flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-500/10 p-3.5 text-xs text-purple-800 dark:text-purple-300">
                          <span>Task submitted for review. Waiting for department lead / admin approval.</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-purple-700 hover:bg-purple-500/20"
                            onClick={() => void onUpdateStatus("in_progress")}
                          >
                            Revert to In Progress
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === "completed" && (
                      <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                        <div>
                          <p className="font-semibold">Task Completed & Approved</p>
                          <p className="mt-0.5 text-[11px] opacity-90">
                            This task has been verified and KPI points recorded toward performance metrics.
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === "unable_to_complete" && (
                      <div className="space-y-3 pt-1">
                        <div className="flex items-center justify-between rounded-lg border border-orange-500/30 bg-orange-500/10 p-3.5 text-xs text-orange-800 dark:text-orange-300">
                          <div>
                            <p className="font-semibold">Issue Reported</p>
                            <p className="mt-0.5 text-[11px] opacity-90">
                              Lead / administrator will review the reported blocker, reassign, or extend deadline.
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-orange-700 hover:bg-orange-500/20"
                            onClick={() => void onUpdateStatus("in_progress")}
                          >
                            Resume Task
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Inline Form: Submit for Review */}
                    {showSubmitDialog && (
                      <div className="bg-muted/30 mt-3 space-y-2.5 rounded-lg border p-3.5">
                        <Label className="text-xs font-semibold">Completion Note / Deliverables (Optional)</Label>
                        <Textarea
                          value={submitComment}
                          onChange={(e) => setSubmitComment(e.target.value)}
                          placeholder="Add links, completion notes, or comments for the lead..."
                          className="bg-background min-h-[70px] text-xs"
                        />
                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSubmitDialog(false)}
                            className="h-8 text-xs"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleConfirmSubmitForReview}
                            disabled={isSaving}
                            className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                          >
                            Confirm Submission
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Inline Form: Unable to Complete */}
                    {showUnableDialog && (
                      <div className="mt-3 space-y-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
                        <Label className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                          Reason for being unable to complete *
                        </Label>
                        <Textarea
                          value={unableReason}
                          onChange={(e) => setUnableReason(e.target.value)}
                          placeholder="Explain the blocker, missing dependencies, or issue..."
                          className="bg-background min-h-[70px] text-xs"
                        />
                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowUnableDialog(false)}
                            className="h-8 text-xs"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleConfirmUnableToComplete}
                            disabled={isSaving || !unableReason.trim()}
                            className="h-8 text-xs"
                          >
                            Submit Issue Report
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: ACTIVITY HISTORY */}
              {activeTab === "activity" && (
                <div className="space-y-4">
                  <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                        <MessageSquare className="text-primary h-3.5 w-3.5" /> Activity & Updates Log
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {taskUpdates.length} {taskUpdates.length === 1 ? "entry" : "entries"}
                      </span>
                    </div>

                    {taskUpdates.length > 0 ? (
                      <div className="space-y-3">
                        {taskUpdates.map((update) => (
                          <div key={update.id} className="bg-muted/20 space-y-1 rounded-lg border p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-foreground text-xs font-medium">
                                {update.user ? formatFullName(update.user.first_name, update.user.last_name) : "System"}
                              </span>
                              <span className="text-muted-foreground font-mono text-[10px]">
                                {formatWATDateTime(update.created_at)}
                              </span>
                            </div>
                            <p className="text-muted-foreground text-xs leading-relaxed">{update.content}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="No updates yet"
                        description="Task comments and status changes will appear here."
                        icon={MessageSquare}
                        className="border-0 px-0 py-4"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Modal Footer */}
        <DialogFooter className="bg-muted/20 flex flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:px-6">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <span className="hidden sm:inline">Task ID:</span>
            <button
              type="button"
              onClick={() => handleCopy(selectedTask.id, "ID")}
              className="hover:text-foreground inline-flex items-center gap-1 font-mono transition-colors"
              title="Click to copy task ID"
            >
              <span>{selectedTask.id.slice(0, 8)}...</span>
              {copiedField === "ID" ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : (
                <Copy className="h-3 w-3 opacity-60" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
