"use client"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormFieldGroup } from "@/components/ui/patterns"
import { getRoleOptions } from "../_lib/role-helpers"
import type { User } from "../_lib/queries"

interface EditUserFormData {
  role: string
  employment_status: string
  admin_domains: string[]
}

interface EditUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingUser: User | null
  formData: EditUserFormData
  onFormDataChange: (data: EditUserFormData) => void
  onSubmit: (e: React.FormEvent) => void
  currentUserRole: string
}

const ADMIN_DOMAIN_OPTIONS = ["hr", "finance", "assets", "reports", "tasks", "projects", "communications"] as const

export function EditUserDialog({
  open,
  onOpenChange,
  editingUser,
  formData,
  onFormDataChange,
  onSubmit,
  currentUserRole,
}: EditUserDialogProps) {
  function toggleAdminDomain(domain: string, checked: boolean) {
    onFormDataChange({
      ...formData,
      admin_domains: checked
        ? Array.from(new Set([...formData.admin_domains, domain]))
        : formData.admin_domains.filter((d) => d !== domain),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <FormFieldGroup label="User">
              <p className="text-muted-foreground text-sm">{editingUser?.email}</p>
            </FormFieldGroup>
            <FormFieldGroup label="Role">
              <Select
                value={formData.role}
                onValueChange={(v) =>
                  onFormDataChange({
                    ...formData,
                    role: v,
                    admin_domains: v === "admin" ? formData.admin_domains : [],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getRoleOptions(currentUserRole).map((role) => (
                    <SelectItem key={role} value={role}>
                      {role === "super_admin" ? "Super Admin" : role.charAt(0).toUpperCase() + role.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormFieldGroup>
            {formData.role === "admin" && (
              <FormFieldGroup label="Admin Domains">
                <div className="grid grid-cols-2 gap-2">
                  {ADMIN_DOMAIN_OPTIONS.map((domain) => {
                    const checked = formData.admin_domains.includes(domain)
                    return (
                      <label
                        key={domain}
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm capitalize"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleAdminDomain(domain, e.target.checked)}
                        />
                        {domain}
                      </label>
                    )
                  })}
                </div>
                <p className="text-muted-foreground text-xs">At least one domain is required for admin users.</p>
              </FormFieldGroup>
            )}
            <FormFieldGroup label="Employment Status">
              <div className="flex justify-end">
                <Select
                  value={formData.employment_status}
                  onValueChange={(v) => onFormDataChange({ ...formData, employment_status: v })}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="exited">Exited</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormFieldGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
