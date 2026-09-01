"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Briefcase,
  Building2,
  Cake,
  Calendar,
  ChevronRight,
  Copy,
  Download,
  IdCard,
  Mail,
  MapPin,
  MoreVertical,
  Pencil,
  Phone,
  RefreshCw,
  Settings2,
  Shield,
  SlidersHorizontal,
  Search,
  Tags,
  UserCheck,
  Users,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader, PageWrapper } from "@/components/layout"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"
import { ManageUsersDialog } from "@/components/hr/manage-users-dialog"
import { ManageContractCategoriesDialog } from "@/components/hr/manage-contract-categories-dialog"
import { BirthdayManagerDialog } from "@/components/hr/birthday-manager-dialog"
import { EmployeeViewModal, type EditForm } from "@/components/employees/EmployeeViewModal"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { EmployeeExportDialog } from "@/components/employees/EmployeeExportDialog"
import {
  buildEmployeeExportRows,
  exportEmployeesToExcel,
  exportEmployeesToPDF,
  exportEmployeesToWord,
} from "@/lib/employees/employee-export"
import type { EmployeeAssignedItems, EmployeeProfile, EmployeeViewData } from "@/components/employees/types"
import type { Employee, UserProfile } from "../employees/admin-employee-content"
import { QUERY_KEYS } from "@/lib/query-keys"
import { apiFetch } from "@/lib/api-client"
import { formatName, cn } from "@/lib/utils"
import { formatWATDate, formatDateOfBirth } from "@/lib/utils/date"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { getAssignableRolesForActor } from "@/lib/role-management"
import { normalizeDepartmentName } from "@/shared/departments"
import { logger } from "@/lib/logger"
import type { EmploymentStatus, UserRole } from "@/types/database"

const log = logger("hr-employee3-content")

type TableSortKey = "name" | "employee_number" | "department" | "designation" | "role" | "status"
type Lifecycle = "current" | "former" | "all"
type Population = "employees" | "contract" | "all"

function isContractStaff(employee: Employee): boolean {
  return (employee.employment_type ?? "full_time") === "contract"
}

function fullName(e: Employee): string {
  return `${formatName(e.first_name)} ${formatName(e.last_name)}`.trim() || e.company_email || "Unknown"
}

function sortName(e: Employee): string {
  return `${e.last_name || ""} ${e.first_name || ""}`.trim().toLowerCase()
}

function getInitials(e: Employee): string {
  const a = (e.first_name || "").trim()[0]
  const b = (e.last_name || "").trim()[0]
  const initials = `${a || ""}${b || ""}`.toUpperCase()
  return initials || (e.company_email || "AC").slice(0, 2).toUpperCase()
}

const TABLE_SORT_ACCESSORS: Record<TableSortKey, (e: Employee) => string> = {
  name: (e) => sortName(e),
  employee_number: (e) => e.employee_number || "",
  department: (e) => e.department || "",
  designation: (e) => e.designation || "",
  role: (e) => e.role || "",
  status: (e) => e.employment_status || "active",
}

/** Profile photos are signed server-side; the raw avatar_path is not renderable. */
async function fetchEmployeeAvatars(): Promise<Record<string, string>> {
  const response = await apiFetch("/api/admin/hr/employees/avatars", { cache: "no-store" })
  if (!response.ok) return {}
  const payload = (await response.json().catch(() => ({}))) as { data?: Record<string, string> }
  return payload.data || {}
}

async function fetchAllEmployees(): Promise<Employee[]> {
  const response = await apiFetch("/api/admin/employees", { cache: "no-store" })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || "Failed to fetch employees")
  }
  const payload = (await response.json()) as { data: Employee[] }
  return payload.data || []
}

