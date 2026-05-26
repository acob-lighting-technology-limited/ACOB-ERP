"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/ui/patterns"
import { Plus, Users } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"

export interface RoleMember {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  department: string | null
  employment_status: string | null
  created_at: string
}

interface RoleUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedRoleName: string
  roleUsers: RoleMember[]
  roleUsersLoading: boolean
  isAddUserInlineOpen: boolean
  onToggleAddUser: () => void
  availableUsers: RoleMember[]
  selectedUserId: string
  onUserSelect: (userId: string) => void
  addUserWarning: string | null
  addingUser: boolean
  onAddUserToRole: () => void
  onCancelAddUser: () => void
}

export function RoleUsersDialog({
  open,
  onOpenChange,
  selectedRoleName,
  roleUsers,
  roleUsersLoading,
  isAddUserInlineOpen,
  onToggleAddUser,
  availableUsers,
  selectedUserId,
  onUserSelect,
  addUserWarning,
  addingUser,
  onAddUserToRole,
  onCancelAddUser,
}: RoleUsersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="capitalize">{selectedRoleName.replace("_", " ")} Users</DialogTitle>
              <DialogDescription>Users currently assigned this role.</DialogDescription>
            </div>
            {selectedRoleName && (
              <Button size="sm" onClick={onToggleAddUser}>
                <Plus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            )}
          </div>
        </DialogHeader>

        {isAddUserInlineOpen && (
          <div className="space-y-3 rounded-md border p-3">
            <Label>Select User</Label>
            <Select value={selectedUserId} onValueChange={onUserSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Search or select a user..." />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.first_name || u.last_name
                      ? `${u.first_name || ""} ${u.last_name || ""}`.trim()
                      : u.company_email || "Unnamed user"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {addUserWarning && <p className="text-muted-foreground text-xs">{addUserWarning}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancelAddUser}>
                Cancel
              </Button>
              <Button onClick={onAddUserToRole} disabled={!selectedUserId || addingUser}>
                {addingUser ? "Adding..." : "Confirm"}
              </Button>
            </div>
          </div>
        )}

        {roleUsersLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"></div>
          </div>
        ) : roleUsers.length === 0 ? (
          <EmptyState title="No users in this role" icon={Users} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-foreground w-14 font-bold">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roleUsers.map((member, index) => (
                  <TableRow key={member.id}>
                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-medium">
                      {member.first_name || member.last_name
                        ? `${member.first_name || ""} ${member.last_name || ""}`.trim()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.company_email || "—"}</TableCell>
                    <TableCell>{member.department || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={member.employment_status === "active" ? "default" : "secondary"}>
                        {member.employment_status || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatWATDate(member.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
