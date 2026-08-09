"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/api-client"
import { formatWATDate } from "@/lib/utils/date"

interface LunchDeadlineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  menu: { id: string; date: string; voting_deadline: string | null } | null
  /** The lunch_settings time every menu follows unless overridden. */
  defaultDeadline: string
  onSaved: () => void
}

/** Reads the WAT "HH:MM" out of a stored absolute deadline. */
function deadlineTimeOf(votingDeadline: string | null): string | null {
  if (!votingDeadline) return null
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(votingDeadline))
}

/**
 * Moves one day's voting cut-off. Kept separate from the menu builder so the
 * deadline stays editable after votes exist — rebuilding the dishes is what is
 * unsafe then, not shifting the clock.
 */
export function LunchDeadlineDialog({ open, onOpenChange, menu, defaultDeadline, onSaved }: LunchDeadlineDialogProps) {
  const [saving, setSaving] = useState(false)
  const [time, setTime] = useState(defaultDeadline)

  useEffect(() => {
    if (!open || !menu) return
    setTime(deadlineTimeOf(menu.voting_deadline) ?? defaultDeadline)
  }, [open, menu, defaultDeadline])

  async function save(clear: boolean) {
    if (!menu) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/admin/hr/lunch/menus/${menu.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadline_time: clear ? null : time }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to change the deadline")

      toast.success(clear ? `Back to the ${defaultDeadline} default.` : `Voting now closes at ${time}.`)
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change the deadline")
    } finally {
      setSaving(false)
    }
  }

  const hasOverride = Boolean(menu?.voting_deadline)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Voting Deadline</DialogTitle>
          <DialogDescription>
            {menu
              ? `For ${formatWATDate(menu.date, { weekday: "long", day: "numeric", month: "long" })} only. Every other day stays on the ${defaultDeadline} setting.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="deadline-time">Voting closes at</Label>
          <Input
            id="deadline-time"
            type="time"
            value={time}
            className="w-40"
            onChange={(e) => setTime(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Pushing this later reopens voting for everyone if the old time has already passed.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          {hasOverride && (
            <Button variant="outline" onClick={() => void save(true)} disabled={saving}>
              Use the default
            </Button>
          )}
          <Button onClick={() => void save(false)} disabled={saving || !time}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save deadline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
