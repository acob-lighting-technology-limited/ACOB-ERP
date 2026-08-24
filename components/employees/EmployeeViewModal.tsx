"use client"

import { useState, useEffect, useCallback } from "react"
import { formatWATDate, formatDateOfBirth } from "@/lib/utils/date"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { BirthdayInput } from "@/components/ui/birthday-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { AdminRoutesPicker } from "@/components/ui/admin-routes-picker"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"
import { SignatureCreator } from "@/components/signature-creator"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { formatName, cn } from "@/lib/utils"
import { format, differenceInDays } from "date-fns"
import {
  Edit,
  FileSignature,
  UserCircle,
  ArrowRight,
  User,
  Briefcase,
  Mail,
  Calendar,
  Clock,
  Copy,
  Check,
  FileText,
  Package,
  CheckSquare,
  AlertCircle,
  AlertTriangle,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import type { UserRole, EmploymentStatus } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { useDepartments } from "@/hooks/use-departments"
import { useOfficeLocations } from "@/hooks/use-office-locations"
import { createClient } from "@/lib/supabase/client"
import type { UserProfile } from "@/app/admin/hr/employees/admin-employee-content"
import type { EmployeeAssignedItems, EmployeeProfile, EmployeeViewData } from "./types"
import { apiFetch } from "@/lib/api-client"

export interface EditForm {
  role: UserRole
  admin_routes: string[]
  is_department_lead: boolean
  department: string
  office_location: string
  designation: string
  lead_departments: string[]
  employee_number: string
  device_key?: string | null
  first_name: string
  last_name: string
  other_names: string
  company_email: string
  additional_email: string
  personal_email: string
  phone_number: string
  additional_phone: string
  residential_address: string
  bank_name: string
  bank_account_number: string
  bank_account_name: string
  birthday: string
  birth_year: string
  employment_date: string
  job_description: string
  attendance_exempt: boolean
  employment_status: EmploymentStatus
  status_reason_code?: string
  suspension_end_date?: string
  separation_date?: string
  employment_type: "full_time" | "part_time" | "contract"
  contract_category_code?: string
}

export interface EmployeeViewModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeProfile | null
  assignedItems: EmployeeAssignedItems
  modalViewMode: "profile" | "employment" | "edit" | "signature"
  setModalViewMode: (mode: "profile" | "employment" | "edit" | "signature") => void
  onSave: () => void
  isSaving: boolean
  editForm: EditForm
  setEditForm: (form: EditForm | ((prev: EditForm) => EditForm)) => void
  userProfile: UserProfile
  viewEmployeeData: EmployeeViewData
  onEditEmployee: (employee: EmployeeProfile) => void
  onSignature: (employee: EmployeeProfile) => void
  canManageUsers: boolean
  getAvailableRoles: () => UserRole[]
}

const STATUS_OPTIONS: { value: "active" | "suspended" | "exited"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "exited", label: "Exited" },
]

export const EXIT_REASONS = [
  { value: "resignation", label: "Resignation" },
  { value: "mutual_separation", label: "Mutual Separation" },
  { value: "contract_completed", label: "Contract Completed" },
  { value: "retirement", label: "Retirement" },
  { value: "workforce_reduction", label: "Workforce Reduction" },
  { value: "disciplinary_dismissal", label: "Disciplinary Dismissal" },
]

export const SUSPENSION_REASONS = [
  { value: "policy_review", label: "Policy Review" },
  { value: "security_investigation", label: "Security Investigation" },
  { value: "administrative_hold", label: "Administrative Hold" },
  { value: "compliance_breach", label: "Compliance Breach" },
  { value: "temporary_access_hold", label: "Temporary Access Hold" },
]

