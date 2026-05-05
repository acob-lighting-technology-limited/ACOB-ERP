"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { formatName, cn } from "@/lib/utils"
import { Users, Shield, Mail, Phone, Download, Plus, Pencil, Eye, Building2, Calendar, IdCard } from "lucide-react"
import type { UserRole, EmploymentStatus } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { PendingApplicationsModal } from "./pending-applications-modal"
import { formValidation } from "@/lib/validation"
import { getAssignableRolesForActor } from "@/lib/role-management"
import { logger } from "@/lib/logger"
import { CreateUserDialog } from "@/components/employees/CreateUserDialog"
import { EmployeeViewModal } from "@/components/employees/EmployeeViewModal"
import { EmployeeDeletionDialog } from "@/components/employees/EmployeeDeletionDialog"
import { EmployeeExportDialog } from "@/components/employees/EmployeeExportDialog"
import {
  buildEmployeeExportRows,
  exportEmployeesToExcel,
  exportEmployeesToPDF,
  exportEmployeesToWord,
} from "@/lib/employees/employee-export"
import type { Database } from "@/types/database"
import type { EmployeeAssignedItems, EmployeeProfile, EmployeeViewData } from "@/components/employees/types"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"

const log = logger("hr-employees-admin-employee-content")

async function fetchAllEmployees(): Promise<Employee[]> {
  const response = await fetch("/api/admin/employees", { cache: "no-store" })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || "Failed to fetch employees")
  }
  const payload = (await response.json()) as { data: Employee[] }
  return payload.data || []
}

export interface Employee {
  id: string
  employee_number: string | null
  first_name: string
  last_name: string
  other_names: string | null
  company_email: string
  additional_email: string | null
  department: string
  designation: string | null
  role: UserRole
  admin_domains?: string[] | null
  phone_number: string | null
  additional_phone: string | null
  residential_address: string | null
  office_location: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  date_of_birth: string | null
  employment_date: string | null
  is_admin: boolean
  is_department_lead: boolean
  lead_departments: string[]
  employment_status: EmploymentStatus
  created_at: string
}

export interface UserProfile {
  role: UserRole
  is_department_lead?: boolean
  managed_departments?: string[]
}

interface AdminEmployeeContentProps {
  initialEmployees: Employee[]
  userProfile: UserProfile
}

function deriveLeadDepartments(department: string, isDepartmentLead: boolean): string[] {
  return isDepartmentLead && department ? [department] : []
}

const roleList: UserRole[] = ["visitor", "employee", "admin", "super_admin", "developer"]

