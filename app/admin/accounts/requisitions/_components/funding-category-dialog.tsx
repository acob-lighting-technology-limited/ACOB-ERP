"use client"

import React, { useEffect, useState } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { Loader2, AlertCircle } from "lucide-react"
import type { RequisitionFundingCategory } from "@/lib/requisitions/types"

interface FundingCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Category being edited, or null to create a new one. */
  category: RequisitionFundingCategory | null
  onSave: (payload: { name: string; description: string; sort_order: number }) => Promise<void>
  isSaving: boolean
  error: string | null
}

export function FundingCategoryDialog({
  open,
  onOpenChange,
  category,
  onSave,
  isSaving,
  error,
}: FundingCategoryDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [sortOrder, setSortOrder] = useState("100")

  useEffect(() => {
    if (!open) return
    setName(category?.name || "")
    setDescription(category?.description || "")
    setSortOrder(String(category?.sort_order ?? 100))
  }, [open, category])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsedOrder = Number.parseInt(sortOrder, 10)
    await onSave({
      name: name.trim(),
      description: description.trim(),
      sort_order: Number.isNaN(parsedOrder) ? 100 : parsedOrder,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "Edit Funding Category" : "New Funding Category"}</DialogTitle>
          <DialogDescription className="text-xs">
            Funding lines requesters pick from when raising a requisition — e.g. Citibank, AfDB.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. AfDB"
              required
              minLength={2}
              className="text-xs"
            />
            {!category && (
              <p className="text-muted-foreground text-[10px]">
                A short code is generated from the name and cannot be changed afterwards.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this funding line covers"
              rows={2}
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Sort Order</Label>
            <Input
              type="number"
              min={0}
              max={9999}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className="text-xs"
            />
            <p className="text-muted-foreground text-[10px]">Lower numbers appear first in the requisition form.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving || name.trim().length < 2}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : category ? (
                "Save Changes"
              ) : (
                "Create Category"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