function getAssetStatusColor(status: string | null | undefined): string {
  switch (status?.toLowerCase()) {
    case "assigned":
    case "active":
    case "resolved":
    case "completed":
    case "approved":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
    case "under_review":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
    case "open":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function StaffTypeBadge({
  type,
  categoryName,
  className,
}: {
  type?: string | null
  categoryName?: string | null
  className?: string
}) {
  const normType = type || "full_time"
  const isPartTime = normType === "part_time"
  const isContract = normType === "contract"

  const label = isContract && categoryName ? `Contract (${categoryName})` : normType.replace(/_/g, " ")

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-medium capitalize",
        isPartTime
          ? "border-purple-200 bg-purple-500/10 text-purple-600 dark:border-purple-800"
          : isContract
            ? "border-orange-200 bg-orange-500/10 text-orange-600 dark:border-orange-800"
            : "border-blue-200 bg-blue-500/10 text-blue-600 dark:border-blue-800",
        className
      )}
    >
      {label}
    </Badge>
  )
}

export function EmployeeViewModal({
  isOpen,
  onOpenChange,
  employee,
  assignedItems: _assignedItems,
  modalViewMode,
  setModalViewMode,
  onSave,
  isSaving,
  editForm,
  setEditForm,
  userProfile,
  viewEmployeeData,
  onEditEmployee,
  onSignature,
  canManageUsers,
  getAvailableRoles,
}: EmployeeViewModalProps) {
  const { departments: DEPARTMENTS } = useDepartments()
  const { officeLocations } = useOfficeLocations()
  const supabase = createClient()
  const [innerTab, setInnerTab] = useState<"assets" | "tasks" | "docs">("assets")
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, fieldName: string) => {
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    toast.success(`Copied ${fieldName}`)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  const { data: contractCategories = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["contract-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_categories")
        .select("id, name, code")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
      if (error) throw error
      return (data || []) as Array<{ id: string; name: string; code: string }>
    },
    enabled: isOpen,
  })

  const viewEmployeeProfile = employee
  const displayedLeadDepartments =
    viewEmployeeProfile?.is_department_lead && viewEmployeeProfile.department
      ? [viewEmployeeProfile.department]
      : viewEmployeeProfile?.lead_departments || []

  const isMainView = modalViewMode === "profile" || modalViewMode === "employment" || modalViewMode === "signature"
  const isSubView = modalViewMode === "edit"

  const MAIN_TABS = [
    { mode: "profile" as const, label: "Overview", icon: User },
    { mode: "employment" as const, label: "Employment", icon: Briefcase },
    { mode: "signature" as const, label: "Signature", icon: FileSignature },
  ]

  const originalType = viewEmployeeProfile?.employment_type || "full_time"
  const originalCategoryCode = viewEmployeeProfile?.contract_categories?.code || ""
  const isTypeOrCategoryChanged =
    editForm.employment_type !== originalType ||
    (editForm.employment_type === "contract" && editForm.contract_category_code !== originalCategoryCode)

  const currentYear = new Date().getFullYear()
  const expectedIdPreview =
    editForm.employment_type === "full_time"
      ? `ACOB/${currentYear}/...`
      : editForm.employment_type === "part_time"
        ? `ACOB/PT/${currentYear}/...`
        : `ACOB/${editForm.contract_category_code || "SIWES"}/${currentYear}/...`

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="bg-muted/20 border-b px-5 py-3.5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {viewEmployeeProfile && (
                <Avatar className="h-9 w-9 shrink-0 border">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {formatName(viewEmployeeProfile.first_name)?.[0]}
                    {formatName(viewEmployeeProfile.last_name)?.[0]}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="min-w-0">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
                  <span className="truncate">
                    {modalViewMode === "edit"
                      ? "Edit Employee Profile & Status"
                      : modalViewMode === "signature"
                        ? "Email Signature"
                        : viewEmployeeProfile
                          ? `${formatName(viewEmployeeProfile.first_name)} ${formatName(viewEmployeeProfile.last_name)}`
                          : "Employee Details"}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-muted-foreground truncate text-xs">
                  {modalViewMode === "edit"
                    ? "Update identity, work, status, staff type, and contact details in one place."
                    : modalViewMode === "signature"
                      ? "Official company email signature template."
                      : viewEmployeeProfile?.designation || "Employee profile overview and employment history."}
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {viewEmployeeProfile && isMainView && (
          <div className="bg-background border-b px-5 sm:px-6">
            <div className="flex gap-1">
              {MAIN_TABS.map(({ mode, label, icon: TabIcon }) => {
                const isActive = modalViewMode === mode
                return (
                  <button
                    key={mode}
                    onClick={() => {
                      if (mode === "signature" && viewEmployeeProfile) {
                        onSignature(viewEmployeeProfile)
                      } else {
                        setModalViewMode(mode)
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors",
                      isActive
                        ? "border-primary text-primary font-semibold"
                        : "text-muted-foreground hover:text-foreground border-transparent"
                    )}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {viewEmployeeProfile && modalViewMode === "profile" && (
            <ScrollArea className="h-full">
              <div className="space-y-4 p-5 sm:p-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                        <Briefcase className="text-primary h-3.5 w-3.5" /> Work & Organization
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Department</span>
                        <span className="text-foreground mt-0.5 block truncate text-xs font-medium">
                          {viewEmployeeProfile.department || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Designation</span>
                        <span className="text-foreground mt-0.5 block truncate text-xs font-medium">
                          {viewEmployeeProfile.designation || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Role</span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <Badge
                            className={cn(
                              "px-1.5 py-0 text-[10px]",
                              getRoleBadgeColor(viewEmployeeProfile.role as UserRole)
                            )}
                          >
                            {getRoleDisplayName(viewEmployeeProfile.role as UserRole)}
                          </Badge>
                          {viewEmployeeProfile.is_department_lead && (
                            <Badge variant="outline" className="border-amber-300 px-1 py-0 text-[10px] text-amber-600">
                              Lead
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Office / Room</span>
                        <span className="text-foreground mt-0.5 block truncate text-xs font-medium">
                          {viewEmployeeProfile.office_location || "—"}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between border-t pt-2">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Staff Classification</span>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <StaffTypeBadge
                              type={viewEmployeeProfile.employment_type}
                              categoryName={viewEmployeeProfile.contract_categories?.name}
                            />
                            <span className="text-muted-foreground font-mono text-xs">
                              ({viewEmployeeProfile.employee_number || "No ID"})
                            </span>
                          </div>
                        </div>
                        {displayedLeadDepartments.length > 0 && (
                          <div className="text-right">
                            <span className="text-muted-foreground block text-[11px]">Leading Depts</span>
                            <span className="text-foreground text-xs font-medium">
                              {displayedLeadDepartments.join(", ")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                        <Mail className="text-primary h-3.5 w-3.5" /> Contact Details
                      </span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Company Email</span>
                        <div className="group mt-0.5 flex items-center justify-between">
                          <span className="text-foreground truncate font-mono font-medium select-all">
                            {viewEmployeeProfile.company_email || "—"}
                          </span>
                          {viewEmployeeProfile.company_email && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-60 hover:opacity-100"
                              onClick={() => handleCopy(viewEmployeeProfile.company_email, "Email")}
                            >
                              {copiedField === "Email" ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Personal Email</span>
                          <span className="text-foreground mt-0.5 block truncate font-mono text-xs">
                            {viewEmployeeProfile.personal_email || "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Phone Number</span>
                          <span className="text-foreground mt-0.5 block truncate font-mono text-xs">
                            {viewEmployeeProfile.phone_number || "—"}
                          </span>
                        </div>
                      </div>
                      {viewEmployeeProfile.residential_address && (
                        <div className="border-t pt-2">
                          <span className="text-muted-foreground block text-[11px]">Address</span>
                          <span className="text-foreground mt-0.5 line-clamp-2 text-xs">
                            {viewEmployeeProfile.residential_address}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "employment" && (
            <ScrollArea className="h-full">
              <div className="space-y-4 p-5 sm:p-6">
                <div className="bg-card space-y-4 rounded-lg border p-4 shadow-xs">
                  <div className="flex flex-col justify-between gap-3 border-b pb-3.5 sm:flex-row sm:items-center">
                    <div>
                      <span className="text-muted-foreground mb-1 block text-[11px] font-semibold uppercase">
                        Employment Status & Type
                      </span>
                      <div className="flex items-center gap-2">
                        <EmployeeStatusBadge
                          status={(viewEmployeeProfile.employment_status as EmploymentStatus) || "active"}
                          size="lg"
                        />
                        <StaffTypeBadge
                          type={viewEmployeeProfile.employment_type}
                          categoryName={viewEmployeeProfile.contract_categories?.name}
                          className="px-2 py-0.5"
                        />
                      </div>
                    </div>
                    {canManageUsers && (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (viewEmployeeProfile) onEditEmployee(viewEmployeeProfile)
                        }}
                        className="h-8 gap-1.5 text-xs"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit Employment & Status
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "edit" && (
            <ScrollArea className="h-full">
              <div className="space-y-4 p-5 sm:p-6">
                {/* 1. Basic Identity */}
                <div className="bg-card space-y-3 rounded-lg border p-4">
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                    <User className="text-primary h-3.5 w-3.5" /> Personal Identity
                  </span>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="edit_first_name" className="text-xs">
                        First Name *
                      </Label>
                      <Input
                        id="edit_first_name"
                        value={editForm.first_name}
                        onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit_last_name" className="text-xs">
                        Last Name *
                      </Label>
                      <Input
                        id="edit_last_name"
                        value={editForm.last_name}
                        onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit_other_names" className="text-xs">
                        Other Names
                      </Label>
                      <Input
                        id="edit_other_names"
                        value={editForm.other_names}
                        onChange={(e) => setEditForm({ ...editForm, other_names: e.target.value })}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Date of Birth</Label>
                      <div className="mt-1">
                        <BirthdayInput
                          birthday={editForm.birthday}
                          birthYear={editForm.birth_year}
                          onChange={({ birthday, birthYear }) =>
                            setEditForm({ ...editForm, birthday, birth_year: birthYear })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="edit_address" className="text-xs">
                        Residential Address
                      </Label>
                      <Input
                        id="edit_address"
                        value={editForm.residential_address}
                        onChange={(e) => setEditForm({ ...editForm, residential_address: e.target.value })}
                        placeholder="City, State, Country"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Work & Organization */}
                <div className="bg-card space-y-3 rounded-lg border p-4">
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                    <Briefcase className="text-primary h-3.5 w-3.5" /> Work & Organization
                  </span>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="edit_department" className="text-xs">
                        Department *
                      </Label>
                      <Select
                        value={editForm.department}
                        onValueChange={(value) =>
                          setEditForm({
                            ...editForm,
                            department: value,
                            lead_departments: editForm.is_department_lead ? [value] : editForm.lead_departments,
                          })
                        }
                      >
                        <SelectTrigger id="edit_department" className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map((dept) => (
                            <SelectItem key={dept} value={dept} className="text-xs">
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="edit_office" className="text-xs">
                        Office / Room
                      </Label>
                      <div className="mt-1">
                        <SearchableSelect
                          value={editForm.office_location}
                          onValueChange={(value) => setEditForm({ ...editForm, office_location: value })}
                          options={officeLocations.map((loc) => ({ value: loc, label: loc }))}
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="edit_designation" className="text-xs">
                        Designation / Title
                      </Label>
                      <Input
                        id="edit_designation"
                        value={editForm.designation}
                        onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                        placeholder="e.g., Senior Systems Engineer"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit_role" className="text-xs">
                        System Role *
                      </Label>
                      <Select
                        value={editForm.role}
                        onValueChange={(value: UserRole) => {
                          setEditForm((prev) => ({
                            ...prev,
                            role: value,
                            admin_routes: value === "admin" ? prev.admin_routes : [],
                          }))
                        }}
                      >
                        <SelectTrigger id="edit_role" className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableRoles().map((role) => (
                            <SelectItem key={role} value={role} className="text-xs">
                              {getRoleDisplayName(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      id="is_department_lead_checkbox"
                      type="checkbox"
                      checked={editForm.is_department_lead}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          is_department_lead: e.target.checked,
                          lead_departments: e.target.checked && prev.department ? [prev.department] : [],
                        }))
                      }
                      className="text-primary focus:ring-primary h-3.5 w-3.5 rounded border-gray-300"
                    />
                    <Label htmlFor="is_department_lead_checkbox" className="cursor-pointer text-xs">
                      Designate as Department Lead for {editForm.department || "assigned department"}
                    </Label>
                  </div>

                  {editForm.role === "admin" && (
                    <div className="bg-muted/20 mt-2 space-y-1.5 rounded-lg border p-3">
                      <Label className="text-xs font-semibold">Admin Permitted Routes *</Label>
                      <AdminRoutesPicker
                        values={editForm.admin_routes}
                        onChange={(values) => setEditForm((prev) => ({ ...prev, admin_routes: values }))}
                      />
                      <p className="text-muted-foreground text-[11px]">
                        Admin role must have at least one authorized route.
                      </p>
                    </div>
                  )}
                </div>

                {/* 3. Status & Staff Classification (UNIFIED IN EDIT FORM) */}
                <div className="bg-card space-y-3.5 rounded-lg border p-4 shadow-xs">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                      <UserCircle className="text-primary h-3.5 w-3.5" /> Employment Status & Classification
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="edit_status" className="text-xs">
                        Employment Status (Lifecycle) *
                      </Label>
                      <Select
                        value={editForm.employment_status}
                        onValueChange={(val: EmploymentStatus) =>
                          setEditForm((prev) => ({ ...prev, employment_status: val }))
                        }
                      >
                        <SelectTrigger id="edit_status" className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="edit_staff_type" className="text-xs">
                        Staff Classification (Type) *
                      </Label>
                      <Select
                        value={editForm.employment_type}
                        onValueChange={(val: "full_time" | "part_time" | "contract") => {
                          setEditForm((prev) => ({
                            ...prev,
                            employment_type: val,
                            contract_category_code:
                              val === "contract"
                                ? prev.contract_category_code || (contractCategories[0]?.code ?? "")
                                : "",
                          }))
                        }}
                      >
                        <SelectTrigger id="edit_staff_type" className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_time" className="text-xs">
                            Full Time
                          </SelectItem>
                          <SelectItem value="part_time" className="text-xs">
                            Part Time
                          </SelectItem>
                          <SelectItem value="contract" className="text-xs">
                            Contract Staff
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {editForm.employment_type === "contract" && (
                      <div className="sm:col-span-2">
                        <Label htmlFor="edit_contract_cat" className="text-xs">
                          Contract Category *
                        </Label>
                        <Select
                          value={editForm.contract_category_code}
                          onValueChange={(val) => setEditForm((prev) => ({ ...prev, contract_category_code: val }))}
                        >
                          <SelectTrigger id="edit_contract_cat" className="mt-1 h-8 text-xs">
                            <SelectValue placeholder="Select category (e.g. SIWES, NYSC)" />
                          </SelectTrigger>
                          <SelectContent>
                            {contractCategories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.code} className="text-xs">
                                {cat.name} ({cat.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {editForm.employment_status === "suspended" && (
                      <>
                        <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 sm:col-span-2 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>
                            <strong>Disciplinary Action / Access Hold:</strong> Suspending this employee immediately
                            deactivates their system login and redirects them to the suspension notice page upon sign-in
                            attempts.
                          </span>
                        </div>
                        <div>
                          <Label htmlFor="edit_suspension_reason" className="text-xs">
                            Suspension Reason *
                          </Label>
                          <Select
                            value={editForm.status_reason_code}
                            onValueChange={(val) => setEditForm((prev) => ({ ...prev, status_reason_code: val }))}
                          >
                            <SelectTrigger id="edit_suspension_reason" className="mt-1 h-8 text-xs">
                              <SelectValue placeholder="Select reason" />
                            </SelectTrigger>
                            <SelectContent>
                              {SUSPENSION_REASONS.map((r) => (
                                <SelectItem key={r.value} value={r.value} className="text-xs">
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="edit_suspension_end" className="text-xs">
                            Expected End Date
                          </Label>
                          <Input
                            id="edit_suspension_end"
                            type="date"
                            value={editForm.suspension_end_date}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, suspension_end_date: e.target.value }))}
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </>
                    )}

                    {editForm.employment_status === "exited" && (
                      <>
                        <div>
                          <Label htmlFor="edit_exit_reason" className="text-xs">
                            Separation Reason *
                          </Label>
                          <Select
                            value={editForm.status_reason_code}
                            onValueChange={(val) => setEditForm((prev) => ({ ...prev, status_reason_code: val }))}
                          >
                            <SelectTrigger id="edit_exit_reason" className="mt-1 h-8 text-xs">
                              <SelectValue placeholder="Select exit reason" />
                            </SelectTrigger>
                            <SelectContent>
                              {EXIT_REASONS.map((r) => (
                                <SelectItem key={r.value} value={r.value} className="text-xs">
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="edit_separation_date" className="text-xs">
                            Separation Date *
                          </Label>
                          <Input
                            id="edit_separation_date"
                            type="date"
                            value={editForm.separation_date}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, separation_date: e.target.value }))}
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="bg-muted/30 rounded border p-2.5 text-xs">
                    {isTypeOrCategoryChanged ? (
                      <div className="space-y-1 text-amber-800 dark:text-amber-300">
                        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase">
                          <AlertTriangle className="h-3 w-3 text-amber-600" /> Staff ID Conversion Notice
                        </span>
                        <p className="text-[11px] leading-relaxed">
                          Saving changes will convert staff type and generate a new ID series:{" "}
                          <strong className="text-primary font-mono font-bold">{expectedIdPreview}</strong>. Current ID
                          (<strong className="font-mono">{editForm.employee_number || "None"}</strong>) will be archived
                          to history.
                        </p>
                      </div>
                    ) : (
                      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                        <span>
                          Current Staff ID:{" "}
                          <strong className="text-foreground font-mono font-semibold">
                            {editForm.employee_number || "None"}
                          </strong>
                        </span>
                        <span className="font-mono text-[10px]">ID series active</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Contact Details */}
                <div className="bg-card space-y-3 rounded-lg border p-4">
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                    <Mail className="text-primary h-3.5 w-3.5" /> Contact Details
                  </span>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="edit_company_email" className="text-xs">
                          Company Email *
                        </Label>
                        <span className="text-muted-foreground text-[10px] font-medium">Primary Login ID</span>
                      </div>
                      <Input
                        id="edit_company_email"
                        type="email"
                        value={editForm.company_email}
                        onChange={(e) => setEditForm({ ...editForm, company_email: e.target.value })}
                        disabled={!canManageUsers}
                        placeholder="user@acoblighting.com"
                        className="mt-1 h-8 font-mono text-xs"
                      />
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
                        <AlertCircle className="inline h-3 w-3 shrink-0" />
                        Changing this email updates the employee&apos;s login credentials.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="edit_additional_email" className="text-xs">
                        Additional Email
                      </Label>
                      <Input
                        id="edit_additional_email"
                        type="email"
                        value={editForm.additional_email}
                        onChange={(e) => setEditForm({ ...editForm, additional_email: e.target.value })}
                        placeholder="secondary@acoblighting.com"
                        className="mt-1 h-8 font-mono text-xs"
                      />
                      <p className="text-muted-foreground mt-1 text-[10px]">Secondary work/contact email.</p>
                    </div>

                    <div>
                      <Label htmlFor="edit_personal_email" className="text-xs">
                        Personal Email
                      </Label>
                      <Input
                        id="edit_personal_email"
                        type="email"
                        value={editForm.personal_email}
                        onChange={(e) => setEditForm({ ...editForm, personal_email: e.target.value })}
                        placeholder="personal@gmail.com"
                        className="mt-1 h-8 font-mono text-xs"
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit_phone" className="text-xs">
                        Primary Phone
                      </Label>
                      <Input
                        id="edit_phone"
                        type="tel"
                        value={editForm.phone_number}
                        onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
                        placeholder="+234 800 000 0000"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit_alt_phone" className="text-xs">
                        Alternative Phone
                      </Label>
                      <Input
                        id="edit_alt_phone"
                        type="tel"
                        value={editForm.additional_phone}
                        onChange={(e) => setEditForm({ ...editForm, additional_phone: e.target.value })}
                        placeholder="Alternative contact"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 5. Employment & Job Details */}
                <div className="bg-card space-y-3 rounded-lg border p-4">
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase">
                    <Calendar className="text-primary h-3.5 w-3.5" /> Employment Dates & Info
                  </span>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="edit_hire_date" className="text-xs">
                        Employment Date
                      </Label>
                      <Input
                        id="edit_hire_date"
                        type="date"
                        value={editForm.employment_date}
                        onChange={(e) => setEditForm({ ...editForm, employment_date: e.target.value })}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="edit_device_key" className="text-xs">
                          Biometric / Device Key
                        </Label>
                        <span className="text-muted-foreground font-mono text-[10px]">Auto-generated</span>
                      </div>
                      <Input
                        id="edit_device_key"
                        value={editForm.device_key || "Auto-derived"}
                        disabled
                        readOnly
                        className="bg-muted/40 mt-1 h-8 cursor-not-allowed font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="edit_job_desc" className="text-xs">
                      Job Description & Responsibilities
                    </Label>
                    <Textarea
                      id="edit_job_desc"
                      value={editForm.job_description}
                      onChange={(e) => setEditForm({ ...editForm, job_description: e.target.value })}
                      placeholder="Summary of core duties..."
                      rows={3}
                      className="mt-1 resize-none text-xs"
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "signature" && (
            <ScrollArea className="h-full">
              <div className="p-5 sm:p-6">
                <SignatureCreator
                  profile={viewEmployeeProfile}
                  variant="selectable"
                  defaultSelectableMode="anniversary"
                />
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="bg-background/95 flex w-full flex-col gap-2 border-t px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            {isSubView && (
              <Button variant="outline" size="sm" onClick={() => setModalViewMode("profile")} disabled={isSaving}>
                ← Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {modalViewMode === "edit" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setModalViewMode("profile")} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={onSave} loading={isSaving} size="sm">
                  Save Changes
                </Button>
              </>
            )}
            {canManageUsers && modalViewMode === "profile" && (
              <Button
                size="sm"
                onClick={() => {
                  if (viewEmployeeProfile) onEditEmployee(viewEmployeeProfile)
                }}
                className="gap-1.5"
              >
                <Edit className="h-3.5 w-3.5" />
                Edit Profile
              </Button>
            )}
            {canManageUsers && modalViewMode === "employment" && (
              <Button
                size="sm"
                onClick={() => {
                  if (viewEmployeeProfile) onEditEmployee(viewEmployeeProfile)
                }}
                className="gap-1.5"
              >
                <Edit className="h-3.5 w-3.5" />
                Edit Employment & Status
              </Button>
            )}
            {canManageUsers && modalViewMode === "signature" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (viewEmployeeProfile) onSignature(viewEmployeeProfile)
                }}
                className="gap-1.5"
              >
                <FileSignature className="h-3.5 w-3.5" />
                Open Full Signature
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false)
                setModalViewMode("profile")
              }}
            >
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
