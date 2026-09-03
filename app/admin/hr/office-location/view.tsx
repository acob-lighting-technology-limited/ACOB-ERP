"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertTriangle, Mail, MapPin, Pencil, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("hr-office-locations")

const OFFICE_TYPE_OPTIONS = [
  { value: "office", label: "Executive Office" },
  { value: "department_office", label: "Department Office" },
  { value: "conference_room", label: "Conference Room" },
  { value: "common_area", label: "Common Area" },
]

interface OfficeLocation {
  id: string
  name: string
  type: string
  department: string | null
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  employee_count?: number
}

interface LocationEmployee {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
  designation: string | null
  office_location: string | null
  employment_status?: string | null
}

export interface OfficeLocationsData {
  locations: OfficeLocation[]
  locationEmployees: Record<string, LocationEmployee[]>
  canManageLocations: boolean
  departments: string[]
}

async function fetchOfficeLocationsData(): Promise<OfficeLocationsData> {
  // Admin/dept scope is resolved server-side (requireApiAdminScope +
  // getScopedDepartments) — no client-side scope-mode round trip needed.
  const res = await apiFetch("/api/admin/hr/office-locations", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load office locations")
  return res.json()
}

function employeeName(employee: LocationEmployee) {
  return [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Unknown"
}

function LocationCard({
  location,
  onEdit,
  onDelete,
  canManage,
}: {
  location: OfficeLocation
  onEdit: (location: OfficeLocation) => void
  onDelete?: (location: OfficeLocation) => void
  canManage?: boolean
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{location.name}</p>
          <p className="text-muted-foreground text-xs">{location.employee_count || 0} employees</p>
        </div>
        <Badge variant={location.is_active ? "default" : "secondary"}>
          {location.is_active ? "Active" : "Inactive"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {OFFICE_TYPE_OPTIONS.find((item) => item.value === location.type)?.label || location.type}
        </Badge>
        {location.department ? <Badge variant="secondary">{location.department}</Badge> : null}
      </div>
      <p className="text-muted-foreground text-sm">{location.description || "No description added"}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(location)}>
          Edit
        </Button>
        {canManage && onDelete && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(location)}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}

export function OfficeLocationsPage({
  backLinkHref,
  employeesBasePath,
  initialData,
}: { backLinkHref?: string; employeesBasePath?: string; initialData?: OfficeLocationsData } = {}) {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingLocation, setEditingLocation] = useState<OfficeLocation | null>(null)
  const [deletingLocation, setDeletingLocation] = useState<OfficeLocation | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    type: "office",
    department: "",
    description: "",
    is_active: true,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEYS.adminOfficeLocations(),
    queryFn: fetchOfficeLocationsData,
    initialData,
  })

  const locations = data?.locations ?? []
  const locationEmployees = data?.locationEmployees ?? {}
  const canManageLocations = data?.canManageLocations ?? false
  const departments = data?.departments ?? []

  // After renaming the canonical office, push the new name onto every profile that
  // still stores the old name as plain text (keeps the directory & scoping in sync).
  async function cascadeRename(field: "office_location", oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return
    try {
      const res = await apiFetch("/api/admin/hr/rename-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, oldName, newName }),
      })
      const json = (await res.json()) as { updated?: number; error?: string }
      if (res.ok && (json.updated ?? 0) > 0) {
        toast.success(`Updated ${json.updated} staff record(s) to "${newName}"`)
      }
    } catch (err) {
      log.error("Office rename cascade failed:", err)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    try {
      if (!canManageLocations) {
        toast.error("You can view office locations but cannot modify them")
        return
      }

      const payload = {
        name: formData.name.trim(),
        type: formData.type,
        department: formData.department || null,
        description: formData.description || null,
        is_active: formData.is_active,
      }

      if (editingLocation) {
        const oldName = editingLocation.name?.trim() || ""
        const newName = payload.name
        const res = await apiFetch(`/api/admin/hr/office-locations/${editingLocation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to update office location")
        toast.success("Room / Office updated successfully")
        await cascadeRename("office_location", oldName, newName)
      } else {
        const res = await apiFetch("/api/admin/hr/office-locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to create office location")
        toast.success("Room / Office created successfully")
      }

      setIsDialogOpen(false)
      setEditingLocation(null)
      setFormData({ name: "", type: "office", department: "", description: "", is_active: true })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminOfficeLocations() })
    } catch (err: unknown) {
      log.error("Error saving office location:", err)
      const message = err instanceof Error ? err.message : "Failed to save room / office"
      toast.error(message)
    }
  }

  async function handleDeleteLocation(location: OfficeLocation) {
    try {
      setIsDeleting(true)
      const res = await apiFetch(`/api/admin/hr/office-locations/${location.id}`, {
        method: "DELETE",
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        throw new Error(json?.error || "Failed to delete room / office")
      }
      toast.success(`Room / Office "${location.name}" deleted successfully`)
      setDeletingLocation(null)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminOfficeLocations() })
    } catch (err: unknown) {
      log.error("Error deleting office location:", err)
      const message = err instanceof Error ? err.message : "Failed to delete room / office"
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  function openEditDialog(location: OfficeLocation) {
    if (!canManageLocations) {
      toast.error("You can view rooms & offices but cannot edit them")
      return
    }
    setEditingLocation(location)
    setFormData({
      name: location.name,
      type: location.type,
      department: location.department || "",
      description: location.description || "",
      is_active: location.is_active,
    })
    setIsDialogOpen(true)
  }

  function openCreateDialog() {
    if (!canManageLocations) {
      toast.error("You can view rooms & offices but cannot create them")
      return
    }
    setEditingLocation(null)
    setFormData({ name: "", type: "office", department: "", description: "", is_active: true })
    setIsDialogOpen(true)
  }

  const columns: DataTableColumn<OfficeLocation>[] = [
    {
      key: "name",
      label: "Name",
      sortable: true,
      accessor: (location) => location.name,
      render: (location) => <span className="font-medium">{location.name}</span>,
      resizable: true,
      initialWidth: 220,
    },
    {
      key: "type",
      label: "Type",
      sortable: true,
      accessor: (location) => OFFICE_TYPE_OPTIONS.find((item) => item.value === location.type)?.label || location.type,
      render: (location) => (
        <Badge variant="outline">
          {OFFICE_TYPE_OPTIONS.find((item) => item.value === location.type)?.label || location.type}
        </Badge>
      ),
    },
    {
      key: "department",
      label: "Linked Department",
      sortable: true,
      accessor: (location) => location.department || "",
      hideOnMobile: true,
      render: (location) =>
        location.department ? (
          <Badge variant="secondary">{location.department}</Badge>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        ),
    },
    {
      key: "employee_count",
      label: "Headcount",
      sortable: true,
      accessor: (location) => location.employee_count || 0,
      render: (location) => <Badge variant="secondary">{location.employee_count || 0} employees</Badge>,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (location) => (location.is_active ? "active" : "inactive"),
      render: (location) => (
        <Badge variant={location.is_active ? "default" : "secondary"}>
          {location.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ]

  const filters: DataTableFilter<OfficeLocation>[] = [
    {
      key: "type",
      label: "Location Type",
      options: OFFICE_TYPE_OPTIONS,
      placeholder: "All Types",
    },
    {
      key: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
      placeholder: "All Statuses",
    },
    {
      key: "department",
      label: "Department",
      options: departments.map((department) => ({ value: department, label: department })),
      placeholder: "All Departments",
    },
  ]

  const rowActions: RowAction<OfficeLocation>[] = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (location) => openEditDialog(location),
      hidden: () => !canManageLocations,
    },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive",
      onClick: (location) => setDeletingLocation(location),
      hidden: () => !canManageLocations,
    },
  ]

  return (
    <DataTablePage
      title="Rooms & Offices"
      description="Manage company rooms, office spaces, and employee seat allocations."
      icon={MapPin}
      backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
      actions={
        canManageLocations ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Room / Office</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>{editingLocation ? "Edit Room / Office" : "Add Room / Office"}</DialogTitle>
                  <DialogDescription>
                    {editingLocation
                      ? "Update the room or office space details below."
                      : "Add a new room or office space to the system."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Room / Office Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      placeholder="e.g., Technical Extension, MD Office"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="type">Space Type</Label>
                    <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                      <SelectTrigger id="type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFICE_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="department">Linked Department</Label>
                    <Select
                      value={formData.department || "__none__"}
                      onValueChange={(value) =>
                        setFormData({ ...formData, department: value === "__none__" ? "" : value })
                      }
                    >
                      <SelectTrigger id="department">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {departments.map((department) => (
                          <SelectItem key={department} value={department}>
                            {department}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                      placeholder="Brief description of this room or office..."
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="is_active">Active</Label>
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingLocation ? "Update" : "Create"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total Spaces"
            value={locations.length}
            icon={MapPin}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={locations.filter((location) => location.is_active).length}
            icon={MapPin}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Employees"
            value={locations.reduce((sum, location) => sum + (location.employee_count || 0), 0)}
            icon={Users}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Linked Depts"
            value={locations.filter((location) => Boolean(location.department)).length}
            icon={MapPin}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<OfficeLocation>
        data={locations}
        columns={columns}
        filters={filters}
        getRowId={(location) => location.id}
        pagination={{ pageSize: 20 }}
        searchPlaceholder="Search room/office name, type, department, or description..."
        searchFn={(location, query) =>
          [
            location.name,
            location.description || "",
            location.department || "",
            OFFICE_TYPE_OPTIONS.find((item) => item.value === location.type)?.label || location.type,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={error instanceof Error ? error.message : error ? String(error) : null}
        onRetry={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminOfficeLocations() })}
        rowActions={rowActions}
        expandable={{
          render: (location) => {
            const members = locationEmployees[location.name] || []
            return members.length === 0 ? (
              <p className="text-muted-foreground text-sm">No employees assigned to this room/office.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">{members.length} assigned employees</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Employee</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Contact</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Role</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold tracking-wide uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{employeeName(member)}</td>
                          <td className="text-muted-foreground px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Mail className="h-3 w-3" />
                              <span>
                                {[member.company_email, member.additional_email].filter(Boolean).join(" | ") || "-"}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline">{member.designation || "Employee"}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Link href={`${employeesBasePath ?? "/admin/hr/employees"}?userId=${member.id}`}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          },
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (location) => (location.is_active ? "bg-emerald-500" : "bg-slate-400"),
          title: (location) => location.name,
          subtitle: (location) =>
            `${OFFICE_TYPE_OPTIONS.find((item) => item.value === location.type)?.label || location.type} · ${location.department || "All Departments"} · ${location.employee_count || 0} employees`,
          trailing: (location) => (
            <Badge variant={location.is_active ? "default" : "secondary"} className="text-[10px]">
              {location.is_active ? "Active" : "Inactive"}
            </Badge>
          ),
          onSelect: (location) => openEditDialog(location),
        }}
        cardRenderer={(location) => (
          <LocationCard
            location={location}
            onEdit={openEditDialog}
            onDelete={(loc) => setDeletingLocation(loc)}
            canManage={canManageLocations}
          />
        )}
        emptyTitle="No rooms or offices yet"
        emptyDescription="Create your first room or office to start organizing workplace assignments."
        emptyIcon={MapPin}
        skeletonRows={5}
      />

      <AlertDialog open={!!deletingLocation} onOpenChange={(open) => !open && setDeletingLocation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive h-5 w-5" />
              Delete Room / Office
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="text-foreground font-semibold">{deletingLocation?.name}</span>? This will permanently
              remove the room or office space from the system.
            </AlertDialogDescription>
            {deletingLocation && (deletingLocation.employee_count || 0) > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                Warning: This location currently has {deletingLocation.employee_count} assigned employee(s). You must
                reassign them before this location can be deleted.
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault()
                if (deletingLocation) void handleDeleteLocation(deletingLocation)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
