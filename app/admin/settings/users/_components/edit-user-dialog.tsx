"use client"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormFieldGroup } from "@/components/ui/patterns"
import { AdminRoutesPicker } from "@/components/ui/admin-routes-picker"
import { getRoleOptions } from "../_lib/role-helpers"
import type { User } from "../_lib/queries"

interface EditUserFormData {
  role: string
  employment_status: string
  admin_routes: string[]
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

export function EditUserDialog({
  open,
  onOpenChange,
  editingUser,
  formData,
  onFormDataChange,
  onSubmit,
  currentUserRole,
}: EditUserDialogProps) {
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
                    admin_routes: v === "admin" ? formData.admin_routes : [],
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
              <FormFieldGroup label="Admin Routes">
                <AdminRoutesPicker
                  values={formData.admin_routes}
                  onChange={(routes) => onFormDataChange({ ...formData, admin_routes: routes })}
                />
                <p className="text-muted-foreground mt-1 text-xs">At least one route is required for admin users.</p>
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
