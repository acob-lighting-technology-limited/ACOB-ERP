"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/lib/tasks/constants"
import { TASK_RATING_LABELS, TASK_RATING_MAX, TASK_RATING_MIN, TASK_WEIGHT_DEFAULT } from "@/lib/tasks/scoring"
import type { Task } from "@/types/task"

/**
 * One control for the whole task lifecycle.
 *
 * Previously an employee moved a task by opening the details modal, switching
 * to a separate "My Actions" tab, clicking a button, watching the modal close,
 * then reopening it to take the next step — three round trips to finish one
 * task. Every state a person is allowed to move to is offered here at once, so
 * Pending → Submitted is a single choice.
 *
 * States that exist but are not available right now are still listed, disabled,
 * with the reason. Hiding them made the workflow feel arbitrary — a lead could
 * not see why "Reassign" had vanished.
 */

type StatusOption = {
  value: TaskStatus
  /** Why this option cannot be chosen, or null when it can. */
  blockedReason: string | null
  /** Extra input required before the change can be submitted. */
  requires?: "rating" | "reason"
}

/** What an assignee may do with their own task. */
const EMPLOYEE_TRANSITIONS: Record<string, TaskStatus[]> = {
  pending: ["in_progress", "submitted_for_review", "unable_to_complete"],
  in_progress: ["submitted_for_review", "unable_to_complete", "pending"],
  submitted_for_review: ["in_progress", "unable_to_complete"],
  unable_to_complete: ["in_progress", "submitted_for_review"],
  completed: [],
  reassigned: [],
  failed: [],
  cancelled: ["pending"],
}

/** Decisions only a reviewer (lead, admin, or the project's manager) may take. */
const REVIEWER_ONLY: TaskStatus[] = ["completed", "failed", "reassigned", "cancelled"]

const ORDERED_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "submitted_for_review",
  "completed",
  "unable_to_complete",
  "failed",
  "reassigned",
  "cancelled",
]

/** "Reject" is the label; `failed` is the stored value. */
export function statusLabel(status: string): string {
  if (status === "failed") return "Rejected"
  return TASK_STATUS_CONFIG[status as TaskStatus]?.label ?? status.replaceAll("_", " ")
}

export function TaskStatusControl({
  task,
  canReview,
  onChanged,
  size = "default",
  className,
}: {
  task: Task
  /** True for a department lead, an admin, or the manager of the task's project. */
  canReview: boolean
  onChanged: () => void | Promise<void>
  size?: "default" | "sm"
  className?: string
}) {
  const [isSaving, setIsSaving] = useState(false)
  const [pending, setPending] = useState<StatusOption | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState("")

  const current = String(task.status || "pending") as TaskStatus
  const isTerminal = current === "completed" || current === "reassigned"

  const options = useMemo<StatusOption[]>(() => {
    const allowedForEmployee = EMPLOYEE_TRANSITIONS[current] || []

    return ORDERED_STATUSES.filter((value) => value !== current).map((value) => {
      const reviewerOnly = REVIEWER_ONLY.includes(value)

      let blockedReason: string | null = null
      if (isTerminal) {
        blockedReason = `This task is ${statusLabel(current).toLowerCase()} and cannot be moved`
      } else if (reviewerOnly && !canReview) {
        blockedReason = "Only the lead or project manager can do this"
      } else if (!reviewerOnly && !canReview && !allowedForEmployee.includes(value)) {
        blockedReason = `Not available from ${statusLabel(current)}`
      }

      const requires: StatusOption["requires"] =
        value === "completed" ? "rating" : value === "failed" || value === "unable_to_complete" ? "reason" : undefined

      return { value, blockedReason, requires }
    })
  }, [canReview, current, isTerminal])

  async function submit(option: StatusOption, payloadExtras: Record<string, unknown> = {}) {
    setIsSaving(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: option.value, ...payloadExtras }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || "Failed to update the task")

      toast.success(`Moved to ${statusLabel(option.value)}`)
      setPending(null)
      setRating(null)
      setNote("")
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update the task")
    } finally {
      setIsSaving(false)
    }
  }

  function handleSelect(value: string) {
    const option = options.find((entry) => entry.value === value)
    if (!option || option.blockedReason) return

    // Rating and reason are collected in place; everything else applies at once.
    if (option.requires) {
      setPending(option)
      setRating(null)
      setNote("")
      return
    }
    void submit(option)
  }

  const weight = task.weight ?? TASK_WEIGHT_DEFAULT
  const config = TASK_STATUS_CONFIG[current]

  return (
    <>
      <Select value={current} onValueChange={handleSelect} disabled={isSaving || isTerminal}>
        <SelectTrigger
          className={cn(size === "sm" ? "h-8 text-xs" : "h-9 text-sm", "w-full min-w-[9.5rem]", className)}
          aria-label="Task status"
        >
          {isSaving ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving
            </span>
          ) : (
            <SelectValue placeholder="Status" />
          )}
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value={current} disabled>
            <span className={cn("font-medium", config?.color)}>{statusLabel(current)}</span>
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={Boolean(option.blockedReason)}
              title={option.blockedReason ?? undefined}
            >
              <span className="flex w-full items-center justify-between gap-3">
                <span>{statusLabel(option.value)}</span>
                {option.blockedReason && (
                  <span className="text-muted-foreground text-[10px] italic">{option.blockedReason}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {pending?.requires === "rating"
                ? "Approve and rate"
                : `Move to ${pending ? statusLabel(pending.value) : ""}`}
            </DialogTitle>
            <DialogDescription>
              {pending?.requires === "rating"
                ? "Approving a task records how well the work was done. This is what turns its weight into a score."
                : "A short reason is kept with the task so the decision can be understood later."}
            </DialogDescription>
          </DialogHeader>

          {pending?.requires === "rating" && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Performance rating *</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: TASK_RATING_MAX - TASK_RATING_MIN + 1 }, (_, i) => TASK_RATING_MIN + i).map(
                  (value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={rating === value ? "default" : "outline"}
                      size="sm"
                      className="h-auto flex-col gap-0.5 py-2"
                      onClick={() => setRating(value)}
                    >
                      <span className="text-sm font-semibold">{value}</span>
                      <span className="text-[10px] leading-tight opacity-80">{TASK_RATING_LABELS[value]}</span>
                    </Button>
                  )
                )}
              </div>
              <p className="text-muted-foreground text-[11px]">
                Weight {weight}, so this task is worth up to {weight} point{weight === 1 ? "" : "s"}
                {rating
                  ? ` — this rating earns ${Math.round(((weight * rating) / TASK_RATING_MAX) * 100) / 100}.`
                  : "."}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              {pending?.requires === "rating" ? "Approval note (optional)" : "Reason *"}
            </Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                pending?.requires === "rating"
                  ? "Anything worth recording about this work..."
                  : "Why is this happening?"
              }
              className="min-h-[70px] text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPending(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                isSaving ||
                (pending?.requires === "rating" && rating === null) ||
                (pending?.requires === "reason" && note.trim().length === 0)
              }
              onClick={() => {
                if (!pending) return
                void submit(pending, pending.requires === "rating" ? { rating, comment: note } : { reason: note })
              }}
            >
              {isSaving ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Status pill used wherever the value is shown rather than changed. */
export function TaskStatusBadge({ status }: { status: string }) {
  const config = TASK_STATUS_CONFIG[status as TaskStatus]
  return (
    <Badge variant={config?.badgeVariant ?? "outline"} className={cn("text-[11px]", config?.color)}>
      {statusLabel(status)}
    </Badge>
  )
}
