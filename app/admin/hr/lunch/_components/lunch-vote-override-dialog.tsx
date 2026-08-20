"use client"

import { useEffect, useMemo, useState } from "react"
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
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiFetch } from "@/lib/api-client"
import { formatWATDate } from "@/lib/utils/date"
import { groupHeading, type LunchMenu, type LunchVoteRecord } from "@/lib/hr/lunch-voting"

interface LunchVoteOverrideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  menu: (LunchMenu & { votes: LunchVoteRecord[] }) | null
  employees: { id: string; full_name: string }[]
  defaultUserId?: string | null
  onSaved: () => void
}

type Answer = "eating" | "not_eating" | "none"

/**
 * Sets a staff member's answer on their behalf, ignoring the voting deadline.
 * This is the after-the-fact correction path — somebody travelled, somebody
 * turned up unannounced — and it keeps the lunch register in step so payroll
 * matches what actually happened.
 */
export function LunchVoteOverrideDialog({
  open,
  onOpenChange,
  menu,
  employees,
  defaultUserId,
  onSaved,
}: LunchVoteOverrideDialogProps) {
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState(defaultUserId || "")
  const [answer, setAnswer] = useState<Answer>("eating")
  const [selections, setSelections] = useState<Record<string, string>>({})

  const existingVote = useMemo(
    () => (menu && userId ? menu.votes.find((v) => v.user_id === userId) : undefined),
    [menu, userId]
  )

  // Seed from whatever the person already answered, so an edit starts from
  // their current choice rather than a blank form.
  useEffect(() => {
    if (!existingVote) {
      setAnswer("eating")
      setSelections({})
      return
    }
    setAnswer(existingVote.is_eating ? "eating" : "not_eating")
    setSelections(existingVote.selections)
  }, [existingVote])

  useEffect(() => {
    if (open) {
      if (defaultUserId) {
        setUserId(defaultUserId)
      }
    } else {
      setUserId("")
      setAnswer("eating")
      setSelections({})
    }
  }, [open, defaultUserId])

  const missing = menu && answer === "eating" ? menu.groups.filter((g) => g.is_required && !selections[g.id]) : []

  async function save() {
    if (!menu || !userId) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/admin/hr/lunch/menus/${menu.id}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          eating: answer === "none" ? null : answer === "eating",
          selections: answer === "eating" ? selections : {},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update that vote")

      toast.success(
        answer === "none"
          ? "Their vote was removed."
          : answer === "eating"
            ? "Their choice was set."
            : "Marked as not eating."
      )
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update that vote")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change Someone&apos;s Answer</DialogTitle>
          <DialogDescription>
            {menu
              ? `For ${formatWATDate(menu.date, { weekday: "long", day: "numeric", month: "long" })}. This works after the deadline and updates the lunch register, so payroll follows.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-2">
            <Label>Staff member</Label>
            <SearchableSelect
              options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
              value={userId}
              onValueChange={setUserId}
              placeholder="Search staff…"
            />
            {existingVote && (
              <p className="text-muted-foreground text-xs">
                Currently: {existingVote.is_eating ? "eating" : "not eating"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Answer</Label>
            <Select value={answer} onValueChange={(v) => setAnswer(v as Answer)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eating">Eating — pick their dishes</SelectItem>
                <SelectItem value="not_eating">Not eating (NO)</SelectItem>
                <SelectItem value="none">Remove their vote entirely</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {answer === "eating" &&
            menu?.groups.map((group, index) => (
              <div key={group.id} className="space-y-2">
                <Label>{menu.groups.length > 1 ? groupHeading(group, index) : "Dish"}</Label>
                <Select
                  value={selections[group.id] || ""}
                  onValueChange={(v) => setSelections((prev) => ({ ...prev, [group.id]: v }))}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {group.options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !userId || missing.length > 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save answer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
