"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormFieldGroup } from "@/components/ui/patterns"
import { Mail, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { QUERY_KEYS } from "@/lib/query-keys"
import type { QueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api-client"

const log = logger("settings-users-invite-dialog")

interface InviteUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleOptions: string[]
  queryClient?: QueryClient
}

export function InviteUserDialog({ open, onOpenChange, roleOptions, queryClient }: InviteUserDialogProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [formData, setFormData] = useState({
    email: "",
    first_name: "",
    last_name: "",
    role: roleOptions[0] || "employee",
    department: "",
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.email) return toast.error("Email is required")

    setSending(true)
    try {
      const response = await apiFetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to invite user")

      toast.success(`Invitation sent to ${formData.email}`)
      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminUsersSettings() })
      onOpenChange(false)
      router.refresh()
    } catch (error: unknown) {
      log.error("Error inviting user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to invite user")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite User
          </DialogTitle>
          <DialogDescription>Send an invitation to a new team member without leaving this page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormFieldGroup label="Email Address *">
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="user@company.com"
              required
            />
          </FormFieldGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormFieldGroup label="First Name">
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                placeholder="First name"
              />
            </FormFieldGroup>
            <FormFieldGroup label="Last Name">
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                placeholder="Last name"
              />
            </FormFieldGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormFieldGroup label="Role">
              <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role === "super_admin" ? "Super Admin" : role.charAt(0).toUpperCase() + role.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormFieldGroup>
            <FormFieldGroup label="Department">
              <Input
                id="department"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                placeholder="e.g., Engineering"
              />
            </FormFieldGroup>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending}>
              <Mail className="mr-2 h-4 w-4" />
              Send Invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
