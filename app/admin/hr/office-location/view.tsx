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
import { Mail, MapPin, Pencil, Plus, Users } from "lucide-react"
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

function LocationCard({ location, onEdit }: { location: OfficeLocation; onEdit: (location: OfficeLocation) => void }) {
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
      <Button size="sm" variant="outline" onClick={() => onEdit(location)}>
        Edit
      </Button>
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

        toast.success("Office location updated successfully")
        await cascadeRename("office_location", oldName, newName)
      } else {
        const res = await apiFetch("/api/admin/hr/office-locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to create office location")
        toast.success("Office location created successfully")
      }

      setIsDialogOpen(false)
      setEditingLocation(null)
      setFormData({ name: "", type: "office", department: "", description: "", is_active: true })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminOfficeLocations() })
    } catch (err: unknown) {
      log.error("Error saving office location:", err)
      const message = err instanceof Error ? err.message : "Failed to save office location"
      toast.error(message)
    }
  }

  function openEditDialog(location: OfficeLocation) {
    if (!canManageLocations) {
      toast.error("You can view office locations but cannot edit them")
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
      toast.error("You can view office locations but cannot create them")
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
  ]

  return (
    <DataTablePage
      title="Office Locations"
      description="Manage office locations and the employees assigned to each location."
      icon={MapPin}
      backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
      actions={
        canManageLocations ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Location
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>{editingLocation ? "Edit Office Location" : "Add Office Location"}</DialogTitle>
                  <DialogDescription>
                    {editingLocation
                      ? "Update the office location details below."
                      : "Add a new office location to the system."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Location Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      placeholder="e.g., Technical Extension, MD Office"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="type">Location Type</Label>
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
                      placeholder="Brief description of this location..."
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total Locations"
            value={locations.length}
            icon={MapPin}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active"
            value={locations.filter((location) => location.is_active).length}
            icon={MapPin}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Employees"
            value={locations.reduce((sum, location) => sum + (location.employee_count || 0), 0)}
            icon={Users}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
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
        searchPlaceholder="Search location name, type, department, or description..."
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
              <p className="text-muted-foreground text-sm">No employees assigned to this location.</p>
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
        cardRenderer={(location) => <LocationCard location={location} onEdit={openEditDialog} />}
        emptyTitle="No office locations yet"
        emptyDescription="Create your first office location to start organizing workplace assignments."
        emptyIcon={MapPin}
        skeletonRows={5}
      />
    </DataTablePage>
  )
}
