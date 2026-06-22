"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Lock, Shield, Users } from "lucide-react"
import { toast } from "sonner"
import { DepartmentLeadsManager } from "@/components/admin/department-leads-manager"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ASSIGNABLE_ROLES } from "@/lib/role-management"
import { RoleFormDialog } from "./_components/role-form-dialog"
import { RoleUsersDialog } from "./_components/role-users-dialog"
import { DEFAULT_ROLES, fetchRolesData } from "./_components/roles-data"
import type { Role, RoleFormData } from "./_components/role-form-dialog"
import type { RoleMember } from "./_components/role-users-dialog"

import { logger } from "@/lib/logger"

const log = logger("settings-roles")

export default function RolesPage() {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [formData, setFormData] = useState<RoleFormData>({ name: "", description: "", permissions: [] })
  const [roleUsersOpen, setRoleUsersOpen] = useState(false)
  const [selectedRoleName, setSelectedRoleName] = useState<string>("")
  const [roleUsers, setRoleUsers] = useState<RoleMember[]>([])
  const [roleUsersLoading, setRoleUsersLoading] = useState(false)
  const [isAddUserInlineOpen, setIsAddUserInlineOpen] = useState(false)
  const [availableUsers, setAvailableUsers] = useState<RoleMember[]>([])
  const [selectedUserId, setSelectedUserId] = useState("")
  const [addUserWarning, setAddUserWarning] = useState<string | null>(null)
  const [addingUser, setAddingUser] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null)
  const [isDeletingRole, setIsDeletingRole] = useState(false)

  const { data: roles = DEFAULT_ROLES, isLoading: loading } = useQuery({
    queryKey: QUERY_KEYS.adminRolesSettings(),
    queryFn: fetchRolesData,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const supabase = createClient()
      if (editingRole) {
        const { error } = await supabase
          .from("roles")
          .update({ name: formData.name, description: formData.description || null, permissions: formData.permissions })
          .eq("id", editingRole.id)
        if (error) throw error
        toast.success("Role updated")
      } else {
        const { error } = await supabase.from("roles").insert({
          name: formData.name,
          description: formData.description || null,
          permissions: formData.permissions,
          is_system: false,
        })
        if (error) throw error
        toast.success("Role created")
      }
      setIsDialogOpen(false)
      setEditingRole(null)
      setFormData({ name: "", description: "", permissions: [] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminRolesSettings() })
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((error as any)?.message || "Failed to save")
    }
  }

  async function handleDelete(role: Role) {
    if (role.is_system) {
      toast.error("Cannot delete system roles")
      return
    }
    try {
      const supabase = createClient()
      const { error } = await supabase.from("roles").delete().eq("id", role.id)
      if (error) throw error
      toast.success("Deleted")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminRolesSettings() })
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((error as any)?.message)
    }
  }

  function openEdit(role: Role) {
    setEditingRole(role)
    setFormData({ name: role.name, description: role.description || "", permissions: role.permissions || [] })
    setIsDialogOpen(true)
  }

  function openCreate() {
    setEditingRole(null)
    setFormData({ name: "", description: "", permissions: [] })
    setIsDialogOpen(true)
  }

  async function openRoleUsers(roleName: string) {
    setSelectedRoleName(roleName)
    setRoleUsers([])
    setRoleUsersOpen(true)
    setRoleUsersLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, company_email, department, employment_status, created_at")
        .eq("role", roleName)
        .order("first_name", { ascending: true })
      if (error) throw error
      setRoleUsers((data || []) as RoleMember[])
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((error as any)?.message || "Failed to load role users")
    } finally {
      setRoleUsersLoading(false)
    }
  }

  async function fetchAllUsersForRoleModal() {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, company_email, department, employment_status, created_at")
        .order("first_name", { ascending: true })
      if (error) throw error
      setAvailableUsers((data || []) as RoleMember[])
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((error as any)?.message || "Failed to load users")
    }
  }

  function handleUserSelect(userId: string) {
    setSelectedUserId(userId)
    const user = availableUsers.find((u) => u.id === userId)
    if (!user) return
    if (roleUsers.some((u) => u.id === userId)) {
      setAddUserWarning("This user already has this role.")
      return
    }
    setAddUserWarning(`User will be assigned to "${selectedRoleName.replace("_", " ")}".`)
  }

  async function handleAddUserToRole() {
    if (!selectedRoleName || !selectedUserId) return
    setAddingUser(true)
    try {
      const response = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: selectedUserId, role: selectedRoleName }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Failed to assign role")
      toast.success("User added to role")
      setSelectedUserId("")
      setAddUserWarning(null)
      setIsAddUserInlineOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminRolesSettings() })
      await openRoleUsers(selectedRoleName)
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((error as any)?.message || "Failed to add user")
    } finally {
      setAddingUser(false)
    }
  }

  const stats = {
    total: roles.filter((role) => !(role.is_system && !ASSIGNABLE_ROLES.includes(role.name as never))).length,
    system: roles.filter((role) => role.is_system && ASSIGNABLE_ROLES.includes(role.name as never)).length,
    custom: roles.filter((role) => !role.is_system).length,
  }

  const visibleRoles = roles.filter((role) => {
    if (role.is_system && !ASSIGNABLE_ROLES.includes(role.name as never)) return false
    return role.name !== "manager"
  })

  log.debug("Rendering roles page", { total: roles.length, visible: visibleRoles.length })

  const roleTypeOptions = [
    { value: "System", label: "System" },
    { value: "Custom", label: "Custom" },
  ]

  const permissionBandOptions = [
    { value: "0-3", label: "0-3" },
    { value: "4-8", label: "4-8" },
    { value: "9+", label: "9+" },
  ]

  const columns: DataTableColumn<Role>[] = [
    {
      key: "name",
      label: "Role",
      sortable: true,
      accessor: (role) => role.name,
      render: (role) => <span className="font-medium capitalize">{role.name.replace(/_/g, " ")}</span>,
      resizable: true,
      initialWidth: 180,
    },
    {
      key: "description",
      label: "Description",
      sortable: true,
      accessor: (role) => role.description || "",
      resizable: true,
      initialWidth: 260,
      hideOnMobile: true,
      render: (role) => <span className="text-muted-foreground">{role.description || "No description"}</span>,
    },
    {
      key: "permissions_count",
      label: "Permissions",
      sortable: true,
      accessor: (role) => role.permissions?.length || 0,
      align: "center",
      hideOnMobile: true,
      render: (role) => <Badge variant="secondary">{role.permissions?.length || 0}</Badge>,
    },
    {
      key: "user_count",
      label: "Users",
      sortable: true,
      accessor: (role) => role.user_count || 0,
      align: "center",
      render: (role) => (
        <Button variant="ghost" size="sm" className="h-auto p-0" onClick={() => openRoleUsers(role.name)}>
          <Users className="mr-1 h-4 w-4" />
          {role.user_count || 0}
        </Button>
      ),
    },
    {
      key: "role_type",
      label: "Type",
      sortable: true,
      accessor: (role) => (role.is_system ? "System" : "Custom"),
      render: (role) => (
        <Badge variant={role.is_system ? "destructive" : "outline"}>{role.is_system ? "System" : "Custom"}</Badge>
      ),
    },
  ]

  const filters: DataTableFilter<Role>[] = [
    {
      key: "role_type",
      label: "Type",
      options: roleTypeOptions,
    },
    {
      key: "permission_band",
      label: "Permission Count",
      mode: "custom",
      options: permissionBandOptions,
      filterFn: (role, value) => {
        const count = role.permissions?.length || 0
        const evaluate = (entry: string) => {
          if (entry === "0-3") return count <= 3
          if (entry === "4-8") return count >= 4 && count <= 8
          if (entry === "9+") return count >= 9
          return false
        }
        if (Array.isArray(value)) return value.some(evaluate)
        return evaluate(value)
      },
    },
  ]

  return (
    <DataTablePage
      title="Roles & Permissions"
      description="Configure access control for your organization."
      icon={Shield}
      backLink={{ href: "/admin/settings", label: "Back to Settings" }}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Roles"
            value={stats.total}
            icon={Shield}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="System Roles"
            value={stats.system}
            icon={Lock}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Custom Roles"
            value={stats.custom}
            icon={Users}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Visible Roles"
            value={visibleRoles.length}
            icon={Shield}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
      actions={
        <RoleFormDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          editingRole={editingRole}
          formData={formData}
          onFormDataChange={setFormData}
          onSubmit={handleSubmit}
          onOpenCreate={openCreate}
        />
      }
    >
      <DataTable<Role>
        data={visibleRoles}
        columns={columns}
        filters={filters}
        getRowId={(role) => role.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search role name or description..."
        searchFn={(role, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            role.name.toLowerCase().includes(normalizedQuery) ||
            (role.description || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={loading}
        rowActions={[
          {
            label: "Edit",
            onClick: (role) => openEdit(role),
          },
          {
            label: "View Users",
            onClick: (role) => {
              void openRoleUsers(role.name)
            },
          },
          {
            label: "Delete",
            variant: "destructive",
            onClick: (role) => setPendingDelete(role),
          },
        ]}
        expandable={{
          render: (role) => (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Description</p>
                <p className="mt-2 text-sm">{role.description || "No description provided"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Permissions</p>
                <p className="mt-2 text-sm">{(role.permissions || []).join(", ") || "No explicit permissions"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Users Assigned</p>
                <p className="mt-2 text-sm">{role.user_count || 0}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(role) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium capitalize">{role.name.replace(/_/g, " ")}</p>
                <p className="text-muted-foreground text-sm">{role.description || "No description"}</p>
              </div>
              <Badge variant={role.is_system ? "destructive" : "outline"}>{role.is_system ? "System" : "Custom"}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Permissions</span>
                <span>{role.permissions?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Users</span>
                <span>{role.user_count || 0}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No roles defined"
        emptyDescription="Create a role to configure permissions and access control."
        emptyIcon={Shield}
        skeletonRows={5}
        urlSync
      />

      <DepartmentLeadsManager />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `Delete role "${pendingDelete.name}"?` : "Are you sure?"} This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingRole}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isDeletingRole}
              onClick={async () => {
                if (pendingDelete) {
                  setIsDeletingRole(true)
                  try {
                    await handleDelete(pendingDelete)
                    setPendingDelete(null)
                  } finally {
                    setIsDeletingRole(false)
                  }
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RoleUsersDialog
        open={roleUsersOpen}
        onOpenChange={setRoleUsersOpen}
        selectedRoleName={selectedRoleName}
        roleUsers={roleUsers}
        roleUsersLoading={roleUsersLoading}
        isAddUserInlineOpen={isAddUserInlineOpen}
        onToggleAddUser={async () => {
          setIsAddUserInlineOpen((prev) => !prev)
          if (!availableUsers.length) await fetchAllUsersForRoleModal()
        }}
        availableUsers={availableUsers}
        selectedUserId={selectedUserId}
        onUserSelect={handleUserSelect}
        addUserWarning={addUserWarning}
        addingUser={addingUser}
        onAddUserToRole={handleAddUserToRole}
        onCancelAddUser={() => {
          setIsAddUserInlineOpen(false)
          setSelectedUserId("")
          setAddUserWarning(null)
        }}
      />
    </DataTablePage>
  )
}
