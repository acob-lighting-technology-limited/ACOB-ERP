"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, AlertTriangle, Clock, UserCheck, RotateCcw, XCircle, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { Badge } from "@/components/ui/badge"
import type { Task } from "@/types/task"
import { formatFullName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"

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

export function TaskReviewDecisionDialog({
  open,
  onOpenChange,
  task,
  assignableEmployees,
  onSuccess,
}: TaskReviewDecisionDialogProps) {
  const [actionType, setActionType] = useState<"approve" | "rework" | "reassign" | "fail" | "extend" | null>(null)
  const [comment, setComment] = useState("")
  const [newAssignee, setNewAssignee] = useState("")
  const [newDueDate, setNewDueDate] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!task) return null

  const isSubmitted = task.status === "submitted_for_review"
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
  }

  const handleSubmitDecision = async () => {
    if (!actionType) return
    setIsSubmitting(true)

    try {
      let payload: Record<string, unknown> = {}

      if (actionType === "approve") {
        payload = {
          status: "completed",
          comment: comment || "Approved by department lead/admin",
        }
      } else if (actionType === "rework") {
        payload = {
          status: "in_progress",
          comment: comment || "Returned to in progress for rework",
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
          reason: comment || "Marked as failed/incomplete by lead/admin",
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

      const res = await fetch(`/api/tasks/${task.id}/status`, {
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

        {/* Action Selection Buttons */}
        {!actionType && (
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Select Decision / Action
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {isSubmitted && (
                <>
                  <Button
                    variant="outline"
                    className="justify-start gap-2 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    onClick={() => setActionType("approve")}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve & Complete
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2 border-purple-500/30 text-purple-700 hover:bg-purple-500/10 dark:text-purple-400"
                    onClick={() => setActionType("rework")}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Request Rework
                  </Button>
                </>
              )}

              {isUnableToComplete && (
                <>
                  <Button
                    variant="outline"
                    className="justify-start gap-2 border-sky-500/30 text-sky-700 hover:bg-sky-500/10 dark:text-sky-400"
                    onClick={() => setActionType("reassign")}
                  >
                    <UserCheck className="h-4 w-4" />
                    Reassign (Neutral for KPI)
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2 border-rose-500/30 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
                    onClick={() => setActionType("fail")}
                  >
                    <XCircle className="h-4 w-4" />
                    Mark as Failed (Hurts KPI)
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                className="justify-start gap-2 border-blue-500/30 text-blue-700 hover:bg-blue-500/10 sm:col-span-2 dark:text-blue-400"
                onClick={() => setActionType("extend")}
              >
                <Calendar className="h-4 w-4" />
                Grant Time Extension
              </Button>
            </div>
          </div>
        )}

        {/* Selected Action Form */}
        {actionType && (
          <div className="space-y-3 rounded-lg border p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold capitalize">
                Action: {actionType === "extend" ? "Grant Time Extension" : actionType}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setActionType(null)} className="h-7 text-xs">
                Change Action
              </Button>
            </div>

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

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {actionType === "approve"
                  ? "Approval Note (Optional)"
                  : actionType === "rework"
                    ? "Rework Instructions *"
                    : actionType === "fail"
                      ? "Failure Reason *"
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
