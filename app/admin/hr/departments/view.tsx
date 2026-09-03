"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
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
import { AlertTriangle, Building, Mail, Pencil, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import { logger } from "@/lib/logger"
import { formatWATDate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

const log = logger("hr-departments")

const TABS: DataTableTab[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
]

export function DepartmentStatusBadge({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        Active
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="border-slate-300 bg-slate-100 font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
    >
      Inactive
    </Badge>
  )
}

export interface Department {
  id: string
  name: string
  description: string | null
  department_code: string | null
  email: string | null
  is_executive_dept: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  office_location?: string | null
  employee_count?: number
}

export interface DepartmentEmployee {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
  designation: string | null
  employment_status: string | null
  department: string | null
  department_id?: string | null
}

export interface DepartmentsData {
  departments: Department[]
  departmentEmployees: Record<string, DepartmentEmployee[]>
  canManageDepartments: boolean
}

async function fetchDepartmentsData(): Promise<DepartmentsData> {
  // Admin/dept scope is resolved server-side (requireApiAdminScope +
  // getScopedDepartments) — no client-side scope-mode round trip needed.
  const res = await apiFetch("/api/admin/hr/departments", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load departments")
  return res.json()
}

function employeeName(employee: DepartmentEmployee) {
  return [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Unknown"
}

function DepartmentCard({
  department,
  onEdit,
  onDelete,
  canManage,
}: {
  department: Department
  onEdit: (department: Department) => void
  onDelete?: (department: Department) => void
  canManage?: boolean
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{department.name}</p>
          <p className="text-muted-foreground text-xs">{department.employee_count || 0} employees</p>
        </div>
        <DepartmentStatusBadge isActive={department.is_active} />
      </div>
      {department.email && (
        <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <a href={`mailto:${department.email}`} className="hover:text-foreground truncate hover:underline">
            {department.email}
          </a>
        </div>
      )}
      <p className="text-muted-foreground text-sm">{department.description || "No description added"}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(department)}>
          Edit
        </Button>
        {canManage && onDelete && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(department)}
          >
            Deactivate
          </Button>
        )}
      </div>
    </div>
  )
}

export function DepartmentsPage({
  backLinkHref,
  employeesBasePath,
  initialData,
}: { backLinkHref?: string; employeesBasePath?: string; initialData?: DepartmentsData } = {}) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<string>("active")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [deletingDepartment, setDeletingDepartment] = useState<Department | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    department_code: "",
    email: "",
    is_executive_dept: false,
    is_active: true,
  })
  const [originalCode, setOriginalCode] = useState<string | null>(null)
  const [existingReferenceCount, setExistingReferenceCount] = useState<number>(0)

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEYS.adminDepartmentsPage(),
    queryFn: fetchDepartmentsData,
    initialData,
  })

  const departments = useMemo(() => data?.departments ?? [], [data?.departments])
  const departmentEmployees = useMemo(() => data?.departmentEmployees ?? {}, [data?.departmentEmployees])
  const canManageDepartments = data?.canManageDepartments ?? false

  const filteredDepartments = useMemo(() => {
    if (activeTab === "active") return departments.filter((d) => d.is_active)
    if (activeTab === "inactive") return departments.filter((d) => !d.is_active)
    return departments
  }, [departments, activeTab])

  async function handleDeleteDepartment(dept: Department) {
    try {
      setIsDeleting(true)
      const res = await apiFetch(`/api/departments/${dept.id}`, {
        method: "DELETE",
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        throw new Error(json?.error || "Failed to deactivate department")
      }
      toast.success(`Department "${dept.name}" deactivated successfully`)
      setDeletingDepartment(null)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminDepartmentsPage() })
    } catch (err: unknown) {
      log.error("Error deactivating department:", err)
      const message = err instanceof Error ? err.message : "Failed to deactivate department"
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  // After renaming the canonical department, push the new name onto every profile
  // that still stores the old name as plain text (keeps directory & scoping in sync).
  async function cascadeRename(oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return
    try {
      const res = await apiFetch("/api/admin/hr/rename-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "department", oldName, newName }),
      })
      const json = (await res.json()) as { updated?: number; error?: string }
      if (res.ok && (json.updated ?? 0) > 0) {
        toast.success(`Updated ${json.updated} staff record(s) to "${newName}"`)
      }
    } catch (err) {
      log.error("Department rename cascade failed:", err)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    try {
      if (!canManageDepartments) {
        toast.error("You can view departments but cannot modify them")
        return
      }

      if (!formData.name.trim()) {
        toast.error("Department name is required")
        return
      }

      if (!formData.description.trim()) {
        toast.error("Department description is required")
        return
      }

      if (editingDepartment) {
        const oldName = editingDepartment.name?.trim() || ""
        const newName = formData.name.trim()
        const res = await apiFetch(`/api/departments/${editingDepartment.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName,
            description: formData.description.trim(),
            department_code: formData.department_code.trim().toUpperCase() || null,
            email: formData.email.trim().toLowerCase() || null,
            is_executive_dept: formData.is_executive_dept,
            is_active: formData.is_active,
          }),
        })
        if (!res.ok) {
          throw new Error(
            (await res.json().catch(() => null))?.error ||
              "Update was blocked by a database policy. Check your department permissions."
          )
        }

        toast.success("Department updated successfully")
        await cascadeRename(oldName, newName)
      } else {
        const res = await apiFetch("/api/departments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name.trim(),
            description: formData.description.trim(),
            department_code: formData.department_code.trim().toUpperCase() || null,
            email: formData.email.trim().toLowerCase() || null,
            is_executive_dept: formData.is_executive_dept,
            is_active: formData.is_active,
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to create department")
        toast.success("Department created successfully")
      }

      setIsDialogOpen(false)
      setEditingDepartment(null)
      setFormData({
        name: "",
        description: "",
        department_code: "",
        email: "",
        is_executive_dept: false,
        is_active: true,
      })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminDepartmentsPage() })
    } catch (err: unknown) {
      log.error("Error saving department:", err)
      const message = err instanceof Error ? err.message : "Failed to save department"
      toast.error(message)
    }
  }

  async function openEditDialog(department: Department) {
    if (!canManageDepartments) {
      toast.error("You can view departments but cannot edit them")
      return
    }

    const code = department.department_code || null
    setOriginalCode(code)
    setExistingReferenceCount(0)
    setEditingDepartment(department)
    setFormData({
      name: department.name,
      description: department.description || "",
      department_code: code || "",
      email: department.email || "",
      is_executive_dept: department.is_executive_dept,
      is_active: department.is_active,
    })
    setIsDialogOpen(true)

    if (code) {
      const res = await apiFetch(`/api/admin/hr/departments/reference-count?code=${encodeURIComponent(code)}`, {
        cache: "no-store",
      })
      const json = await res.json().catch(() => null)
      setExistingReferenceCount(json?.count ?? 0)
    }
  }

  function openCreateDialog() {
    if (!canManageDepartments) {
      toast.error("You can view departments but cannot create departments")
      return
    }

    setEditingDepartment(null)
    setOriginalCode(null)
    setExistingReferenceCount(0)
    setFormData({
      name: "",
      description: "",
      department_code: "",
      email: "",
      is_executive_dept: false,
      is_active: true,
    })
    setIsDialogOpen(true)
  }

  const columns: DataTableColumn<Department>[] = [
    {
      key: "name",
      label: "Name",
      sortable: true,
      accessor: (department) => department.name,
      render: (department) => <span className="font-medium">{department.name}</span>,
      resizable: true,
      initialWidth: 220,
    },
    {
      key: "department_code",
      label: "Code",
      accessor: (department) => department.department_code || "",
      hideOnMobile: true,
      render: (department) =>
        department.department_code ? (
          <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs font-semibold">
            {department.department_code}
          </code>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
      initialWidth: 100,
    },
    {
      key: "email",
      label: "Official Email",
      accessor: (department) => department.email || "",
      hideOnMobile: true,
      render: (department) =>
        department.email ? (
          <a
            href={`mailto:${department.email}`}
            className="hover:text-primary font-mono text-xs transition-colors hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {department.email}
          </a>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
      resizable: true,
      initialWidth: 200,
    },
    {
      key: "description",
      label: "Description",
      accessor: (department) => department.description || "",
      hideOnMobile: true,
      render: (department) => (
        <span className="text-muted-foreground block max-w-[260px] truncate text-sm">
          {department.description || "No description added"}
        </span>
      ),
      resizable: true,
      initialWidth: 260,
    },
    {
      key: "employee_count",
      label: "Headcount",
      sortable: true,
      accessor: (department) => department.employee_count || 0,
      render: (department) => <Badge variant="secondary">{department.employee_count || 0} employees</Badge>,
      align: "center",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (department) => (department.is_active ? "active" : "inactive"),
      render: (department) => <DepartmentStatusBadge isActive={department.is_active} />,
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      accessor: (department) => department.created_at,
      hideOnMobile: true,
      render: (department) => (
        <span className="text-muted-foreground text-sm">{formatWATDate(department.created_at)}</span>
      ),
    },
  ]

  const filters: DataTableFilter<Department>[] = [
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
      key: "headcount_band",
      label: "Headcount",
      options: [
        { value: "empty", label: "No Employees" },
        { value: "small", label: "1-10" },
        { value: "medium", label: "11-50" },
        { value: "large", label: "51+" },
      ],
      placeholder: "All Sizes",
      mode: "custom",
      filterFn: (department, values) => {
        if (values.length === 0) return true
        const count = department.employee_count || 0
        return values.some((value) => {
          if (value === "empty") return count === 0
          if (value === "small") return count >= 1 && count <= 10
          if (value === "medium") return count >= 11 && count <= 50
          if (value === "large") return count >= 51
          return false
        })
      },
    },
  ]

  const rowActions: RowAction<Department>[] = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (department) => openEditDialog(department),
      hidden: () => !canManageDepartments,
    },
    {
      label: "Deactivate",
      icon: Trash2,
      variant: "destructive",
      onClick: (department) => setDeletingDepartment(department),
      hidden: () => !canManageDepartments,
    },
  ]

  return (
    <DataTablePage
      title="Departments"
      description="Manage company departments and organizational structure."
      icon={Building}
      backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
      actions={
        canManageDepartments ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Department</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>{editingDepartment ? "Edit Department" : "Create Department"}</DialogTitle>
                  <DialogDescription>
                    {editingDepartment
                      ? "Update the department details below."
                      : "Add a new department to your organization."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Department Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      placeholder="e.g., Engineering, Sales, Marketing"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="department_code">Department Code</Label>
                    <Input
                      id="department_code"
                      value={formData.department_code}
                      onChange={(event) =>
                        setFormData({ ...formData, department_code: event.target.value.toUpperCase() })
                      }
                      placeholder="e.g. HR, IT, OPS"
                      maxLength={10}
                    />
                    <p className="text-muted-foreground text-xs">
                      2–10 characters. Used to generate correspondence reference numbers. Changing the department name
                      does <strong>not</strong> affect this code or existing references.
                    </p>
                    {editingDepartment &&
                      originalCode &&
                      formData.department_code.trim().toUpperCase() !== originalCode && (
                        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div className="space-y-1">
                            <p className="font-semibold">Code change — reference counter will restart</p>
                            <p>
                              {existingReferenceCount > 0
                                ? `${existingReferenceCount} existing reference${existingReferenceCount === 1 ? "" : "s"} use code `
                                : "No existing references use code "}
                              <code className="font-mono font-bold">{originalCode}</code>
                              {existingReferenceCount > 0 ? " and will keep that code permanently." : "."}
                            </p>
                            <p>
                              New references will use{" "}
                              <code className="font-mono font-bold">
                                {formData.department_code.trim().toUpperCase() || "…"}
                              </code>{" "}
                              and the sequence counter starts fresh at <code className="font-mono font-bold">001</code>.
                            </p>
                          </div>
                        </div>
                      )}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="department_email">Official Department Email</Label>
                    <Input
                      id="department_email"
                      type="email"
                      value={formData.email}
                      onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                      placeholder="e.g. ict@acoblighting.com"
                    />
                    <p className="text-muted-foreground text-xs">Official inbox/contact address for this department.</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">
                      Description <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="description"
                      required
                      value={formData.description}
                      onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                      placeholder="Brief description of the department responsibilities..."
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
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="is_executive_dept">Final Approver Department</Label>
                      <p className="text-muted-foreground text-xs">
                        This department&apos;s lead is the final approver on all correspondence. Only one department can
                        hold this role — enabling it here will remove it from any other department.
                      </p>
                    </div>
                    <Switch
                      id="is_executive_dept"
                      checked={formData.is_executive_dept}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_executive_dept: checked })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingDepartment ? "Update" : "Create"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total Departments"
            value={departments.length}
            icon={Building}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={departments.filter((department) => department.is_active).length}
            icon={Building}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Inactive"
            value={departments.filter((department) => !department.is_active).length}
            icon={Building}
            iconBgColor="bg-slate-500/10"
            iconColor="text-slate-500"
          />
          <StatCard
            variant="compact"
            title="Total Employees"
            value={departments.reduce((sum, department) => sum + (department.employee_count || 0), 0)}
            icon={Users}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<Department>
        data={filteredDepartments}
        columns={columns}
        filters={filters}
        getRowId={(department) => department.id}
        pagination={{ pageSize: 20 }}
        searchPlaceholder="Search department name, email or description..."
        searchFn={(department, query) =>
          [department.name, department.email || "", department.description || "", department.department_code || ""]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={error instanceof Error ? error.message : error ? String(error) : null}
        onRetry={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminDepartmentsPage() })}
        rowActions={rowActions}
        expandable={{
          render: (department) => {
            const members = departmentEmployees[department.name] || []
            return members.length === 0 ? (
              <p className="text-muted-foreground text-sm">No employees in this department.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="w-12 px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">S/N</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Employee</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Contact</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Role</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold tracking-wide uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member, index) => (
                      <tr key={member.id} className="border-t">
                        <td className="text-muted-foreground w-12 px-3 py-2 font-mono text-xs">{index + 1}</td>
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
            )
          },
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (d) => (d.is_active ? "bg-emerald-500" : "bg-slate-400"),
          title: (d) => d.name,
          subtitle: (d) =>
            `${d.department_code || "No code"} · ${d.employee_count || 0} employees · ${d.email || "No email"}`,
          trailing: (d) => <DepartmentStatusBadge isActive={d.is_active} />,
          onSelect: (d) => openEditDialog(d),
        }}
        cardRenderer={(department) => (
          <DepartmentCard
            department={department}
            onEdit={openEditDialog}
            onDelete={setDeletingDepartment}
            canManage={canManageDepartments}
          />
        )}
        emptyTitle="No departments yet"
        emptyDescription="Create your first department to start structuring teams and reporting lines."
        emptyIcon={Building}
        skeletonRows={5}
      />
      <AlertDialog open={deletingDepartment !== null} onOpenChange={(open) => !open && setDeletingDepartment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Department</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span>
                Are you sure you want to deactivate <strong>{deletingDepartment?.name}</strong>?
              </span>
              {(deletingDepartment?.employee_count ?? 0) > 0 ? (
                <span className="block font-medium text-amber-600 dark:text-amber-400">
                  Warning: This department currently has {deletingDepartment?.employee_count} employee(s). You must
                  reassign all employees before deactivating.
                </span>
              ) : (
                <span className="text-muted-foreground block">This will mark the department as inactive.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault()
                if (deletingDepartment) {
                  void handleDeleteDepartment(deletingDepartment)
                }
              }}
            >
              {isDeleting ? "Deactivating..." : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
