"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, AlertTriangle, Clock, UserCheck, RotateCcw, XCircle, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { Badge } from "@/components/ui/badge"
import type { Task } from "@/types/task"
import { apiFetch } from "@/lib/api-client"
import { formatFullName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import {
  TASK_RATING_LABELS,
  TASK_RATING_MAX,
  TASK_RATING_MIN,
  TASK_WEIGHT_DEFAULT,
  isValidRating,
} from "@/lib/tasks/scoring"

export interface TaskReviewEmployee {
  id: string
  first_name: string
  last_name: string
  department: string
}

interface TaskReviewDecisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
  assignableEmployees: TaskReviewEmployee[]
  onSuccess: () => void
}

type DecisionId = "approve" | "rework" | "reassign" | "fail" | "extend"

const DECISIONS: Array<{
  id: DecisionId
  label: string
  description: string
  unavailableReason: string
  icon: typeof CheckCircle2
  className: string
  available: (task: Task) => boolean
}> = [
  {
    id: "approve",
    label: "Approve & Complete",
    description: "Accept the work and rate it — this is what turns its weight into a score.",
    unavailableReason: "Only work that has been submitted can be approved.",
    icon: CheckCircle2,
    className: "border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
    available: (task) => task.status === "submitted_for_review",
  },
  {
    id: "rework",
    label: "Return for Changes",
    description: "Send it back to the assignee with instructions. Still open, not yet scored.",
    unavailableReason: "There is nothing to return until the work is submitted or reported blocked.",
    icon: RotateCcw,
    className: "border-purple-500/30 text-purple-700 hover:bg-purple-500/10 dark:text-purple-400",
    available: (task) => ["submitted_for_review", "unable_to_complete", "in_progress"].includes(task.status),
  },
  {
    id: "reassign",
    label: "Reassign",
    description: "Move the work to someone else. Neutral for the original assignee's score.",
    unavailableReason: "This task is already closed.",
    icon: UserCheck,
    className: "border-sky-500/30 text-sky-700 hover:bg-sky-500/10 dark:text-sky-400",
    available: (task) => !["completed", "reassigned", "cancelled"].includes(task.status),
  },
  {
    id: "extend",
    label: "Extend Deadline",
    description: "Give more time, with a reason kept on the task.",
    unavailableReason: "This task is already closed.",
    icon: Calendar,
    className: "border-blue-500/30 text-blue-700 hover:bg-blue-500/10 dark:text-blue-400",
    available: (task) => !["completed", "reassigned", "cancelled"].includes(task.status),
  },
  {
    id: "fail",
    label: "Reject",
    description: "Terminal. The task scores zero at its full weight.",
    unavailableReason: "This task is already closed.",
    icon: XCircle,
    className: "border-rose-500/30 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400",
    available: (task) => !["completed", "reassigned", "cancelled"].includes(task.status),
  },
]

