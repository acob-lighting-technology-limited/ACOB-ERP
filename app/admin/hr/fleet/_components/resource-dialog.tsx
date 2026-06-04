"use client"

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

type ResourceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceName: string
  onResourceNameChange: (value: string) => void
  resourceType: string
  onResourceTypeChange: (value: string) => void
  resourceDescription: string
  onResourceDescriptionChange: (value: string) => void
  savingResource: boolean
  onCreateResource: () => void
}

export function ResourceDialog({
  open,
  onOpenChange,
  resourceName,
  onResourceNameChange,
  resourceType,
  onResourceTypeChange,
  resourceDescription,
  onResourceDescriptionChange,
  savingResource,
  onCreateResource,
}: ResourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Resource</DialogTitle>
          <DialogDescription>Create additional bookable items for shared resource booking.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={resourceName}
              onChange={(event) => onResourceNameChange(event.target.value)}
              placeholder="Delivery Car"
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Input
              value={resourceType}
              onChange={(event) => onResourceTypeChange(event.target.value)}
              placeholder="vehicle"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={resourceDescription}
              onChange={(event) => onResourceDescriptionChange(event.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={savingResource}>
            Cancel
          </Button>
          <Button onClick={onCreateResource} disabled={savingResource || resourceName.trim().length < 2}>
            {savingResource ? "Saving..." : "Create Resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
