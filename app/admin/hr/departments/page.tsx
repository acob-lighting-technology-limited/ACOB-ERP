"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
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
import { Building, Mail, Pencil, Plus, Users } from "lucide-react"
import { toast } from "sonner"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { logger } from "@/lib/logger"

const log = logger("hr-departments")

interface DepartmentsData {
  departments: Department[]
  departmentEmployees: Record<string, DepartmentEmployee[]>
  canManageDepartments: boolean
}

interface Department {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  office_location?: string | null
  employee_count?: number
}

interface DepartmentEmployee {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
  designation: string | null
  employment_status: string | null
  department: string | null
}

async function fetchDepartmentsData(): Promise<DepartmentsData> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let canManageDepartments = false
  let scopeMode: "global" | "lead" = "global"
  if (user) {
    const [{ data: profile }, scopeResponse] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      fetch("/api/admin/scope-mode", { cache: "no-store" }).catch(() => null),
    ])
    canManageDepartments = ["developer", "super_admin", "admin"].includes(profile?.role || "")
    if (scopeResponse?.ok) {
      const scopePayload = (await scopeResponse.json().catch(() => null)) as { mode?: "global" | "lead" } | null
      scopeMode = scopePayload?.mode === "lead" ? "lead" : "global"
      if (scopeMode === "lead") {
        canManageDepartments = false
      }
    }
  }

  const departmentResponse = await fetch("/api/departments", { cache: "no-store" })
  const departmentPayload = (await departmentResponse.json().catch(() => null)) as {
    data?: Department[]
    error?: string
  } | null
  if (!departmentResponse.ok) {
    throw new Error(departmentPayload?.error || "Failed to load departments")
  }
  const departments = departmentPayload?.data || []

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, company_email, additional_email, designation, employment_status, department")

  const employeesByDepartment: Record<string, DepartmentEmployee[]> = {}
  for (const profile of ((profiles || []) as DepartmentEmployee[]).filter((employee) =>
    isAssignableEmploymentStatus(employee.employment_status, { allowLegacyNullStatus: false })
  )) {
    const departmentName = profile.department || "Unassigned"
    if (!employeesByDepartment[departmentName]) employeesByDepartment[departmentName] = []
    employeesByDepartment[departmentName].push(profile)
  }

  const scopedDepartmentNames = new Set(departments.map((department) => department.name))
  const filteredEmployeesByDepartment = Object.fromEntries(
    Object.entries(employeesByDepartment).filter(([departmentName]) => scopedDepartmentNames.has(departmentName))
  )

  const departmentsWithCounts = departments.map((department) => ({
    ...department,
    employee_count: filteredEmployeesByDepartment[department.name]?.length || 0,
  }))

  return {
    departments: departmentsWithCounts,
    departmentEmployees: filteredEmployeesByDepartment,
    canManageDepartments,
  }
}

function employeeName(employee: DepartmentEmployee) {
  return [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Unknown"
}

function DepartmentCard({ department, onEdit }: { department: Department; onEdit: (department: Department) => void }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{department.name}</p>
          <p className="text-muted-foreground text-xs">{department.employee_count || 0} employees</p>
        </div>
        <Badge variant={department.is_active ? "default" : "secondary"}>
          {department.is_active ? "Active" : "Inactive"}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">{department.description || "No description added"}</p>
      <Button size="sm" variant="outline" onClick={() => onEdit(department)}>
        Edit
      </Button>
    </div>
  )
}

export default function DepartmentsPage() {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    is_active: true,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEYS.adminDepartmentsPage(),
    queryFn: fetchDepartmentsData,
  })

  const departments = data?.departments ?? []
  const departmentEmployees = data?.departmentEmployees ?? {}
  const canManageDepartments = data?.canManageDepartments ?? false

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    try {
      if (!canManageDepartments) {
        toast.error("You can view departments but cannot modify them")
        return
      }

      const supabase = createClient()

      if (editingDepartment) {
        const newName = formData.name.trim()
        const { error: updateError, data: updatedRows } = await supabase
          .from("departments")
          .update({
            name: newName,
            description: formData.description || null,
            is_active: formData.is_active,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingDepartment.id)
          .select()

        if (updateError) throw updateError
        if (!updatedRows || updatedRows.length === 0) {
          throw new Error("Update was blocked by a database policy. Check your department permissions.")
        }

        toast.success("Department updated successfully")
      } else {
        const { error: createError } = await supabase.from("departments").insert({
          name: formData.name,
          description: formData.description || null,
          is_active: formData.is_active,
        })

        if (createError) throw createError
        toast.success("Department created successfully")
      }

      setIsDialogOpen(false)
      setEditingDepartment(null)
      setFormData({ name: "", description: "", is_active: true })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminDepartmentsPage() })
    } catch (err: unknown) {
      log.error("Error saving department:", err)
      const message = err instanceof Error ? err.message : "Failed to save department"
      toast.error(message)
    }
  }

  function openEditDialog(department: Department) {
    if (!canManageDepartments) {
      toast.error("You can view departments but cannot edit them")
      return
    }

    setEditingDepartment(department)
    setFormData({
      name: department.name,
      description: department.description || "",
      is_active: department.is_active,
    })
    setIsDialogOpen(true)
  }

  function openCreateDialog() {
    if (!canManageDepartments) {
      toast.error("You can view departments but cannot create departments")
      return
    }

    setEditingDepartment(null)
    setFormData({ name: "", description: "", is_active: true })
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
      key: "description",
      label: "Description",
      accessor: (department) => department.description || "",
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
      render: (department) => (
        <Badge variant={department.is_active ? "default" : "secondary"}>
          {department.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      accessor: (department) => department.created_at,
      render: (department) => (
        <span className="text-muted-foreground text-sm">
          {new Date(department.created_at).toLocaleDateString("en-GB")}
        </span>
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
      label: "View Employees",
      icon: Users,
      onClick: () => {},
      hidden: () => true,
    },
  ]

  return (
    <DataTablePage
      title="Departments"
      description="Manage company departments and organizational structure."
      icon={Building}
      backLink={{ href: "/admin/hr", label: "Back to HR" }}
      actions={
        canManageDepartments ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Department
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
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
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
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total Departments"
            value={departments.length}
            icon={Building}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active"
            value={departments.filter((department) => department.is_active).length}
            icon={Building}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Total Employees"
            value={departments.reduce((sum, department) => sum + (department.employee_count || 0), 0)}
            icon={Users}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Empty Units"
            value={departments.filter((department) => (department.employee_count || 0) === 0).length}
            icon={Building}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<Department>
        data={departments}
        columns={columns}
        filters={filters}
        getRowId={(department) => department.id}
        searchPlaceholder="Search department name or description..."
        searchFn={(department, query) =>
          [department.name, department.description || ""].join(" ").toLowerCase().includes(query)
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
              <div className="space-y-3">
                <p className="text-sm font-medium">{members.length} team members</p>
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
                            <Link href={`/admin/hr/employees?userId=${member.id}`}>
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
        cardRenderer={(department) => <DepartmentCard department={department} onEdit={openEditDialog} />}
        emptyTitle="No departments yet"
        emptyDescription="Create your first department to start structuring teams and reporting lines."
        emptyIcon={Building}
        skeletonRows={5}
        minWidth="980px"
      />
    </DataTablePage>
  )
}
