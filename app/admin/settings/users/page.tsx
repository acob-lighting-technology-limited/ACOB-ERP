"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Users, Shield, UserPlus, Pencil } from "lucide-react"
import { toast } from "sonner"
import { StatCard } from "@/components/ui/stat-card"
import { useSearchParams } from "next/navigation"
import { logger } from "@/lib/logger"
import { isValidRole } from "./_lib/role-helpers"
import { fetchUsersSettingsData, fetchAllUsersForPicker, formatDate, type User } from "./_lib/queries"
import { EditUserDialog } from "./_components/edit-user-dialog"
import { AddUserToRoleDialog } from "./_components/add-user-to-role-dialog"
import { InviteUserDialog } from "./_components/invite-user-dialog"
import { getAssignableRolesForActor } from "@/lib/role-management"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

const log = logger("settings-users")

const ROLE_COLORS: Record<string, "destructive" | "default" | "secondary"> = {
  developer: "destructive",
  super_admin: "destructive",
  admin: "default",
  employee: "secondary",
  visitor: "secondary",
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({ role: "", employment_status: "active", admin_domains: [] as string[] })
  const [isInviteOpen, setIsInviteOpen] = useState(searchParams.get("invite") === "1")
  const [roleFilter, setRoleFilter] = useState<string>("all")

  const {
    data: settingsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminUsersSettings(),
    queryFn: fetchUsersSettingsData,
  })

  const users = useMemo(() => settingsData?.users ?? [], [settingsData?.users])
  const currentUserRole: string = settingsData?.currentUserRole ?? ""

  useEffect(() => {
    const roleParam = searchParams.get("role")
    if (roleParam && (roleParam === "all" || isValidRole(roleParam))) {
      setRoleFilter(roleParam)
    }
  }, [searchParams])

  async function handleUpdateRole(e: React.FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    try {
      if (formData.role === "admin" && formData.admin_domains.length === 0) {
        throw new Error("Admin role requires at least one domain")
      }
      const response = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: editingUser.id,
          role: formData.role,
          employment_status: formData.employment_status,
          admin_domains: formData.role === "admin" ? formData.admin_domains : [],
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Failed to update")
      toast.success("User updated")
      setIsDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminUsersSettings() })
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update")
    }
  }

  function openEdit(user: User) {
    setEditingUser(user)
    setFormData({
      role: user.role,
      employment_status: user.employment_status || (user.is_active ? "active" : "suspended"),
      admin_domains: Array.isArray(user.admin_domains) ? user.admin_domains : [],
    })
    setIsDialogOpen(true)
  }

  const columns: DataTableColumn<User>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Name",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim(),
        render: (u) => (
          <span className="font-medium">
            {u.first_name || u.last_name ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "—"}
          </span>
        ),
      },
      {
        key: "email",
        label: "Email",
        sortable: true,
        accessor: (u) => u.email || "",
        render: (u) => <span className="text-muted-foreground">{u.email || "—"}</span>,
      },
      {
        key: "role",
        label: "Role",
        sortable: true,
        accessor: (u) => u.role,
        render: (u) => (
          <Badge variant={ROLE_COLORS[u.role] || "secondary"} className="capitalize">
            {u.role?.replace("_", " ")}
          </Badge>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (u) => u.department || "",
        render: (u) => <span className="text-muted-foreground">{u.department || "—"}</span>,
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        accessor: (u) => (u.employment_status === "exited" ? "Exited" : u.is_active ? "Active" : "Inactive"),
        render: (u) => (
          <Badge variant={u.is_active ? "default" : "secondary"}>
            {u.employment_status === "exited" ? "Exited" : u.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      {
        key: "created_at",
        label: "Joined",
        sortable: true,
        accessor: (u) => u.created_at,
        render: (u) => <span className="text-sm">{formatDate(u.created_at)}</span>,
        hideOnMobile: true,
      },
    ],
    []
  )

  const roles = useMemo(() => Array.from(new Set(users.map((u) => u.role))).sort(), [users])

  const filters: DataTableFilter<User>[] = useMemo(
    () => [
      {
        key: "role",
        label: "Role",
        options: roles.map((r) => ({ value: r, label: r.replace("_", " ") })),
        placeholder: "All Roles",
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "Active", label: "Active" },
          { value: "Inactive", label: "Inactive" },
          { value: "Separated", label: "Separated" },
        ],
        placeholder: "All Statuses",
      },
    ],
    [roles]
  )

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.is_active).length,
      admins: users.filter((u) => ["developer", "admin", "super_admin"].includes(u.role)).length,
    }),
    [users]
  )

  const roleOptions = getAssignableRolesForActor(currentUserRole)

  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false)
  const [userToAdd, setUserToAdd] = useState<string>("")
  const [availableUsers, setAvailableUsers] = useState<User[]>([])
  const [addUserWarning, setAddUserWarning] = useState<string | null>(null)

  function openAddUserDialog() {
    fetchAllUsersForPicker().then(setAvailableUsers)
    setAddUserWarning(null)
    setUserToAdd("")
    setIsAddUserDialogOpen(true)
  }

  function handleUserSelect(userId: string) {
    setUserToAdd(userId)
    const user = availableUsers.find((u) => u.id === userId)
    if (!user) return
    if (user.role === roleFilter) {
      setAddUserWarning(`${user.first_name} is already a ${roleFilter}.`)
    } else {
      setAddUserWarning(`User will be removed from "${user.role}" role and assigned to "${roleFilter}".`)
    }
  }

  async function handleAddUserToRole() {
    if (!userToAdd || roleFilter === "all") return
    try {
      const response = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userToAdd, role: roleFilter }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Failed to update role")
      toast.success(`User role updated to ${roleFilter}`)
      setIsAddUserDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminUsersSettings() })
    } catch (error: unknown) {
      log.error("Error adding user to role:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update role")
    }
  }

  return (
    <DataTablePage
      title="User Management"
      description="Manage user accounts and roles."
      icon={Users}
      backLink={{ href: "/admin/settings", label: "Back to Settings" }}
      actions={
        <div className="flex gap-2">
          {roleFilter !== "all" && (
            <Button onClick={openAddUserDialog} variant="secondary" size="sm">
              <UserPlus className="mr-2 h-4 w-4" />
              Add User to {roleFilter.replace("_", " ")}
            </Button>
          )}
          <Button onClick={() => setIsInviteOpen(true)} size="sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite User
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            title="Total Users"
            value={stats.total}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active"
            value={stats.active}
            icon={Users}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Admins"
            value={stats.admins}
            icon={Shield}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<User>
        data={users}
        columns={columns}
        getRowId={(u) => u.id}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        searchPlaceholder="Search by name or email..."
        searchFn={(u, q) =>
          `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(q) ||
          u.department?.toLowerCase().includes(q) ||
          false
        }
        filters={filters}
        rowActions={[
          {
            label: "Edit User",
            icon: Pencil,
            onClick: openEdit,
          },
        ]}
        viewToggle
        cardRenderer={(u) => (
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="leading-tight font-semibold">
                    {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}` : u.email || "Unknown"}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{u.email}</p>
                </div>
                <Badge variant={u.is_active ? "default" : "secondary"}>
                  {u.employment_status === "exited" ? "Exited" : u.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={ROLE_COLORS[u.role] || "secondary"} className="capitalize">
                  {u.role?.replace("_", " ")}
                </Badge>
                {u.department && (
                  <Badge variant="outline" className="border-2 font-normal">
                    {u.department}
                  </Badge>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(u)} className="h-8">
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        urlSync
      />

      <EditUserDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingUser={editingUser}
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleUpdateRole}
        currentUserRole={currentUserRole}
      />

      <AddUserToRoleDialog
        open={isAddUserDialogOpen}
        onOpenChange={setIsAddUserDialogOpen}
        roleFilter={roleFilter}
        userToAdd={userToAdd}
        onUserSelect={handleUserSelect}
        availableUsers={availableUsers}
        addUserWarning={addUserWarning}
        onConfirm={handleAddUserToRole}
      />

      <InviteUserDialog
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        roleOptions={roleOptions}
        queryClient={queryClient}
      />
    </DataTablePage>
  )
}
