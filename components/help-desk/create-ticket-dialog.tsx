"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { ArrowUpRight, Plus } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo } from "react"

export interface CreateTicketForm {
  title: string
  description: string
  service_department: string
  priority: string
  request_type: string
}

interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: CreateTicketForm
  onFormChange: (form: CreateTicketForm) => void
  onSubmit: (e: React.FormEvent) => void
  isSaving: boolean
  departmentOptions: string[]
  userDepartment: string | null
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSubmit,
  isSaving,
  departmentOptions,
  userDepartment,
}: CreateTicketDialogProps) {
  const availableDepartmentOptions = useMemo(
    () => departmentOptions.filter((department) => !(userDepartment && department === userDepartment)),
    [departmentOptions, userDepartment]
  )

  useEffect(() => {
    if (availableDepartmentOptions.length === 0) return
    if (availableDepartmentOptions.includes(form.service_department)) return
    onFormChange({ ...form, service_department: availableDepartmentOptions[0] || "" })
  }, [availableDepartmentOptions, form, onFormChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">New Ticket</span>
          <span className="sm:hidden">Ticket</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Submit Help Desk Ticket</DialogTitle>
            <ItemInfoButton
              title="Help desk workflow guide"
              summary="Help desk tickets are requests sent to another department for support, review, assignment, and resolution."
              details={[
                {
                  label: "What you are creating",
                  value:
                    "This ticket tells another department what support, fix, purchase, or action you need from them.",
                },
                {
                  label: "What happens after submission",
                  value:
                    "The receiving department reviews it, approves or assigns it, works on it, and updates the ticket until it is resolved or closed.",
                },
                {
                  label: "How to avoid delays",
                  value:
                    "Write the issue clearly, pick the correct department, and include enough detail so the next handler can act without chasing basic context.",
                },
              ]}
            />
          </div>
          <DialogDescription>Fill in the details and submit your ticket.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => onFormChange({ ...form, title: e.target.value })}
              placeholder="Brief summary of issue"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => onFormChange({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Select
              value={form.service_department}
              onValueChange={(value) => onFormChange({ ...form, service_department: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableDepartmentOptions.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {userDepartment && (
              <p className="text-muted-foreground text-xs">Your department ({userDepartment}) is excluded.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={form.priority} onValueChange={(value) => onFormChange({ ...form, priority: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={form.request_type} onValueChange={(value) => onFormChange({ ...form, request_type: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="procurement">Procurement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.request_type === "procurement" && (
            <div className="border-primary/30 bg-primary/5 text-foreground rounded-lg border p-3 text-sm md:col-span-2">
              <p className="font-medium">Procurement runs through a requisition</p>
              <p className="text-muted-foreground mt-1">
                Raising a requisition captures the amount, beneficiaries and funding category, and routes it for
                approval. Use that form instead of a help desk ticket.
              </p>
              <Link
                href="/requisition"
                className="text-primary mt-2 inline-flex items-center gap-1 font-medium hover:underline"
              >
                Go to Requisitions
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Submitting..." : "Submit Ticket"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