export function AdminEmployeeContent({ initialEmployees, userProfile }: AdminEmployeeContentProps) {
  const searchParams = useSearchParams()
  const [supabase] = useState(() => createClient())
  const queryClient = useQueryClient()

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [modalViewMode, setModalViewMode] = useState<"profile" | "employment" | "edit" | "signature" | "status">(
    "profile"
  )

  // Export state
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportEmployeeDialogOpen, setExportEmployeeDialogOpen] = useState(false)
  const [exportType, setExportType] = useState<"excel" | "pdf" | "word" | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<Record<string, boolean>>({
    "#": true,
    "Employee No.": true,
    "Last Name": true,
    "First Name": true,
    "Other Names": true,
    Email: true,
    "Additional Email": true,
    Department: true,
    Role: true,
    Designation: true,
    "Phone Number": true,
    "Residential Address": true,
    "Office Location": true,
    "Employment Date": true,
    "Lead Departments": true,
    "Created At": true,
  })

  const [viewEmployeeProfile, setViewEmployeeProfile] = useState<EmployeeProfile | null>(null)
  const [viewEmployeeData, setViewEmployeeData] = useState<EmployeeViewData>({
    tasks: [],
    assets: [],
    documentation: [],
  })

  const [assignedItems, setAssignedItems] = useState<EmployeeAssignedItems>({
    tasks: [],
    taskAssignments: [],
    assets: [],
    projects: [],
    projectMemberships: [],
    feedback: [],
    documentation: [],
  })

  const [isCreateUserDialogOpen, setIsCreateUserDialogOpen] = useState(false)
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [createUserForm, setCreateUserForm] = useState({
    firstName: "",
    lastName: "",
    otherNames: "",
    email: "",
    department: "",
    companyRole: "",
    phoneNumber: "",
    role: "employee" as UserRole,
    admin_domains: [] as string[],
    employeeNumber: "",
  })

  const [editForm, setEditForm] = useState({
    role: "employee" as UserRole,
    admin_domains: [] as string[],
    is_department_lead: false,
    department: "",
    office_location: "",
    designation: "",
    lead_departments: [] as string[],
    employee_number: "",
    first_name: "",
    last_name: "",
    other_names: "",
    company_email: "",
    additional_email: "",
    phone_number: "",
    additional_phone: "",
    residential_address: "",
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    date_of_birth: "",
    employment_date: "",
    job_description: "",
  })
  const [showMoreOptions, setShowMoreOptions] = useState(false)

  const canManageUsers = ["developer", "super_admin", "admin"].includes(userProfile?.role || "")
  const canReviewApplications = canManageUsers || Boolean(userProfile?.is_department_lead)

  const {
    data: employees = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminEmployees(),
    queryFn: fetchAllEmployees,
    initialData: initialEmployees,
  })

  const loadData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminEmployees() })
  }, [queryClient])

  const handleEditEmployee = useCallback(
    async (employee: Employee) => {
      if (!canManageUsers) {
        toast.error("You can view users but cannot edit them")
        return
      }

      try {
        setSelectedEmployee(employee)
        const { data: fullProfile } = await supabase.from("profiles").select("*").eq("id", employee.id).single()

        if (fullProfile) {
          const isDepartmentLead = Boolean(fullProfile.is_department_lead)
          const normalizedDepartment = fullProfile.department || ""
          setEditForm({
            role: (fullProfile.role as UserRole) || "employee",
            admin_domains: Array.isArray(fullProfile.admin_domains) ? fullProfile.admin_domains : [],
            is_department_lead: isDepartmentLead,
            department: normalizedDepartment,
            office_location: fullProfile.office_location || "",
            designation: fullProfile.designation || "",
            lead_departments: deriveLeadDepartments(normalizedDepartment, isDepartmentLead),
            employee_number: fullProfile.employee_number || "",
            first_name: fullProfile.first_name || "",
            last_name: fullProfile.last_name || "",
            other_names: fullProfile.other_names || "",
            company_email: fullProfile.company_email || "",
            additional_email: fullProfile.additional_email || "",
            phone_number: fullProfile.phone_number || "",
            additional_phone: fullProfile.additional_phone || "",
            residential_address: fullProfile.residential_address || "",
            bank_name: fullProfile.bank_name || "",
            bank_account_number: fullProfile.bank_account_number || "",
            bank_account_name: fullProfile.bank_account_name || "",
            date_of_birth: fullProfile.date_of_birth || "",
            employment_date: fullProfile.employment_date || "",
            job_description: fullProfile.job_description || "",
          })
        }

        setShowMoreOptions(false)
        setSelectedEmployee(employee)
        setViewEmployeeProfile(employee as unknown as EmployeeProfile)
        setModalViewMode("edit")
        setIsViewDialogOpen(true)
      } catch (_error: unknown) {
        log.error({ err: String(_error) }, "error loading employee for edit")
        toast.error("Failed to load employee details")
      }
    },
    [canManageUsers, supabase]
  )

  const handleViewEmployeeDetails = async (employee: Employee) => {
    try {
      setSelectedEmployee(employee)
      setModalViewMode("profile")
      setViewEmployeeProfile(null)
      setViewEmployeeData({ tasks: [], assets: [], documentation: [] })
      setIsViewDialogOpen(true)

      const response = await fetch(`/api/admin/hr/employees/${employee.id}/overview`, { cache: "no-store" })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        profile?: EmployeeProfile
        related?: EmployeeViewData
      }

      if (!response.ok) throw new Error(payload.error || "Failed to load employee details")
      if (!payload.profile) throw new Error("Employee profile not found")

      setViewEmployeeProfile(payload.profile)
      setViewEmployeeData({
        tasks: payload.related?.tasks || [],
        assets: payload.related?.assets || [],
        documentation: payload.related?.documentation || [],
      })

      // Also fetch full assigned items for deletion check or detailed view
      const detailResponse = await fetch(`/api/admin/hr/employees/${employee.id}/details`)
      if (detailResponse.ok) {
        const detailData = await detailResponse.json()
        setAssignedItems(detailData)
      }
    } catch (_error: unknown) {
      log.error({ err: String(_error) }, "error loading employee details")
      toast.error("Failed to load employee details")
    }
  }

  const handleSaveEmployee = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      if (!canManageUsers || !selectedEmployee) {
        setIsSaving(false)
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user && selectedEmployee.id === user.id && editForm.role !== selectedEmployee.role) {
        toast.error("You cannot change your own role from the HR employee editor")
        setIsSaving(false)
        return
      }

      const companyEmail = editForm.company_email.trim().toLowerCase()
      const additionalEmail = editForm.additional_email.trim().toLowerCase()

      if (!companyEmail || !formValidation.isCompanyEmail(companyEmail)) {
        toast.error("Valid company email is required")
        setIsSaving(false)
        return
      }

      const leadDepartments = deriveLeadDepartments(editForm.department, editForm.is_department_lead)

      const updateData: Database["public"]["Tables"]["profiles"]["Update"] = {
        role: editForm.role,
        admin_domains: editForm.role === "admin" ? editForm.admin_domains : null,
        department: editForm.department,
        office_location: editForm.office_location || null,
        designation: editForm.designation || null,
        is_department_lead: editForm.is_department_lead,
        lead_departments: leadDepartments,
        updated_at: new Date().toISOString(),
        first_name: editForm.first_name || "",
        last_name: editForm.last_name || "",
        other_names: editForm.other_names || null,
        company_email: companyEmail,
        additional_email: additionalEmail || null,
        phone_number: editForm.phone_number || null,
        additional_phone: editForm.additional_phone || null,
        residential_address: editForm.residential_address || null,
        bank_name: editForm.bank_name || null,
        bank_account_number: editForm.bank_account_number || null,
        bank_account_name: editForm.bank_account_name || null,
        date_of_birth: editForm.date_of_birth || null,
        employment_date: editForm.employment_date || null,
        job_description: editForm.job_description || null,
      }

      const emailSyncResponse = await fetch(`/api/admin/hr/employees/${selectedEmployee.id}/email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyEmail, additionalEmail: additionalEmail || null }),
      })
      if (!emailSyncResponse.ok) throw new Error("Failed to sync employee login email")

      const { error } = await supabase.from("profiles").update(updateData).eq("id", selectedEmployee.id)
      if (error) throw error

      toast.success("Employee updated successfully")
      if (isViewDialogOpen) {
        setModalViewMode("profile")
        const { data: updatedProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", selectedEmployee.id)
          .single()
        if (updatedProfile) setViewEmployeeProfile(updatedProfile as EmployeeProfile)
      }
      loadData()
    } catch (_error: unknown) {
      log.error({ err: String(_error) }, "error updating employee")
      toast.error(_error instanceof Error ? _error.message : "Failed to update employee")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateUser = async () => {
    if (isCreatingUser) return
    setIsCreatingUser(true)
    try {
      if (!canManageUsers) throw new Error("Permission denied")
      if (!createUserForm.firstName.trim() || !createUserForm.lastName.trim() || !createUserForm.email.trim()) {
        throw new Error("Required fields are missing")
      }
      if (!formValidation.isCompanyEmail(createUserForm.email)) {
        throw new Error("Invalid email domain")
      }
      const response = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createUserForm),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to create user")

      toast.success("User created successfully")
      setIsCreateUserDialogOpen(false)
      setCreateUserForm({
        firstName: "",
        lastName: "",
        otherNames: "",
        email: "",
        department: "",
        companyRole: "",
        phoneNumber: "",
        role: "employee",
        admin_domains: [],
        employeeNumber: "",
      })
      loadData()
    } catch (_error: unknown) {
      toast.error(_error instanceof Error ? _error.message : "Failed to create user")
    } finally {
      setIsCreatingUser(false)
    }
  }

  const handleExportExecute = async () => {
    if (!exportType || employees.length === 0) return
    try {
      const exportRows = buildEmployeeExportRows(employees, { selectedColumns })
      if (exportType === "excel") await exportEmployeesToExcel(exportRows)
      else if (exportType === "pdf") await exportEmployeesToPDF(employees, { selectedColumns })
      else if (exportType === "word") await exportEmployeesToWord(exportRows)
      setExportEmployeeDialogOpen(false)
    } catch (_error: unknown) {
      toast.error("Export failed")
    }
  }

  const handleViewEmployeeSignature = (employee: EmployeeProfile) => {
    setSelectedEmployee(employee as unknown as Employee)
    setViewEmployeeProfile(employee)
    setModalViewMode("signature")
    setIsViewDialogOpen(true)
  }

  const getAvailableRoles = (): UserRole[] => {
    if (!userProfile) return []
    return getAssignableRolesForActor(userProfile.role) as UserRole[]
  }

  const columns: DataTableColumn<Employee>[] = useMemo(
    () => [
      {
        key: "employee_number",
        label: "Emp. No.",
        sortable: true,
        resizable: true,
        initialWidth: 120,
        accessor: (r) => r.employee_number || "",
        render: (r) => <span className="text-muted-foreground font-mono text-sm">{r.employee_number || "—"}</span>,
      },
      {
        key: "name",
        label: "Name",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => `${r.last_name}, ${r.first_name}`,
        render: (r) => (
          <div className="flex flex-col">
            <span
              className={cn("font-medium", r.employment_status === "separated" && "text-muted-foreground line-through")}
            >
              {formatName(r.last_name)}, {formatName(r.first_name)}
            </span>
            {r.is_department_lead && (
              <div className="flex items-center gap-1 text-xs text-amber-600">
                <Shield className="h-3 w-3" />
                <span>Dept Lead</span>
              </div>
            )}
          </div>
        ),
      },
      {
        key: "email",
        label: "Email",
        resizable: true,
        initialWidth: 220,
        accessor: (r) => r.company_email,
        render: (r) => (
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[180px] truncate">{r.company_email}</span>
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        resizable: true,
        initialWidth: 150,
        accessor: (r) => r.department || "",
      },
      {
        key: "role",
        label: "Role",
        sortable: true,
        accessor: (r) => r.role,
        render: (r) => <Badge className={getRoleBadgeColor(r.role)}>{getRoleDisplayName(r.role)}</Badge>,
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.employment_status || "active",
        render: (r) => <EmployeeStatusBadge status={r.employment_status || "active"} size="sm" />,
      },
    ],
    []
  )

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter((x): x is string => !!x))).sort(),
    [employees]
  )
  const offices = useMemo(
    () => Array.from(new Set(employees.map((e) => e.office_location).filter((x): x is string => !!x))).sort(),
    [employees]
  )

  const filters: DataTableFilter<Employee>[] = useMemo(
    () => [
      {
        key: "department",
        label: "Department",
        options: departments.map((d) => ({ value: d, label: d })),
        placeholder: "All Departments",
      },
      {
        key: "office_location",
        label: "Location",
        options: offices.map((o) => ({ value: o, label: o })),
        placeholder: "All Locations",
      },
      {
        key: "role",
        label: "Role",
        options: roleList.map((r) => ({ value: r, label: getRoleDisplayName(r) })),
        placeholder: "All Roles",
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "suspended", label: "Suspended" },
          { value: "on_leave", label: "On Leave" },
          { value: "separated", label: "Separated" },
        ],
        placeholder: "Active Statuses",
      },
    ],
    [departments, offices]
  )

  const stats = useMemo(
    () => ({
      total: employees.length,
      admins: employees.filter((s) => ["developer", "super_admin", "admin"].includes(s.role)).length,
      leads: employees.filter((s) => s.is_department_lead).length,
      employeesCount: employees.filter((s) => s.role === "employee").length,
    }),
    [employees]
  )

  // Handle userId from search params (for edit dialog)
  useEffect(() => {
    const userId = searchParams?.get("userId")
    if (userId && employees.length > 0 && !isViewDialogOpen) {
      const user = employees.find((e) => e.id === userId)
      if (user) {
        void handleEditEmployee(user)
      }
    }
  }, [searchParams, employees, isViewDialogOpen, handleEditEmployee])

  return (
    <DataTablePage
      title="Employee Management"
      description="View and manage employee profiles, roles, and permissions."
      icon={Users}
      backLink={{ href: "/admin/hr", label: "Back to HR" }}
      actions={
        <div className="flex items-center gap-2">
          {canReviewApplications && <PendingApplicationsModal onEmployeeCreated={loadData} />}
          {canManageUsers && (
            <Button onClick={() => setIsCreateUserDialogOpen(true)} variant="default" size="sm" className="h-8 gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create User</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            onClick={() => setExportOptionsOpen(true)}
            disabled={employees.length === 0}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            title="Total Staff"
            value={stats.total}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Admins"
            value={stats.admins}
            icon={Shield}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Dept Leads"
            value={stats.leads}
            icon={Shield}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Employees"
            value={stats.employeesCount}
            icon={Users}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      <DataTable<Employee>
        data={employees}
        columns={columns}
        getRowId={(r) => r.id}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        searchPlaceholder="Search name, email, designation..."
        searchFn={(r, q) =>
          `${r.first_name} ${r.last_name} ${r.company_email} ${r.designation}`.toLowerCase().includes(q)
        }
        filters={filters}
        rowActions={[
          {
            label: "View Profile",
            icon: Eye,
            onClick: handleViewEmployeeDetails,
          },
          {
            label: "Edit Employee",
            icon: Pencil,
            onClick: handleEditEmployee,
            hidden: () => !canManageUsers,
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="animate-in fade-in slide-in-from-top-2 grid grid-cols-1 gap-6 p-6 md:grid-cols-3">
              <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
                <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-blue-600 uppercase">
                  <IdCard className="h-4 w-4" /> Identity
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Emp. No.</span>
                    <span className="font-mono">{r.employee_number || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Joined</span>
                    <span>{r.employment_date ? new Date(r.employment_date).toLocaleDateString() : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">DOB</span>
                    <span>{r.date_of_birth ? new Date(r.date_of_birth).toLocaleDateString() : "—"}</span>
                  </div>
                </div>
              </div>
              <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
                <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-emerald-600 uppercase">
                  <Building2 className="h-4 w-4" /> Work info
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Designation</span>
                    <span>{r.designation || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Office</span>
                    <span>{r.office_location || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Address</span>
                    <span className="max-w-[150px] truncate">{r.residential_address || "—"}</span>
                  </div>
                </div>
              </div>
              <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
                <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-amber-600 uppercase">
                  <Calendar className="h-4 w-4" /> Contact
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="text-muted-foreground h-3.5 w-3.5" />
                    <span>{r.phone_number || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="truncate">{r.additional_email || "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(r) => (
          <Card className="group transition-shadow hover:shadow-md">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">
                    {formatName(r.first_name)} {formatName(r.last_name)}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{r.designation || r.department}</p>
                </div>
                <EmployeeStatusBadge status={r.employment_status || "active"} size="sm" />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge className={getRoleBadgeColor(r.role)}>{getRoleDisplayName(r.role)}</Badge>
                {r.is_department_lead && (
                  <Badge variant="outline" className="border-amber-200 text-amber-600">
                    Lead
                  </Badge>
                )}
              </div>

              <div className="text-muted-foreground space-y-1.5 pt-2 text-xs">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="truncate">{r.company_email}</span>
                </div>
                {r.phone_number && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5" />
                    <span>{r.phone_number}</span>
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" className="h-8 w-full" onClick={() => handleViewEmployeeDetails(r)}>
                View Profile
              </Button>
            </CardContent>
          </Card>
        )}
        urlSync
      />

      {/* Modals */}
      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title="Export Employees"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
          { id: "word", label: "Word (.docx)", icon: "word" },
        ]}
        onSelect={(id) => {
          setExportType(id as "excel" | "pdf" | "word")
          setExportOptionsOpen(false)
          setExportEmployeeDialogOpen(true)
        }}
      />

      <EmployeeExportDialog
        isOpen={exportEmployeeDialogOpen}
        onOpenChange={setExportEmployeeDialogOpen}
        exportType={exportType}
        setExportType={setExportType}
        selectedColumns={selectedColumns}
        setSelectedColumns={setSelectedColumns}
        onConfirm={handleExportExecute}
      />

      <CreateUserDialog
        isOpen={isCreateUserDialogOpen}
        onOpenChange={setIsCreateUserDialogOpen}
        form={createUserForm}
        setForm={setCreateUserForm}
        isCreating={isCreatingUser}
        onCreate={handleCreateUser}
        canManageUsers={canManageUsers}
        userProfile={userProfile}
      />

      <EmployeeViewModal
        isOpen={isViewDialogOpen}
        onOpenChange={setIsViewDialogOpen}
        employee={viewEmployeeProfile}
        assignedItems={assignedItems}
        modalViewMode={modalViewMode}
        setModalViewMode={setModalViewMode}
        onSave={handleSaveEmployee}
        isSaving={isSaving}
        editForm={editForm}
        setEditForm={setEditForm}
        showMoreOptions={showMoreOptions}
        setShowMoreOptions={setShowMoreOptions}
        userProfile={userProfile}
        viewEmployeeData={viewEmployeeData}
        onEditEmployee={handleEditEmployee}
        onSignature={handleViewEmployeeSignature}
        loadData={loadData}
        setViewEmployeeProfile={setViewEmployeeProfile}
        canManageUsers={canManageUsers}
        getAvailableRoles={getAvailableRoles}
      />

      <EmployeeDeletionDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        employee={selectedEmployee}
        assignedItems={assignedItems}
        onDelete={() => toast.error("User deletion is disabled. Suspend or deactivate the employee instead.")}
        isDeleting={false}
      />
    </DataTablePage>
  )
}
