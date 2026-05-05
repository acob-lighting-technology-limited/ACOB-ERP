"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ModuleCode } from "@/types/governance"

export function AddWorkflowDialog({
  onCreate,
}: {
  onCreate: (payload: { name: string; module_code: ModuleCode; requester_kind: string }) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [moduleCode, setModuleCode] = useState<ModuleCode>("leave")
  const [requesterKind, setRequesterKind] = useState("employee")
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), module_code: moduleCode, requester_kind: requesterKind.trim() || "employee" })
      setOpen(false)
      setName("")
      setModuleCode("leave")
      setRequesterKind("employee")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add Workflow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add Workflow</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" required />
            </div>
            <div className="space-y-2">
              <Label>Module</Label>
              <Select value={moduleCode} onValueChange={(v) => setModuleCode(v as ModuleCode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select module" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leave">Leave</SelectItem>
                  <SelectItem value="help_desk">Help Desk</SelectItem>
                  <SelectItem value="correspondence">Correspondence</SelectItem>
                  <SelectItem value="pms_goal_setting">PMS Goal Setting</SelectItem>
                  <SelectItem value="pms_kpi_scoring">PMS KPI Scoring</SelectItem>
                  <SelectItem value="pms_review">PMS Review</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="resource_booking">Resource Booking</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Requester Kind</Label>
              <Input value={requesterKind} onChange={(e) => setRequesterKind(e.target.value)} required />
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
