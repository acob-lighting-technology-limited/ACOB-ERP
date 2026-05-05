"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function AddPathDialog({
  onCreate,
}: {
  onCreate: (payload: { path_pattern: string; path_kind: "app" | "api"; methods: string[] }) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pathPattern, setPathPattern] = useState("/admin/custom%")
  const [pathKind, setPathKind] = useState<"app" | "api">("app")
  const [methods, setMethods] = useState("GET,POST,PUT,PATCH,DELETE")
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onCreate({
        path_pattern: pathPattern.trim(),
        path_kind: pathKind,
        methods: methods
          .split(",")
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean),
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add Path
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add Access Path</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Path Pattern</Label>
              <Input value={pathPattern} onChange={(e) => setPathPattern(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Path Kind</Label>
              <Select value={pathKind} onValueChange={(v) => setPathKind(v as "app" | "api")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="app">App</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Methods (comma-separated)</Label>
              <Input value={methods} onChange={(e) => setMethods(e.target.value)} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
