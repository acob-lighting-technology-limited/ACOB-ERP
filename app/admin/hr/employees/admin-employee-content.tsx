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
import { formatWATDate, formatDateOfBirth } from "@/lib/utils/date"
import {
  Users,
  UserCheck,
  UserMinus,
  Briefcase,
  FileSignature,
  Shield,
  Mail,
  Phone,
  Download,
  Pencil,
  Eye,
  Building2,
  Calendar,
  IdCard,
  Settings2,
  Tags,
  Cake,
  MoreVertical,
  ArrowRight,
  UserCircle,
} from "lucide-react"
import type { UserRole, EmploymentStatus } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { formValidation } from "@/lib/validation"
import { getAssignableRolesForActor } from "@/lib/role-management"
import { logger } from "@/lib/logger"
import { ManageUsersDialog } from "@/components/hr/manage-users-dialog"
import { ManageContractCategoriesDialog } from "@/components/hr/manage-contract-categories-dialog"
import { normalizeDepartmentName } from "@/shared/departments"
import {
  EmployeeViewModal,
  type EditForm,
  SUSPENSION_REASONS,
  EXIT_REASONS,
} from "@/components/employees/EmployeeViewModal"
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
import { BirthdayManagerDialog } from "@/components/hr/birthday-manager-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"
import { apiFetch } from "@/lib/api-client"

const log = logger("hr-employees-admin-employee-content")

type EmployeeGender = "male" | "female" | "prefer_not_to_say" | "unspecified"

const genderFilterOptions: { value: EmployeeGender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "unspecified", label: "Unspecified" },
]

async function fetchAllEmployees(): Promise<Employee[]> {
  const response = await apiFetch("/api/admin/employees", { cache: "no-store" })
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
  personal_email: string | null
  department: string
  designation: string | null
  role: UserRole
  admin_routes?: string[] | null
  phone_number: string | null
  additional_phone: string | null
  gender?: EmployeeGender | null
  residential_address: string | null
  office_location: string | null
  device_key?: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  date_of_birth: string | null
  birthday: string | null
  employment_date: string | null
  is_admin: boolean
  is_department_lead: boolean
  lead_departments: string[]
  employment_status: EmploymentStatus
  employment_type?: "full_time" | "part_time" | "contract"
  contract_category_id?: string | null
  contract_categories?: { id: string; name: string; code: string } | null
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
  const canonical = normalizeDepartmentName(department)
  return isDepartmentLead && canonical ? [canonical] : []
}

const roleList: UserRole[] = ["visitor", "employee", "admin", "super_admin", "developer"]

/**
 * Contract staff are a distinct population: engaged per contract, not on the regular
 * payroll, and largely not platform users. They are identified by employment_type, which
 * survives the profile normalisation — company_email being blank was only ever a symptom
 * of the same incomplete onboarding, never the defining attribute.
 *
 * NULL employment_type is treated as full time to match the Staff type filter.
 */
function isContractStaff(employee: Employee): boolean {
  return (employee.employment_type ?? "full_time") === "contract"
}

