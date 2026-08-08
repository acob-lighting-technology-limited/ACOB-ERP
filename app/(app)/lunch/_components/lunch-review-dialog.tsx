"use client"

import { useEffect, useState } from "react"
import { Star } from "lucide-react"
import { toast } from "sonner"
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
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api-client"
import { formatWATDate } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

interface LunchReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  menuId: string | null
  date: string | null
  onSaved?: () => void
}

/**
 * Feedback on a past day's food. HR sees the rating and comment but never who
 * left it, so the dialog says so plainly — people only answer honestly if they
 * believe the anonymity.
 */
export function LunchReviewDialog({ open, onOpenChange, menuId, date, onSaved }: LunchReviewDialogProps) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !menuId) return
    setLoading(true)
    setRating(0)
    setComment("")
    void (async () => {
      try {
        const res = await apiFetch(`/api/hr/lunch/reviews?menu_id=${encodeURIComponent(menuId)}`)
        const payload = await res.json()
        const existing = (payload?.data || [])[0]
        if (existing) {
          setRating(Number(existing.rating) || 0)
          setComment(existing.comment || "")
        }
      } catch {
        // A missing prior review is the normal case — start blank.
      } finally {
        setLoading(false)
      }
    })()
  }, [open, menuId])

  async function handleSubmit() {
    if (!menuId) return
    if (rating < 1) {
      toast.error("Pick a rating from 1 to 5 stars")
      return
    }

    setSaving(true)
    try {
      const res = await apiFetch("/api/hr/lunch/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuId, rating, comment: comment.trim() || null }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to save your review")

      toast.success("Thanks — your feedback was sent anonymously")
      onOpenChange(false)
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save your review")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review this meal</DialogTitle>
          <DialogDescription>
            {date ? formatWATDate(date, { weekday: "long", day: "numeric", month: "long" }) : "Past meal"} — your rating
            and comment reach HR <span className="font-medium">without your name</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Rating</Label>
            <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHovered(value)}
                  onClick={() => setRating(value)}
                  disabled={loading}
                  className="p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
                >
                  <Star
                    className={cn(
                      "h-7 w-7",
                      (hovered || rating) >= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lunch-review-comment">Comment (optional)</Label>
            <Textarea
              id="lunch-review-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="What was good, what could be better?"
              className="min-h-[120px]"
              maxLength={2000}
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving} disabled={loading}>
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