/** The subset of the `profiles` row the edit dialog reads back from the scoped API. */
type EditableProfileRow = {
  role?: string | null
  admin_routes?: string[] | null
  is_department_lead?: boolean | null
  department?: string | null
  office_location?: string | null
  designation?: string | null
  employee_number?: string | null
  first_name?: string | null
  last_name?: string | null
  other_names?: string | null
  company_email?: string | null
  additional_email?: string | null
  personal_email?: string | null
  phone_number?: string | null
  additional_phone?: string | null
  residential_address?: string | null
  bank_name?: string | null
  bank_account_number?: string | null
  bank_account_name?: string | null
  birthday?: string | null
  birth_year?: number | string | null
  employment_date?: string | null
  job_description?: string | null
  attendance_exempt?: boolean | null
  device_key?: string | null
  employment_status?: string | null
  separation_reason?: string | null
  suspension_reason?: string | null
  suspension_end_date?: string | null
  separation_date?: string | null
  employment_type?: string | null
  contract_categories?: { code?: string } | null
}

function deriveLeadDepartments(department: string, isDepartmentLead: boolean): string[] {
  const canonical = normalizeDepartmentName(department)
  return isDepartmentLead && canonical ? [canonical] : []
}

const EMPTY_EDIT_FORM: EditForm = {
  role: "employee",
  admin_routes: [],
  is_department_lead: false,
  department: "",
  office_location: "",
  designation: "",
  lead_departments: [],
  employee_number: "",
  first_name: "",
  last_name: "",
  other_names: "",
  company_email: "",
  additional_email: "",
  personal_email: "",
  phone_number: "",
  additional_phone: "",
  residential_address: "",
  bank_name: "",
  bank_account_number: "",
  bank_account_name: "",
  birthday: "",
  birth_year: "",
  employment_date: "",
  job_description: "",
  attendance_exempt: false,
  employment_status: "active",
  status_reason_code: "",
  suspension_end_date: "",
  separation_date: "",
  employment_type: "full_time",
  contract_category_code: "",
}