export function AdminEmployeeContent({ initialEmployees, userProfile }: AdminEmployeeContentProps) {
  const searchParams = useSearchParams()
  const [supabase] = useState(() => createClient())
  const queryClient = useQueryClient()

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [modalViewMode, setModalViewMode] = useState<"profile" | "employment" | "edit" | "signature">("profile")

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
    "Date of Birth": true,
    "Employment Date": true,
    "Employment Type": true,
    "Contract Category": true,
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

  const [manageUsersOpen, setManageUsersOpen] = useState(false)
  const [categoriesDialogOpen, setCategoriesDialogOpen] = useState(false)
  const [birthdayManagerOpen, setBirthdayManagerOpen] = useState(false)

  const [editForm, setEditForm] = useState<EditForm>({
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
  })

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

  // Rows currently visible in the table (after search + filters + sort), kept in
  // sync via the DataTable's onProcessedDataChange so exports match what the user sees.
  const [processedEmployees, setProcessedEmployees] = useState<Employee[]>(initialEmployees)

  // ── Lifecycle scope ────────────────────────────────────────────────────────
  // Employment lifecycle is a scope, not a filter: the directory means current
  // staff unless you deliberately ask for leavers. Keeping it in the tab row
  // (rather than as a pre-ticked Status option) makes the exclusion visible and
  // leaves the filter dropdowns free of values the user never chose.
  const [lifecycleTab, setLifecycleTab] = useState<"current" | "former" | "all">("current")

  const lifecycleEmployees = useMemo(() => {
    if (lifecycleTab === "current") return employees.filter((e) => e.employment_status !== "exited")
    if (lifecycleTab === "former") return employees.filter((e) => e.employment_status === "exited")
    return employees
  }, [employees, lifecycleTab])

  const lifecycleTabs: DataTableTab[] = useMemo(() => {
    const former = employees.filter((e) => e.employment_status === "exited").length
    return [
      { key: "current", label: `Current (${employees.length - former})`, icon: UserCheck },
      { key: "former", label: `Former (${former})`, icon: UserMinus },
      { key: "all", label: `All (${employees.length})`, icon: Users },
    ]
  }, [employees])

  // ── Population scope ───────────────────────────────────────────────────────
  // ~47 contract staff sit alongside the ~48 regular employees. Both are real staff,
  // but they are managed differently and are rarely wanted in the same list, so the
  // page opens on regular employees. Like the lifecycle scope, this is a named tab
  // carrying its own count — the excluded population is stated on screen rather than
  // hidden behind a filter value the user never chose.
  const [populationTab, setPopulationTab] = useState<"employees" | "contract" | "all">("employees")

  const populationTabs: DataTableTab[] = useMemo(() => {
    const contract = lifecycleEmployees.filter(isContractStaff).length
    return [
      { key: "employees", label: `Employees (${lifecycleEmployees.length - contract})`, icon: Briefcase },
      { key: "contract", label: `Contract Staff (${contract})`, icon: FileSignature },
      { key: "all", label: `All Staff (${lifecycleEmployees.length})`, icon: Users },
    ]
  }, [lifecycleEmployees])

  const scopedEmployees = useMemo(() => {
    if (populationTab === "employees") return lifecycleEmployees.filter((e) => !isContractStaff(e))
    if (populationTab === "contract") return lifecycleEmployees.filter(isContractStaff)
    return lifecycleEmployees
  }, [lifecycleEmployees, populationTab])

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
        const { data: fullProfile, error: profileErr } = await supabase
          .from("profiles")
          .select("*, contract_categories(code)")
          .eq("id", employee.id)
          .single()

        if (profileErr) {
          throw profileErr
        }

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

      // Also fetch full assigned items for deletion check or detailed view
      const detailResponse = await apiFetch(`/api/admin/hr/employees/${employee.id}/details`)
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
      const personalEmail = editForm.personal_email.trim().toLowerCase()

      if (!companyEmail || !formValidation.isCompanyEmail(companyEmail)) {
        toast.error("Valid company email is required")
        setIsSaving(false)
        return
      }

      // 1. Fetch current profile state from DB to compare changes
      const { data: currentProfile, error: fetchErr } = await supabase
        .from("profiles")
        .select("*, contract_categories(code)")
        .eq("id", selectedEmployee.id)
        .single()

      if (fetchErr || !currentProfile) {
        throw new Error("Could not retrieve current employee record for verification")
      }

      const currentType = currentProfile.employment_type || "full_time"
      const currentCatCode = (currentProfile.contract_categories as { code?: string } | null)?.code || ""
      const isTypeOrCatChanged =
        editForm.employment_type !== currentType ||
        (editForm.employment_type === "contract" && editForm.contract_category_code !== currentCatCode)

      // 2. If Staff Type or Contract Category changed, call convert-type RPC endpoint
      if (isTypeOrCatChanged) {
        if (editForm.employment_type === "contract" && !editForm.contract_category_code) {
          toast.error("Please select a contract category for contract staff")
          setIsSaving(false)
          return
        }

        const convertRes = await apiFetch("/api/admin/employees/convert-type", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: selectedEmployee.id,
            newType: editForm.employment_type,
            newCategoryCode: editForm.employment_type === "contract" ? editForm.contract_category_code : undefined,
          }),
        })

        const convertPayload = (await convertRes.json().catch(() => ({}))) as {
          error?: string
          success?: boolean
          newEmployeeNumber?: string
        }

        if (!convertRes.ok) {
          throw new Error(convertPayload.error || "Failed to convert employee classification")
        }

        if (convertPayload.newEmployeeNumber) {
          toast.success(`Converted to ${editForm.employment_type}. New Staff ID: ${convertPayload.newEmployeeNumber}`)
        }
      }

      // 3. If Employment Status or separation/suspension details changed, call HR status API
      const currentStatus = currentProfile.employment_status || "active"
      const isStatusChanged =
        editForm.employment_status !== currentStatus ||
        (editForm.employment_status === "exited" &&
          (editForm.status_reason_code !== (currentProfile.separation_reason || "") ||
            editForm.separation_date !== (currentProfile.separation_date || ""))) ||
        (editForm.employment_status === "suspended" &&
          (editForm.status_reason_code !== (currentProfile.suspension_reason || "") ||
            editForm.suspension_end_date !== (currentProfile.suspension_end_date || "")))

      if (isStatusChanged) {
        if (editForm.employment_status === "suspended" && !editForm.status_reason_code) {
          toast.error("Please select a suspension reason")
          setIsSaving(false)
          return
        }

        if (editForm.employment_status === "exited" && (!editForm.status_reason_code || !editForm.separation_date)) {
          toast.error("Please provide both a separation reason and separation date")
          setIsSaving(false)
          return
        }

        const reasonLabel =
          editForm.employment_status === "suspended"
            ? SUSPENSION_REASONS.find((r) => r.value === editForm.status_reason_code)?.label ||
              editForm.status_reason_code
            : editForm.employment_status === "exited"
              ? EXIT_REASONS.find((r) => r.value === editForm.status_reason_code)?.label || editForm.status_reason_code
              : editForm.status_reason_code

        const statusRes = await apiFetch(`/api/v1/hr/employees/${selectedEmployee.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: editForm.employment_status,
            reason_code: editForm.status_reason_code || undefined,
            reason_label: reasonLabel || undefined,
            suspension_end_date:
              editForm.employment_status === "suspended" ? editForm.suspension_end_date || null : undefined,
            separation_date: editForm.employment_status === "exited" ? editForm.separation_date || null : undefined,
          }),
        })

        const statusPayload = (await statusRes.json().catch(() => ({}))) as {
          error?: string
          has_blockers?: boolean
          blockers?: string[]
        }

        if (!statusRes.ok) {
          if (statusPayload.has_blockers && statusPayload.blockers?.length) {
            throw new Error(`Cannot change status due to active blockers: ${statusPayload.blockers.join(", ")}`)
          }
          throw new Error(statusPayload.error || "Failed to update employee status")
        }
      }

      // 4. Update general profile fields
      const canonicalDepartment = normalizeDepartmentName(editForm.department)
      const leadDepartments = deriveLeadDepartments(canonicalDepartment, editForm.is_department_lead)

      let departmentId: string | null = null
      if (canonicalDepartment) {
        const { data: deptRow } = await supabase
          .from("departments")
          .select("id")
          .eq("name", canonicalDepartment)
          .maybeSingle()
        departmentId = deptRow?.id || null
      }

      const updateData: Database["public"]["Tables"]["profiles"]["Update"] = {
        role: editForm.role,
        admin_routes: editForm.role === "admin" ? editForm.admin_routes : null,
        department: canonicalDepartment || null,
        department_id: departmentId,
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
        birthday: editForm.birthday || null,
        birth_year: editForm.birth_year ? Number(editForm.birth_year) : null,
        employment_date: editForm.employment_date || null,
        job_description: editForm.job_description || null,
      }

      ;(updateData as Record<string, unknown>).attendance_exempt = editForm.attendance_exempt
      ;(updateData as Record<string, unknown>).personal_email = personalEmail || null

      const emailSyncResponse = await apiFetch(`/api/admin/hr/employees/${selectedEmployee.id}/email`, {
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
      const errMessage =
        _error instanceof Error
          ? _error.message
          : typeof _error === "object" && _error !== null
            ? ((_error as { message?: string; details?: string }).message ??
              (_error as { details?: string }).details ??
              JSON.stringify(_error))
            : String(_error)
      log.error({ err: errMessage }, "error updating employee")
      toast.error(errMessage || "Failed to update employee")
    } finally {
      setIsSaving(false)
    }
  }

  const handleExportExecute = async () => {
    // Export the rows currently visible in the table (respects search + filters + sort).
    const rowsToExport = processedEmployees
    if (!exportType || rowsToExport.length === 0) return
    try {
      const exportRows = buildEmployeeExportRows(rowsToExport, { selectedColumns })
      if (exportType === "excel") await exportEmployeesToExcel(exportRows)
      else if (exportType === "pdf") await exportEmployeesToPDF(rowsToExport, { selectedColumns })
      else if (exportType === "word") await exportEmployeesToWord(exportRows)
      setExportEmployeeDialogOpen(false)
    } catch (_error: unknown) {
      toast.error("Export failed")
    }
  }

  const handleViewEmployeeSignature = useCallback((employee: EmployeeProfile) => {
    setSelectedEmployee(employee as unknown as Employee)
    setViewEmployeeProfile(employee)
    setModalViewMode("signature")
    setIsViewDialogOpen(true)
  }, [])

  const handleConvertStaffType = useCallback(
    async (employee: Employee) => {
      await handleEditEmployee(employee)
    },
    [handleEditEmployee]
  )

  const handleChangeStatus = useCallback(
    async (employee: Employee) => {
      await handleEditEmployee(employee)
    },
    [handleEditEmployee]
  )

  const getAvailableRoles = (): UserRole[] => {
    if (!userProfile) return []
    return getAssignableRolesForActor(userProfile.role) as UserRole[]
  }

  const handleCopyEmail = useCallback(async (email: string) => {
    const value = email.trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success("Email copied")
    } catch (_error: unknown) {
      toast.error("Failed to copy email")
    }
  }, [])

  const columns: DataTableColumn<Employee>[] = useMemo(
    () => [
      {
        key: "employee_number",
        label: "Emp. No.",
        sortable: true,
        resizable: true,
        initialWidth: 120,
        accessor: (r) => r.employee_number || "",
        hideOnMobile: true,
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
              className={cn("font-medium", r.employment_status === "exited" && "text-muted-foreground line-through")}
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
        hideOnMobile: true,
        render: (r) => (
          <div className="flex flex-col gap-1 text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-left"
              onClick={() => void handleCopyEmail(r.company_email)}
              title="Click to copy email"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[180px] truncate">{r.company_email}</span>
            </button>
            {r.additional_email && (
              <button
                type="button"
                className="text-muted-foreground/80 hover:text-foreground ml-5 max-w-[180px] truncate text-left text-xs"
                onClick={() => void handleCopyEmail(r.additional_email || "")}
                title="Click to copy additional email"
              >
                {r.additional_email}
              </button>
            )}
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.department,
        render: (r) => <span>{r.department}</span>,
      },
      {
        key: "designation",
        label: "Designation",
        sortable: true,
        accessor: (r) => r.designation || "",
        render: (r) => <span>{r.designation || "—"}</span>,
      },
      {
        key: "role",
        label: "Role",
        sortable: true,
        accessor: (r) => r.role,
        render: (r) => <Badge className={getRoleBadgeColor(r.role)}>{getRoleDisplayName(r.role)}</Badge>,
      },
      {
        key: "employment_type",
        label: "Employee Type",
        sortable: true,
        accessor: (r) => r.employment_type || "full_time",
        render: (r) => {
          const type = r.employment_type || "full_time"
          const display =
            type === "full_time"
              ? "Full Time"
              : type === "part_time"
                ? "Part Time"
                : r.contract_categories?.name
                  ? `Contract (${r.contract_categories.name})`
                  : "Contract"
          const badgeColor =
            type === "full_time"
              ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/10 border-transparent shadow-none"
              : type === "part_time"
                ? "bg-purple-500/10 text-purple-500 hover:bg-purple-500/10 border-transparent shadow-none"
                : "bg-orange-500/10 text-orange-500 hover:bg-orange-500/10 border-transparent shadow-none"
          return <Badge className={badgeColor}>{display}</Badge>
        },
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.employment_status || "active",
        render: (r) => <EmployeeStatusBadge status={r.employment_status || "active"} size="sm" />,
      },
      {
        key: "actions",
        label: "Action",
        render: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void handleViewEmployeeDetails(r)}
              title="View Profile"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canManageUsers && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => void handleEditEmployee(r)}
                title="Edit Employee"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canManageUsers && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="More Actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void handleConvertStaffType(r)}>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Convert Staff Type
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleChangeStatus(r)}>
                    <UserCircle className="mr-2 h-4 w-4" />
                    Change Status
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleViewEmployeeSignature(r as unknown as EmployeeProfile)}>
                    <FileSignature className="mr-2 h-4 w-4" />
                    Email Signature
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ),
      },
    ],
    [
      canManageUsers,
      handleCopyEmail,
      handleEditEmployee,
      handleConvertStaffType,
      handleChangeStatus,
      handleViewEmployeeSignature,
    ]
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
        label: "Office",
        options: offices.map((o) => ({ value: o, label: o })),
        placeholder: "All Offices",
      },
      {
        key: "gender",
        label: "Gender",
        options: genderFilterOptions,
        placeholder: "All Genders",
        mode: "custom",
        filterFn: (employee, selected) => selected.includes(employee.gender || "unspecified"),
      },
      {
        key: "role",
        label: "Role",
        options: roleList.map((r) => ({ value: r, label: getRoleDisplayName(r) })),
        placeholder: "All Roles",
      },
      // Status and Staff type are deliberately not filters. Both are scopes, and both are
      // now owned by the tab rows above: lifecycle (Current / Former / All) and population
      // (Employees / Contract Staff / All Staff). Duplicating them here is what produced the
      // pre-ticked filter chips this page used to open with. The Status column remains
      // visible and sortable for the states the tabs do not name.
    ],
    [departments, offices]
  )

  // Stats follow what the table is actually showing, so they never claim people the
  // current tab or filters have hidden.
  const stats = useMemo(() => {
    const source = processedEmployees.length ? processedEmployees : scopedEmployees
    return {
      total: source.length,
      admins: source.filter((s) => ["developer", "super_admin", "admin"].includes(s.role)).length,
      leads: source.filter((s) => s.is_department_lead).length,
      currentEmployees: source.filter((s) => s.role !== "visitor").length,
    }
  }, [scopedEmployees, processedEmployees])

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
      tabs={lifecycleTabs}
      activeTab={lifecycleTab}
      onTabChange={(tab) => setLifecycleTab(tab as "current" | "former" | "all")}
      secondaryTabs={populationTabs}
      secondaryActiveTab={populationTab}
      onSecondaryTabChange={(tab) => setPopulationTab(tab as "employees" | "contract" | "all")}
      actions={
        <div className="flex items-center gap-2">
          {(canManageUsers || canReviewApplications) && (
            <Button onClick={() => setManageUsersOpen(true)} variant="default" size="sm" className="h-8 gap-2">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Manage Users</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
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
            title="Current Employees"
            value={stats.currentEmployees}
            icon={Users}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      <DataTable<Employee>
        data={scopedEmployees}
        columns={columns}
        getRowId={(r) => r.id}
        onProcessedDataChange={setProcessedEmployees}
        pagination={{ pageSize: 50 }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        searchPlaceholder="Search name, email, designation..."
        searchFn={(r, q) =>
          `${r.first_name} ${r.last_name} ${r.company_email} ${r.designation}`.toLowerCase().includes(q)
        }
        filters={filters}
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
                    <span>{r.employment_date ? formatWATDate(r.employment_date) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">DOB</span>
                    <span>{formatDateOfBirth(r.date_of_birth, r.birthday) ?? "—"}</span>
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
                  {r.is_department_lead && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                      <Shield className="h-3 w-3" />
                      <span>Dept Lead</span>
                    </div>
                  )}
                </div>
                <EmployeeStatusBadge status={r.employment_status || "active"} size="sm" />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge className={getRoleBadgeColor(r.role)}>{getRoleDisplayName(r.role)}</Badge>
              </div>

              <div className="text-muted-foreground space-y-1.5 pt-2 text-xs">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  <button
                    type="button"
                    className="hover:text-foreground truncate text-left"
                    onClick={() => void handleCopyEmail(r.company_email)}
                    title="Click to copy email"
                  >
                    {r.company_email}
                  </button>
                </div>
                {r.additional_email && (
                  <div className="ml-[22px]">
                    <button
                      type="button"
                      className="hover:text-foreground truncate text-left text-[11px]"
                      onClick={() => void handleCopyEmail(r.additional_email || "")}
                      title="Click to copy additional email"
                    >
                      {r.additional_email}
                    </button>
                  </div>
                )}
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
        onEditEmployee={handleEditEmployee}
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