export function TaskReviewDecisionDialog({
  open,
  onOpenChange,
  task,
  assignableEmployees,
  onSuccess,
}: TaskReviewDecisionDialogProps) {
  const [actionType, setActionType] = useState<DecisionId | null>(null)
  const [comment, setComment] = useState("")
  const [newAssignee, setNewAssignee] = useState("")
  const [newDueDate, setNewDueDate] = useState("")
  const [rating, setRating] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!task) return null

  const isUnableToComplete = task.status === "unable_to_complete"

  const employeeOptions = assignableEmployees
    .filter((e) => e.id !== task.assigned_to)
    .map((e) => ({
      value: e.id,
      label: `${formatFullName(e.first_name, e.last_name)} (${e.department})`,
    }))

  const handleReset = () => {
    setActionType(null)
    setComment("")
    setNewAssignee("")
    setNewDueDate("")
    setRating(null)
  }

  const handleSubmitDecision = async () => {
    if (!actionType) return
    setIsSubmitting(true)

    try {
      let payload: Record<string, unknown> = {}

      if (actionType === "approve") {
        // Approval and rating are one action — a task cannot be completed
        // unrated, because the rating is what turns its weight into a score.
        if (!isValidRating(rating)) {
          toast.error("Select a performance rating before approving this task")
          setIsSubmitting(false)
          return
        }
        payload = {
          status: "completed",
          rating,
          comment: comment || "Approved by department lead/admin",
        }
      } else if (actionType === "rework") {
        payload = {
          status: "in_progress",
          comment: comment || "Returned to the assignee for changes",
        }
      } else if (actionType === "reassign") {
        if (!newAssignee) {
          toast.error("Please select a new assignee to reassign this task")
          setIsSubmitting(false)
          return
        }
        payload = {
          status: "reassigned",
          reassigned_to: newAssignee,
          reason: comment || "Reassigned by lead/admin",
          due_date: newDueDate || task.due_date || null,
        }
      } else if (actionType === "fail") {
        payload = {
          status: "failed",
          reason: comment || "Rejected by lead/admin",
        }
      } else if (actionType === "extend") {
        if (!newDueDate) {
          toast.error("Please specify a new due date")
          setIsSubmitting(false)
          return
        }
        payload = {
          status: "in_progress",
          due_date: newDueDate,
          extension_reason: comment || "Deadline extended by lead/admin",
        }
      }

      const res = await apiFetch(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit decision")
      }

      toast.success("Task decision recorded successfully")
      handleReset()
      onOpenChange(false)
      onSuccess()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record decision")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => {
        if (!v) handleReset()
        onOpenChange(v)
      }}
      title="Task Review & Governance"
      description="Review task status, grant approvals, reassign, or extend timelines."
      desktopClassName="max-w-xl"
    >
      <div className="space-y-4 pt-2">
        {/* Task Summary Card */}
        <div className="bg-muted/40 space-y-2 rounded-lg border p-3.5 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-foreground font-semibold">{task.title}</p>
              {task.description && (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{task.description}</p>
              )}
            </div>
            <Badge variant="outline" className="shrink-0 capitalize">
              {task.status.replaceAll("_", " ")}
            </Badge>
          </div>

          <div className="text-muted-foreground grid grid-cols-2 gap-2 pt-1 text-xs">
            <div>
              <span className="text-foreground font-medium">Assignee: </span>
              {task.assigned_to_user
                ? formatFullName(task.assigned_to_user.first_name, task.assigned_to_user.last_name)
                : "Unassigned"}
            </div>
            <div>
              <span className="text-foreground font-medium">Due Date: </span>
              {task.due_date ? formatWATDate(task.due_date) : "None"}
            </div>
            {task.goal_title && (
              <div className="col-span-2">
                <span className="text-foreground font-medium">Goal: </span>
                {task.goal_title}
              </div>
            )}
          </div>

          {isUnableToComplete && task.unable_to_complete_reason && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span className="mb-0.5 block font-semibold">Reported Issue / Reason:</span>
              {task.unable_to_complete_reason}
            </div>
          )}
        </div>

        {/* Decision dropdown */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Decision / Action</Label>
          <Select
            value={actionType ?? ""}
            onValueChange={(val) => {
              setActionType(val as DecisionId)
              setComment("")
              setRating(null)
              setNewAssignee("")
              setNewDueDate("")
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a decision..." />
            </SelectTrigger>
            <SelectContent>
              {DECISIONS.map((decision) => {
                const blockedReason = decision.available(task) ? null : decision.unavailableReason
                return (
                  <SelectItem key={decision.id} value={decision.id} disabled={Boolean(blockedReason)}>
                    {decision.label}
                    {blockedReason ? ` (${blockedReason})` : ""}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {actionType && (
            <p className="text-muted-foreground text-[11px]">
              {DECISIONS.find((d) => d.id === actionType)?.description}
            </p>
          )}
        </div>

        {/* Selected Action Form */}
        {actionType && (
          <div className="space-y-3 rounded-lg border p-3.5">
            {actionType === "reassign" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">New Assignee *</Label>
                <SearchableSelect
                  options={employeeOptions}
                  value={newAssignee}
                  onValueChange={setNewAssignee}
                  placeholder="Select new team member..."
                />
              </div>
            )}

            {(actionType === "extend" || actionType === "reassign") && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">New Due Date {actionType === "extend" && "*"}</Label>
                <Input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="text-xs"
                />
              </div>
            )}

            {actionType === "approve" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Performance Rating *</Label>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
                  {Array.from({ length: TASK_RATING_MAX - TASK_RATING_MIN + 1 }, (_, i) => TASK_RATING_MIN + i).map(
                    (value) => (
                      <Button
                        key={value}
                        type="button"
                        variant={rating === value ? "default" : "outline"}
                        size="sm"
                        className="h-auto w-full min-w-0 flex-col gap-0.5 px-1 py-2 text-center whitespace-normal"
                        onClick={() => setRating(value)}
                      >
                        <span className="text-sm font-semibold">{value}</span>
                        <span className="w-full text-[10px] leading-tight text-balance opacity-80">
                          {TASK_RATING_LABELS[value]}
                        </span>
                      </Button>
                    )
                  )}
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {`Worth up to ${task.weight ?? TASK_WEIGHT_DEFAULT} points toward the assignee's KPI score (task weight ${task.weight ?? TASK_WEIGHT_DEFAULT})`}
                  {rating
                    ? ` — this rating earns ${Math.round((((task.weight ?? TASK_WEIGHT_DEFAULT) * rating) / TASK_RATING_MAX) * 100) / 100}.`
                    : "."}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {actionType === "approve"
                  ? "Approval Note (Optional)"
                  : actionType === "rework"
                    ? "Rework Instructions *"
                    : actionType === "fail"
                      ? "Reason for rejection *"
                      : actionType === "extend"
                        ? "Extension Reason *"
                        : "Reassignment Note"}
              </Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Enter notes or explanation for audit log..."
                className="min-h-[70px] text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleReset} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSubmitDecision} disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Confirm Decision"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ResponsiveModal>
  )
}
