"use client"

import { useEffect, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api-client"
import type { Portfolio } from "./portfolios-content"

export function PortfolioDialog({
  open,
  onOpenChange,
  portfolio,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolio: Portfolio | null
  onSuccess: () => void
}) {
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"active" | "on_hold" | "closed">("active")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(portfolio?.name ?? "")
    setCode(portfolio?.code ?? "")
    setDescription(portfolio?.description ?? "")
    setStatus(portfolio?.status ?? "active")
  }, [open, portfolio])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error("Portfolio name is required")
      return
    }

    setIsSaving(true)
    try {
      const res = await apiFetch(portfolio ? `/api/portfolios/${portfolio.id}` : "/api/portfolios", {
        method: portfolio ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || null,
          description: description.trim() || null,
          status,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save portfolio")
      onSuccess()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save portfolio")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{portfolio ? "Edit Portfolio" : "Add Portfolio"}</DialogTitle>
          <DialogDescription>
            A portfolio groups related projects under one programme, client, or funding arrangement.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="portfolio-name" className="text-xs font-semibold">
              Portfolio Name *
            </Label>
            <Input
              id="portfolio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Minimum Subsidy Tender"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portfolio-code" className="text-xs font-semibold">
              Short Code
            </Label>
            <Input id="portfolio-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MST" />
            <p className="text-muted-foreground text-[11px]">
              Shown on project rows where the full name would not fit.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="portfolio-description" className="text-xs font-semibold">
              Description
            </Label>
            <Textarea
              id="portfolio-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[70px] text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portfolio-status" className="text-xs font-semibold">
              Status
            </Label>
            <select
              id="portfolio-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "on_hold" | "closed")}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : portfolio ? "Save Changes" : "Create Portfolio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