export function Employee3Content({
  initialEmployees,
  userProfile,
}: {
  initialEmployees: Employee[]
  userProfile: UserProfile
}) {
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const [lifecycle, setLifecycle] = useState<Lifecycle>("current")
  const [population, setPopulation] = useState<Population>("employees")
  const [selectedDept, setSelectedDept] = useState("all")
  const [selectedOffice, setSelectedOffice] = useState("all")
  const [selectedRole, setSelectedRole] = useState("all")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [peeked, setPeeked] = useState<Employee | null>(null)
  const [tableSort, setTableSort] = useState<{ key: TableSortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  })

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [modalViewMode, setModalViewMode] = useState<"profile" | "employment" | "edit" | "signature">("profile")
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
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM)
  const [isSaving, setIsSaving] = useState(false)

  const [manageUsersOpen, setManageUsersOpen] = useState(false)
  const [categoriesDialogOpen, setCategoriesDialogOpen] = useState(false)
  const [birthdayManagerOpen, setBirthdayManagerOpen] = useState(false)

  // Desktop table only. The mobile A-Z list scrolls continuously on purpose —
  // an address book is jumped through by letter, never paged.
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportEmployeeDialogOpen, setExportEmployeeDialogOpen] = useState(false)
  const [exportType, setExportType] = useState<"excel" | "pdf" | "word" | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<Record<string, boolean>>({
    "#": true,
    "Employee No.": true,
    "Last Name": true,
    "First Name": true,
    Email: true,
    Department: true,
    Role: true,
    Designation: true,
    "Phone Number": true,
    "Employment Date": true,
  })

  const canManageUsers = ["developer", "super_admin", "admin"].includes(userProfile?.role || "")
  const canReviewApplications = canManageUsers || Boolean(userProfile?.is_department_lead)

  const {
    data: employees = [],
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminEmployees(),
    queryFn: fetchAllEmployees,
    initialData: initialEmployees,
  })

  const { data: avatars = {} } = useQuery({
    queryKey: ["admin-hr-employee-avatars"],
    queryFn: fetchEmployeeAvatars,
    staleTime: 5 * 60 * 1000,
  })

  const loadData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminEmployees() })
  }, [queryClient])

  const departmentOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter((d): d is string => Boolean(d)))).sort(),
    [employees]
  )
  const officeOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.office_location).filter((o): o is string => Boolean(o)))).sort(),
    [employees]
  )
  const roleOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.role).filter(Boolean))).sort(),
    [employees]
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees
      .filter((e) => {
        if (lifecycle === "current" && e.employment_status === "exited") return false
        if (lifecycle === "former" && e.employment_status !== "exited") return false
        if (population === "employees" && isContractStaff(e)) return false
        if (population === "contract" && !isContractStaff(e)) return false
        if (selectedDept !== "all" && e.department !== selectedDept) return false
        if (selectedOffice !== "all" && e.office_location !== selectedOffice) return false
        if (selectedRole !== "all" && e.role !== selectedRole) return false
        if (!q) return true
        return (
          fullName(e).toLowerCase().includes(q) ||
          (e.company_email || "").toLowerCase().includes(q) ||
          (e.employee_number || "").toLowerCase().includes(q) ||
          (e.department || "").toLowerCase().includes(q) ||
          (e.designation || "").toLowerCase().includes(q) ||
          (e.phone_number || "").toLowerCase().includes(q)
        )
      })
      .sort((a, b) => sortName(a).localeCompare(sortName(b)))
  }, [employees, search, lifecycle, population, selectedDept, selectedOffice, selectedRole])

  // Mobile A-Z sections key off surname, which is how an HR staff list is read.
  const sections = useMemo(() => {
    const map = new Map<string, Employee[]>()
    for (const row of filteredRows) {
      const letter = (row.last_name || row.first_name || "#").trim()[0]?.toUpperCase() || "#"
      const key = /[A-Z]/.test(letter) ? letter : "#"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredRows])

  const tableRows = useMemo(() => {
    const accessor = TABLE_SORT_ACCESSORS[tableSort.key]
    const sorted = [...filteredRows].sort((a, b) => accessor(a).localeCompare(accessor(b)))
    return tableSort.direction === "asc" ? sorted : sorted.reverse()
  }, [filteredRows, tableSort])

  const toggleTableSort = (key: TableSortKey) => {
    setTableSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    )
  }

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const pagedTableRows = useMemo(() => tableRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [tableRows, page])

  // Narrowing the result set can strand the user on a page that no longer exists.
  useEffect(() => {
    setPage(0)
  }, [search, lifecycle, population, selectedDept, selectedOffice, selectedRole])

  const stats = useMemo(() => {
    const total = filteredRows.length
    const admins = filteredRows.filter((e) => ["developer", "super_admin", "admin"].includes(e.role)).length
    const leads = filteredRows.filter((e) => e.is_department_lead).length
    const departments = new Set(filteredRows.map((e) => e.department).filter(Boolean)).size
    return { total, admins, leads, departments }
  }, [filteredRows])

  const activeFilterCount =
    (lifecycle !== "current" ? 1 : 0) +
    (population !== "employees" ? 1 : 0) +
    (selectedDept !== "all" ? 1 : 0) +
    (selectedOffice !== "all" ? 1 : 0) +
    (selectedRole !== "all" ? 1 : 0)

  const resetFilters = () => {
    setLifecycle("current")
    setPopulation("employees")
    setSelectedDept("all")
    setSelectedOffice("all")
    setSelectedRole("all")
  }

  const copyValue = (value: string, label: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`Copied ${label}`, { description: value }))
      .catch(() => toast.error("Couldn't copy — clipboard access was blocked"))
  }

  const handleViewEmployeeDetails = async (employee: Employee) => {
    try {
      setPeeked(null)
      setSelectedEmployee(employee)
      setModalViewMode("profile")
      setViewEmployeeProfile(null)
      setViewEmployeeData({ tasks: [], assets: [], documentation: [] })
      setIsViewDialogOpen(true)

      const response = await apiFetch(`/api/admin/hr/employees/${employee.id}/overview`, { cache: "no-store" })
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

      const detailResponse = await apiFetch(`/api/admin/hr/employees/${employee.id}/details`)
      if (detailResponse.ok) setAssignedItems(await detailResponse.json())
    } catch (err: unknown) {
      log.error({ err: String(err) }, "error loading employee details")
      toast.error("Failed to load employee details")
    }
  }

  const handleEditEmployee = useCallback(
    async (employee: Employee) => {
      if (!canManageUsers) {
        toast.error("You can view users but cannot edit them")
        return
      }
      try {
        setPeeked(null)
        setSelectedEmployee(employee)

        const profileRes = await apiFetch(`/api/admin/hr/employees/${employee.id}/profile`, { cache: "no-store" })
        const profilePayload = (await profileRes.json().catch(() => ({}))) as {
          error?: string
          data?: EditableProfileRow
        }
        if (!profileRes.ok) throw new Error(profilePayload.error || "Failed to load employee profile")
        const fullProfile = profilePayload.data

        if (fullProfile) {
          const isDepartmentLead = Boolean(fullProfile.is_department_lead)
          const normalizedDepartment = fullProfile.department || ""
          const contractCategoryCode = (fullProfile.contract_categories as { code?: string } | null)?.code || ""

          setEditForm({
            role: (fullProfile.role as UserRole) || "employee",
            admin_routes: Array.isArray(fullProfile.admin_routes) ? fullProfile.admin_routes : [],
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
            personal_email: fullProfile.personal_email || "",
            phone_number: fullProfile.phone_number || "",
            additional_phone: fullProfile.additional_phone || "",
            residential_address: fullProfile.residential_address || "",
            bank_name: fullProfile.bank_name || "",
            bank_account_number: fullProfile.bank_account_number || "",
            bank_account_name: fullProfile.bank_account_name || "",
            birthday: fullProfile.birthday || "",
            birth_year: fullProfile.birth_year != null ? String(fullProfile.birth_year) : "",
            employment_date: fullProfile.employment_date || "",
            job_description: fullProfile.job_description || "",
            attendance_exempt: Boolean(fullProfile.attendance_exempt),
            device_key: fullProfile.device_key || "",
            employment_status: (fullProfile.employment_status as EmploymentStatus) || "active",
            status_reason_code: fullProfile.separation_reason || fullProfile.suspension_reason || "",
            suspension_end_date: fullProfile.suspension_end_date || "",
            separation_date: fullProfile.separation_date || "",
            employment_type: (fullProfile.employment_type as "full_time" | "part_time" | "contract") || "full_time",
            contract_category_code: contractCategoryCode,
          })
        }

        setViewEmployeeProfile(employee as unknown as EmployeeProfile)
        setModalViewMode("edit")
        setIsViewDialogOpen(true)
      } catch (err: unknown) {
        log.error({ err: String(err) }, "error loading employee for edit")
        toast.error("Failed to load employee details")
      }
    },
    [canManageUsers]
  )

  /**
   * Profile-field save only. Status changes and staff-type conversions run through
   * their own endpoints on the main employees page, which owns those workflows —
   * this page deliberately does not duplicate that multi-endpoint logic.
   */
  const handleSaveEmployee = async () => {
    if (isSaving || !canManageUsers || !selectedEmployee) return
    setIsSaving(true)
    try {
      const companyEmail = editForm.company_email.trim().toLowerCase()
      const additionalEmail = editForm.additional_email.trim().toLowerCase()
      const personalEmail = editForm.personal_email.trim().toLowerCase()

      if (!companyEmail) {
        toast.error("Valid company email is required")
        return
      }

      const emailSyncResponse = await apiFetch(`/api/admin/hr/employees/${selectedEmployee.id}/email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyEmail, additionalEmail: additionalEmail || null }),
      })
      if (!emailSyncResponse.ok) throw new Error("Failed to sync employee login email")

      const saveResponse = await apiFetch(`/api/admin/hr/employees/${selectedEmployee.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editForm.role,
          admin_routes: editForm.role === "admin" ? editForm.admin_routes : null,
          department: editForm.department,
          office_location: editForm.office_location || null,
          designation: editForm.designation || null,
          is_department_lead: editForm.is_department_lead,
          first_name: editForm.first_name || "",
          last_name: editForm.last_name || "",
          other_names: editForm.other_names || null,
          company_email: companyEmail,
          additional_email: additionalEmail || null,
          personal_email: personalEmail || null,
          phone_number: editForm.phone_number || null,
          additional_phone: editForm.additional_phone || null,
          residential_address: editForm.residential_address || null,
          bank_name: editForm.bank_name || null,
          bank_account_number: editForm.bank_account_number || null,
          bank_account_name: editForm.bank_account_name || null,
          birthday: editForm.birthday || null,
          birth_year: editForm.birth_year || null,
          employment_date: editForm.employment_date || null,
          job_description: editForm.job_description || null,
          attendance_exempt: editForm.attendance_exempt,
        }),
      })
      const savePayload = (await saveResponse.json().catch(() => ({}))) as {
        error?: string
        data?: EmployeeProfile | null
      }
      if (!saveResponse.ok) throw new Error(savePayload.error || "Failed to update employee")

      toast.success("Employee updated successfully")
      setModalViewMode("profile")
      if (savePayload.data) setViewEmployeeProfile(savePayload.data)
      loadData()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err: message }, "error updating employee")
      toast.error(message || "Failed to update employee")
    } finally {
      setIsSaving(false)
    }
  }

  const handleViewEmployeeSignature = useCallback((employee: EmployeeProfile) => {
    setSelectedEmployee(employee as unknown as Employee)
    setViewEmployeeProfile(employee)
    setModalViewMode("signature")
    setIsViewDialogOpen(true)
  }, [])

  const handleExportExecute = async () => {
    if (!exportType || filteredRows.length === 0) return
    try {
      const exportRows = buildEmployeeExportRows(filteredRows, { selectedColumns })
      if (exportType === "excel") await exportEmployeesToExcel(exportRows)
      else if (exportType === "pdf") await exportEmployeesToPDF(filteredRows, { selectedColumns })
      else if (exportType === "word") await exportEmployeesToWord(exportRows)
      setExportEmployeeDialogOpen(false)
    } catch {
      toast.error("Export failed")
    }
  }

  const getAvailableRoles = (): UserRole[] =>
    userProfile ? (getAssignableRolesForActor(userProfile.role) as UserRole[]) : []

  const clearEverything = () => {
    setSearch("")
    resetFilters()
  }

  return (
    <PageWrapper maxWidth="full" background="gradient" spacing="compact" className="pb-12">
      <div className="flex flex-row items-end justify-between gap-3 sm:items-center">
        <PageHeader
          title="Employees"
          icon={Users}
          backLink={{ href: "/admin/hr", label: "Back to HR" }}
          className="mb-0 min-w-0 pb-0"
        />
        <div className="flex shrink-0 items-center gap-2">
          {(canManageUsers || canReviewApplications) && (
            <Button size="sm" onClick={() => setManageUsersOpen(true)} className="h-9 gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Manage Users</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading || isRefetching}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isRefetching) && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportOptionsOpen(true)}
            disabled={filteredRows.length === 0}
            className="h-9 gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" title="More actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setBirthdayManagerOpen(true)}>
                <Cake className="mr-2 h-4 w-4" />
                Birthday Manager
              </DropdownMenuItem>
              {(canManageUsers || canReviewApplications) && (
                <DropdownMenuItem onClick={() => setCategoriesDialogOpen(true)}>
                  <Tags className="mr-2 h-4 w-4" />
                  Manage Categories
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Sticky search + a single filter trigger */}
      <div className="bg-background sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b px-4 py-2 shadow-sm sm:static sm:mx-0 sm:border-b-0 sm:px-0 sm:py-0 sm:shadow-none">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search name, staff ID, email, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card h-10 border-2 pr-9 pl-10 shadow-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter employees</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              <SegmentedFilter
                label="Employment"
                value={lifecycle}
                onChange={(v) => setLifecycle(v as Lifecycle)}
                options={[
                  { value: "current", label: "Current" },
                  { value: "former", label: "Former" },
                  { value: "all", label: "All" },
                ]}
              />
              <SegmentedFilter
                label="Staff type"
                value={population}
                onChange={(v) => setPopulation(v as Population)}
                options={[
                  { value: "employees", label: "Employees" },
                  { value: "contract", label: "Contract" },
                  { value: "all", label: "All" },
                ]}
              />
              <PillFilter
                label="Department"
                value={selectedDept}
                onChange={setSelectedDept}
                options={departmentOptions}
              />
              <PillFilter label="Office" value={selectedOffice} onChange={setSelectedOffice} options={officeOptions} />
              <PillFilter
                label="Role"
                value={selectedRole}
                onChange={setSelectedRole}
                options={roleOptions}
                renderLabel={(v) => getRoleDisplayName(v as UserRole)}
              />
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={resetFilters}>
                Reset
              </Button>
              <SheetClose asChild>
                <Button className="flex-1">Apply</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Separate stat badges */}
      <div className="-mt-1 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {stats.total} {stats.total === 1 ? "person" : "people"}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {stats.departments} {stats.departments === 1 ? "department" : "departments"}
        </Badge>
        {stats.leads > 0 && (
          <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
            {stats.leads} {stats.leads === 1 ? "lead" : "leads"}
          </Badge>
        )}
        {stats.admins > 0 && (
          <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
            {stats.admins} {stats.admins === 1 ? "admin" : "admins"}
          </Badge>
        )}
      </div>

      {error ? (
        <div className="bg-card flex flex-col items-center rounded-xl border p-10 text-center">
          <p className="text-sm text-red-500">{error instanceof Error ? error.message : "Failed to load employees"}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Mobile: A-Z sectioned staff list */}
          <div className="md:hidden">
            {isLoading ? (
              <ListSkeleton />
            ) : filteredRows.length === 0 ? (
              <EmptyState hasFilters={Boolean(search) || activeFilterCount > 0} onClear={clearEverything} />
            ) : (
              <div className="divide-y">
                {sections.map(([letter, people]) => (
                  <div key={letter}>
                    <div className="bg-muted text-muted-foreground sticky top-[57px] z-[5] border-b px-1 py-1 text-xs font-bold">
                      {letter}
                    </div>
                    {people.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => setPeeked(person)}
                        className="hover:bg-muted/40 flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors"
                      >
                        <EmployeeAvatar
                          employee={person}
                          src={avatars[person.id]}
                          className="h-10 w-10"
                          fallbackClassName="text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "truncate text-sm font-medium",
                                person.employment_status === "exited" && "text-muted-foreground line-through"
                              )}
                            >
                              {formatName(person.last_name)}, {formatName(person.first_name)}
                            </span>
                            {person.is_department_lead && <Shield className="h-3 w-3 shrink-0 text-amber-600" />}
                          </div>
                          <p className="text-muted-foreground truncate text-xs">
                            {[person.designation, person.department].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        <ChevronRight className="text-muted-foreground/50 h-4 w-4 shrink-0" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop: dense sortable table */}
          <div className="hidden md:block">
            {isLoading ? (
              <div className="bg-card space-y-2 rounded-xl border p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-muted h-8 w-full animate-pulse rounded" />
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <EmptyState hasFilters={Boolean(search) || activeFilterCount > 0} onClear={clearEverything} />
            ) : (
              <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wide uppercase">
                      <tr>
                        <th className="w-12 px-4 py-3 text-center">S/N</th>
                        <SortableHeader
                          label="Staff ID"
                          sortKey="employee_number"
                          current={tableSort}
                          onSort={toggleTableSort}
                        />
                        <SortableHeader label="Name" sortKey="name" current={tableSort} onSort={toggleTableSort} />
                        <SortableHeader
                          label="Department"
                          sortKey="department"
                          current={tableSort}
                          onSort={toggleTableSort}
                        />
                        <SortableHeader
                          label="Designation"
                          sortKey="designation"
                          current={tableSort}
                          onSort={toggleTableSort}
                        />
                        <SortableHeader label="Role" sortKey="role" current={tableSort} onSort={toggleTableSort} />
                        <SortableHeader label="Status" sortKey="status" current={tableSort} onSort={toggleTableSort} />
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pagedTableRows.map((person, index) => (
                        <tr
                          key={person.id}
                          className="hover:bg-muted/40 cursor-pointer"
                          onClick={() => setPeeked(person)}
                        >
                          <td className="text-muted-foreground px-4 py-3 text-center font-mono">
                            {page * PAGE_SIZE + index + 1}
                          </td>
                          <td className="text-muted-foreground px-4 py-3 font-mono">{person.employee_number || "—"}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <EmployeeAvatar
                                employee={person}
                                src={avatars[person.id]}
                                className="h-8 w-8"
                                fallbackClassName="text-[10px]"
                              />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "text-foreground font-semibold",
                                      person.employment_status === "exited" && "text-muted-foreground line-through"
                                    )}
                                  >
                                    {formatName(person.last_name)}, {formatName(person.first_name)}
                                  </span>
                                  {person.is_department_lead && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                                      <Shield className="h-3 w-3" />
                                      Lead
                                    </span>
                                  )}
                                </div>
                                <p className="text-muted-foreground text-[11px]">{person.company_email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {person.department || <span className="text-muted-foreground/60">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {person.designation || <span className="text-muted-foreground/60">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={getRoleBadgeColor(person.role)}>{getRoleDisplayName(person.role)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <EmployeeStatusBadge status={person.employment_status || "active"} size="sm" />
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => void handleViewEmployeeDetails(person)}
                              >
                                Profile
                              </Button>
                              {canManageUsers && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => void handleEditEmployee(person)}
                                  title="Edit employee"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-4 border-t px-4 py-3 text-sm">
                    <p className="text-muted-foreground">
                      Showing{" "}
                      <span className="text-foreground font-medium">
                        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, tableRows.length)}
                      </span>{" "}
                      of <span className="text-foreground font-medium">{tableRows.length}</span>
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page + 1 >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick-peek sheet — the same interaction on both breakpoints */}
      <Sheet open={peeked !== null} onOpenChange={(open) => !open && setPeeked(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {peeked && (
            <>
              <SheetHeader className="items-center text-center">
                <EmployeeAvatar
                  employee={peeked}
                  src={avatars[peeked.id]}
                  className="h-16 w-16"
                  fallbackClassName="text-lg"
                />
                <SheetTitle className="mt-1 text-base">{fullName(peeked)}</SheetTitle>
                {peeked.designation && <p className="text-muted-foreground text-sm">{peeked.designation}</p>}
                <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                  <Badge className={getRoleBadgeColor(peeked.role)}>{getRoleDisplayName(peeked.role)}</Badge>
                  <EmployeeStatusBadge status={peeked.employment_status || "active"} size="sm" />
                  {peeked.is_department_lead && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                    >
                      <Shield className="h-3 w-3" />
                      Dept Lead
                    </Badge>
                  )}
                </div>
              </SheetHeader>

              <div className="space-y-1 px-4">
                <DetailRow icon={IdCard} label="Staff ID" value={peeked.employee_number} onCopy={copyValue} />
                <DetailRow icon={Mail} label="Email" value={peeked.company_email} onCopy={copyValue} />
                {peeked.additional_email && (
                  <DetailRow icon={Mail} label="Alt. email" value={peeked.additional_email} onCopy={copyValue} muted />
                )}
                <DetailRow icon={Phone} label="Phone" value={peeked.phone_number} onCopy={copyValue} />
                <DetailRow icon={Building2} label="Department" value={peeked.department} onCopy={copyValue} />
                <DetailRow icon={MapPin} label="Office" value={peeked.office_location} onCopy={copyValue} />
                <DetailRow
                  icon={Briefcase}
                  label="Staff type"
                  value={isContractStaff(peeked) ? "Contract" : "Employee"}
                  onCopy={copyValue}
                />
                <DetailRow
                  icon={Calendar}
                  label="Joined"
                  value={peeked.employment_date ? formatWATDate(peeked.employment_date) : null}
                  onCopy={copyValue}
                />
                <DetailRow
                  icon={UserCheck}
                  label="Date of birth"
                  value={formatDateOfBirth(peeked.date_of_birth, peeked.birthday) ?? null}
                  onCopy={copyValue}
                />
              </div>

              <SheetFooter className="flex-row gap-2">
                <Button className="flex-1 gap-2" onClick={() => void handleViewEmployeeDetails(peeked)}>
                  <Users className="h-4 w-4" />
                  Full profile
                </Button>
                {canManageUsers && (
                  <Button variant="outline" className="flex-1 gap-2" onClick={() => void handleEditEmployee(peeked)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

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
        userProfile={userProfile}
        viewEmployeeData={viewEmployeeData}
        onEditEmployee={(profile) => void handleEditEmployee(profile as unknown as Employee)}
        onSignature={handleViewEmployeeSignature}
        canManageUsers={canManageUsers}
        getAvailableRoles={getAvailableRoles}
      />

      <ManageUsersDialog
        open={manageUsersOpen}
        onOpenChange={setManageUsersOpen}
        employees={employees}
        onSuccess={loadData}
        canManageUsers={canManageUsers}
        userProfile={userProfile}
      />

      <ManageContractCategoriesDialog isOpen={categoriesDialogOpen} onOpenChange={setCategoriesDialogOpen} />

      <BirthdayManagerDialog open={birthdayManagerOpen} onOpenChange={setBirthdayManagerOpen} />
    </PageWrapper>
  )
}

// ── Building blocks ─────────────────────────────────────────────────────────

/** Real profile photo when one exists, initials only as the fallback. */
function EmployeeAvatar({
  employee,
  src,
  className,
  fallbackClassName,
}: {
  employee: Employee
  src?: string
  className?: string
  fallbackClassName?: string
}) {
  return (
    <Avatar className={cn("shrink-0 border", className)}>
      {src && <AvatarImage src={src} alt={fullName(employee)} />}
      <AvatarFallback className={cn("bg-primary/10 text-primary font-bold", fallbackClassName)}>
        {getInitials(employee)}
      </AvatarFallback>
    </Avatar>
  )
}

function SortableHeader({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string
  sortKey: TableSortKey
  current: { key: TableSortKey; direction: "asc" | "desc" }
  onSort: (key: TableSortKey) => void
}) {
  const isActive = current.key === sortKey
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        {label}
        {isActive ? (
          current.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
  onCopy,
  muted,
}: {
  icon: React.ElementType
  label: string
  value: string | null | undefined
  onCopy: (value: string, label: string) => void
  muted?: boolean
}) {
  if (!value) return null
  return (
    <button
      type="button"
      onClick={() => onCopy(value, label)}
      className="hover:bg-muted/40 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
    >
      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-[11px]">{label}</p>
        <p className={cn("truncate text-sm", muted && "text-muted-foreground")}>{value}</p>
      </div>
      <Copy className="text-muted-foreground/60 h-3.5 w-3.5 shrink-0" />
    </button>
  )
}

function SegmentedFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded-lg border py-2 text-xs font-medium transition-colors",
              value === opt.value ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PillFilter({
  label,
  value,
  onChange,
  options,
  renderLabel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  renderLabel?: (value: string) => string
}) {
  if (options.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            value === "all" ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          All
        </button>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              value === opt ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {renderLabel ? renderLabel(opt) : opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-1 py-2.5">
          <div className="bg-muted h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="bg-muted h-3.5 w-32 rounded" />
            <div className="bg-muted h-3 w-20 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
      <Users className="text-muted-foreground/50 h-10 w-10" />
      <h3 className="mt-3 text-sm font-semibold">No employees found</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-xs">
        {hasFilters ? "Nothing matches your search or filters." : "Employee records will appear here."}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onClear} className="mt-4">
          Clear filters
        </Button>
      )}
    </div>
  )
}
