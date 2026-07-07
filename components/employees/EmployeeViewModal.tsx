"use client"

import { useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"
import { ChangeStatusContent } from "@/components/hr/change-status-dialog"
import { SignatureCreator } from "@/components/signature-creator"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { formatName } from "@/lib/utils"
import { format, differenceInDays } from "date-fns"
import { Edit, FileSignature, ChevronDown, ChevronUp, UserCircle, ArrowRight } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import type { UserRole, EmploymentStatus } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { useDepartments } from "@/hooks/use-departments"
import { useOfficeLocations } from "@/hooks/use-office-locations"
import { createClient } from "@/lib/supabase/client"
import type { UserProfile } from "@/app/admin/hr/employees/admin-employee-content"
import type { EmployeeAssignedItems, EmployeeProfile, EmployeeStatusSummary, EmployeeViewData } from "./types"

interface EditForm {
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
}

interface EmployeeViewModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeProfile | null
  assignedItems: EmployeeAssignedItems
  modalViewMode: "profile" | "employment" | "edit" | "signature" | "status"
  setModalViewMode: (mode: "profile" | "employment" | "edit" | "signature" | "status") => void
  onSave: () => void
  isSaving: boolean
  editForm: EditForm
  setEditForm: (form: EditForm | ((prev: EditForm) => EditForm)) => void
  showMoreOptions: boolean
  setShowMoreOptions: (show: boolean) => void
  userProfile: UserProfile
  viewEmployeeData: EmployeeViewData
  onEditEmployee: (employee: EmployeeProfile) => void
  onSignature: (employee: EmployeeProfile) => void
  loadData: () => void
  setViewEmployeeProfile: (profile: EmployeeProfile | null) => void
  canManageUsers: boolean
  getAvailableRoles: () => UserRole[]
}

// ─── Compact profile info row ────────────────────────────────────────────────
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start py-2">
      <dt className="text-muted-foreground w-36 shrink-0 border-r pt-px pr-3 text-xs">{label}</dt>
      <dd className="min-w-0 flex-1 pl-3 text-sm font-medium">{children}</dd>
    </div>
  )
}

// ─── Compact item row for assets / tasks / docs ───────────────────────────────
function ItemRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0 flex-1">{children}</div>
      <ArrowRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
    </li>
  )
}

function statusColor(status: string | null | undefined): string {
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
  showMoreOptions,
  setShowMoreOptions,
  userProfile,
  viewEmployeeData,
  onEditEmployee,
  onSignature,
  loadData,
  setViewEmployeeProfile,
  canManageUsers,
  getAvailableRoles,
}: EmployeeViewModalProps) {
  const { departments: DEPARTMENTS } = useDepartments()
  const { officeLocations } = useOfficeLocations()
  const supabase = createClient()
  const [innerTab, setInnerTab] = useState<"assets" | "tasks" | "docs">("assets")
  const [convertType, setConvertType] = useState<"full_time" | "part_time" | "contract">("full_time")
  const [convertCategory, setConvertCategory] = useState("")
  const [isConverting, setIsConverting] = useState(false)

  const { data: contractCategories = [] } = useQuery<any[]>({
    queryKey: ["contract-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
  })

  const viewEmployeeProfile = employee
  const displayedLeadDepartments =
    viewEmployeeProfile?.is_department_lead && viewEmployeeProfile.department
      ? [viewEmployeeProfile.department]
      : viewEmployeeProfile?.lead_departments || []

  const isMainView = modalViewMode === "profile" || modalViewMode === "employment" || modalViewMode === "signature"
  const isSubView = modalViewMode === "edit" || modalViewMode === "status"

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        {/* ── Header ── */}
        <DialogHeader className="border-b px-5 py-3 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>
              {modalViewMode === "edit"
                ? "Edit Employee Profile"
                : modalViewMode === "signature"
                  ? "Email Signature"
                  : modalViewMode === "status"
                    ? "Change Employment Status"
                    : viewEmployeeProfile
                      ? `${formatName(viewEmployeeProfile.first_name)} ${formatName(viewEmployeeProfile.last_name)}`
                      : "Employee Details"}
            </span>
            {viewEmployeeProfile?.role && (
              <Badge className={getRoleBadgeColor(viewEmployeeProfile.role as UserRole)}>
                {getRoleDisplayName(viewEmployeeProfile.role as UserRole)}
              </Badge>
            )}
            {viewEmployeeProfile?.employment_status && (
              <EmployeeStatusBadge status={(viewEmployeeProfile.employment_status as EmploymentStatus) || "active"} />
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {modalViewMode === "edit"
              ? "Update role, department, permissions, and profile information."
              : modalViewMode === "signature"
                ? "Manage branded signature details for this employee."
                : modalViewMode === "status"
                  ? "Update employment status, offboarding, or convert employment type."
                  : "Review profile, assets, tasks, and employment details."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Tab nav (main views only) ── */}
        {viewEmployeeProfile && isMainView && (
          <div className="border-b px-5 sm:px-6">
            <div className="flex gap-0">
              {[
                { mode: "profile" as const, label: "Overview" },
                { mode: "signature" as const, label: "Signature" },
                { mode: "employment" as const, label: "Employment" },
              ].map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => {
                    if (mode === "signature" && viewEmployeeProfile) {
                      onSignature(viewEmployeeProfile)
                    } else {
                      setModalViewMode(mode)
                    }
                  }}
                  className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-none ${
                    modalViewMode === mode
                      ? "border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Scrollable content ── */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Loading skeleton */}
          {!viewEmployeeProfile && (
            <div className="space-y-4 p-5 sm:p-6">
              <div className="bg-muted h-6 w-2/5 animate-pulse rounded" />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
                    <div className="bg-muted h-5 w-full animate-pulse rounded" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Overview ── */}
          {viewEmployeeProfile && modalViewMode === "profile" && (
            <ScrollArea className="h-full">
              <div className="space-y-5 px-5 py-4 sm:px-6">
                {/* Profile info — compact dl */}
                <div className="rounded-lg border">
                  <div className="flex items-center gap-3 border-b px-4 py-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground text-sm font-bold">
                        {formatName(viewEmployeeProfile.first_name)?.[0]}
                        {formatName(viewEmployeeProfile.last_name)?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {formatName(viewEmployeeProfile.first_name)} {formatName(viewEmployeeProfile.last_name)}
                      </p>
                      {viewEmployeeProfile.designation && (
                        <p className="text-muted-foreground truncate text-xs">{viewEmployeeProfile.designation}</p>
                      )}
                    </div>
                  </div>
                  <dl className="divide-y px-4">
                    {viewEmployeeProfile.company_email && (
                      <InfoRow label="Email">
                        <span className="text-xs break-all sm:text-sm">{viewEmployeeProfile.company_email}</span>
                      </InfoRow>
                    )}
                    {viewEmployeeProfile.department && (
                      <InfoRow label="Department">{viewEmployeeProfile.department}</InfoRow>
                    )}
                    <InfoRow label="Role">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge className={getRoleBadgeColor(viewEmployeeProfile.role as UserRole)}>
                          {getRoleDisplayName(viewEmployeeProfile.role as UserRole)}
                        </Badge>
                        {viewEmployeeProfile.is_department_lead && displayedLeadDepartments.length > 0 && (
                          <Badge variant="outline">
                            Leading {displayedLeadDepartments.length} Dept
                            {displayedLeadDepartments.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </InfoRow>
                    {viewEmployeeProfile.phone_number && (
                      <InfoRow label="Phone">{viewEmployeeProfile.phone_number}</InfoRow>
                    )}
                    {viewEmployeeProfile.office_location && (
                      <InfoRow label="Office">{viewEmployeeProfile.office_location}</InfoRow>
                    )}
                    {viewEmployeeProfile.residential_address && (
                      <InfoRow label="Address">
                        <span className="text-xs">{viewEmployeeProfile.residential_address}</span>
                      </InfoRow>
                    )}
                    {displayedLeadDepartments.length > 0 && (
                      <InfoRow label="Leading">
                        <div className="flex flex-wrap gap-1">
                          {displayedLeadDepartments.map((dept: string) => (
                            <Badge key={dept} variant="outline" className="text-xs">
                              {dept}
                            </Badge>
                          ))}
                        </div>
                      </InfoRow>
                    )}
                    <InfoRow label="Hire Date">
                      {viewEmployeeProfile.employment_date
                        ? format(new Date(viewEmployeeProfile.employment_date), "PPP")
                        : "Not recorded"}
                    </InfoRow>
                    {viewEmployeeProfile.employment_date && (
                      <InfoRow label="Tenure">
                        {differenceInDays(new Date(), new Date(viewEmployeeProfile.employment_date))} days
                      </InfoRow>
                    )}
                    <InfoRow label="Account Created">{format(new Date(viewEmployeeProfile.created_at), "PPP")}</InfoRow>
                  </dl>
                </div>

                {/* Assets / Tasks / Docs — compact tabs */}
                <div className="rounded-lg border">
                  {/* Tab bar */}
                  <div className="flex gap-0 border-b px-2">
                    {(
                      [
                        { key: "assets", label: "Assets", count: viewEmployeeData.assets.length },
                        { key: "tasks", label: "Tasks", count: viewEmployeeData.tasks.length },
                        { key: "docs", label: "Docs", count: viewEmployeeData.documentation.length },
                      ] as const
                    ).map(({ key, label, count }) => (
                      <button
                        key={key}
                        onClick={() => setInnerTab(key)}
                        className={`border-b-2 px-3 py-2 text-xs font-medium transition-none ${
                          innerTab === key
                            ? "border-primary text-foreground"
                            : "text-muted-foreground hover:text-foreground border-transparent"
                        }`}
                        style={{ marginBottom: "-1px" }}
                      >
                        {label} <span className="text-[10px] tabular-nums">({count})</span>
                      </button>
                    ))}
                  </div>

                  {/* Assets panel */}
                  {innerTab === "assets" &&
                    (viewEmployeeData.assets.length > 0 ? (
                      <ul className="max-h-60 divide-y overflow-y-auto px-4">
                        {viewEmployeeData.assets.map((assignment) => {
                          const asset = assignment.Asset
                          const typeLabel = asset?.asset_type
                            ? ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type
                            : "Unknown"
                          const isOffice = assignment.assignmentType === "office"
                          return (
                            <ItemRow key={assignment.id}>
                              <p className="truncate text-sm font-medium">{typeLabel}</p>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <span className="text-muted-foreground font-mono text-[10px]">
                                  {asset?.unique_code || "—"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`px-1.5 py-0 text-[10px] ${isOffice ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"}`}
                                >
                                  {isOffice ? `Office: ${assignment.officeLocation || "Office"}` : "Personal"}
                                </Badge>
                                <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(asset?.status)}`}>
                                  {asset?.status || "unknown"}
                                </Badge>
                              </div>
                            </ItemRow>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground px-4 py-6 text-center text-sm">No assets assigned</p>
                    ))}

                  {/* Tasks panel */}
                  {innerTab === "tasks" &&
                    (viewEmployeeData.tasks.length > 0 ? (
                      <ul className="max-h-60 divide-y overflow-y-auto px-4">
                        {viewEmployeeData.tasks.map((task) => (
                          <ItemRow key={task.id}>
                            <p className="truncate text-sm font-medium">{task.title || "Untitled task"}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(task.status)}`}>
                                {task.status?.replace(/_/g, " ") || "unknown"}
                              </Badge>
                              {task.created_at && (
                                <span className="text-muted-foreground text-[10px]">
                                  {formatWATDate(task.created_at, { day: "numeric", month: "short", year: "numeric" })}
                                </span>
                              )}
                            </div>
                          </ItemRow>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground px-4 py-6 text-center text-sm">No tasks assigned</p>
                    ))}

                  {/* Docs panel */}
                  {innerTab === "docs" &&
                    (viewEmployeeData.documentation.length > 0 ? (
                      <ul className="max-h-60 divide-y overflow-y-auto px-4">
                        {viewEmployeeData.documentation.map((doc) => (
                          <ItemRow key={doc.id}>
                            <p className="truncate text-sm font-medium">{doc.title || "Untitled document"}</p>
                            {doc.created_at && (
                              <p className="text-muted-foreground mt-0.5 text-[10px]">
                                {formatWATDate(doc.created_at, { day: "numeric", month: "short", year: "numeric" })}
                              </p>
                            )}
                          </ItemRow>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground px-4 py-6 text-center text-sm">No documents found</p>
                    ))}
                </div>
              </div>
            </ScrollArea>
          )}

          {/* ── Employment ── */}
          {viewEmployeeProfile && modalViewMode === "employment" && (
            <ScrollArea className="h-full">
              <div className="px-5 py-4 sm:px-6">
                <div className="rounded-lg border">
                  <dl className="divide-y px-4">
                    <InfoRow label="Current Status">
                      <EmployeeStatusBadge status={viewEmployeeProfile.employment_status || "active"} size="lg" />
                    </InfoRow>
                    <InfoRow label="Employment Type">
                      <span className="capitalize">
                        {String(viewEmployeeProfile.employment_type || "full_time").replace("_", " ")}
                      </span>
                    </InfoRow>
                    {viewEmployeeProfile.employment_type === "contract" && (
                      <InfoRow label="Contract Category">
                        <span>
                          {viewEmployeeProfile.contract_categories?.name
                            ? `${viewEmployeeProfile.contract_categories.name} (${viewEmployeeProfile.contract_categories.code})`
                            : "Not specified"}
                        </span>
                      </InfoRow>
                    )}
                    <InfoRow label="Device / Attendance No.">
                      <span className="font-mono font-semibold">{viewEmployeeProfile.device_key || "—"}</span>
                    </InfoRow>
                    <InfoRow label="Hire Date">
                      {viewEmployeeProfile.employment_date
                        ? formatWATDate(viewEmployeeProfile.employment_date, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })
                        : "Not recorded"}
                    </InfoRow>
                    {viewEmployeeProfile.employment_date && (
                      <InfoRow label="Tenure">
                        {differenceInDays(new Date(), new Date(viewEmployeeProfile.employment_date))} days
                      </InfoRow>
                    )}
                    {viewEmployeeProfile.employment_status === "exited" && (
                      <>
                        <InfoRow label="Separation Date">
                          <span className="text-red-600 dark:text-red-400">
                            {viewEmployeeProfile.separation_date
                              ? formatWATDate(viewEmployeeProfile.separation_date, {
                                  day: "numeric",
                                  month: "long",
                                  year: "numeric",
                                })
                              : "Not recorded"}
                          </span>
                        </InfoRow>
                        <InfoRow label="Reason">
                          <span className="text-red-600 italic dark:text-red-400">
                            {viewEmployeeProfile.separation_reason || "No reason specified"}
                          </span>
                        </InfoRow>
                      </>
                    )}
                    {viewEmployeeProfile.employment_status === "suspended" && (
                      <InfoRow label="Note">
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          Contact IT / Admin for active suspension period details.
                        </span>
                      </InfoRow>
                    )}
                  </dl>
                </div>
                <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
                  Changes to employment status are logged for audit purposes. Terminating an employee will automatically
                  revoke their system access and clear their assigned roles.
                </p>
              </div>
            </ScrollArea>
          )}

          {/* ── Signature ── */}
          {viewEmployeeProfile && modalViewMode === "signature" && (
            <ScrollArea className="h-full">
              <div className="px-5 py-4 sm:px-6">
                <SignatureCreator
                  profile={viewEmployeeProfile}
                  variant="selectable"
                  defaultSelectableMode="anniversary"
                />
              </div>
            </ScrollArea>
          )}

          {/* ── Change Status / Type ── */}
          {viewEmployeeProfile && modalViewMode === "status" && (
            <Tabs defaultValue="status" className="flex h-full w-full flex-col">
              <TabsList className="mx-5 mt-4 sm:mx-6">
                <TabsTrigger value="status">Employment Status</TabsTrigger>
                <TabsTrigger value="type">Employment Type</TabsTrigger>
              </TabsList>

              <TabsContent value="status" className="min-h-0 flex-grow">
                <ScrollArea className="h-full">
                  <div className="px-5 py-4 sm:px-6">
                    <ChangeStatusContent
                      employee={
                        {
                          id: viewEmployeeProfile.id,
                          first_name: viewEmployeeProfile.first_name,
                          last_name: viewEmployeeProfile.last_name,
                          employment_status: viewEmployeeProfile.employment_status || "active",
                        } satisfies EmployeeStatusSummary
                      }
                      onSuccess={() => {
                        setModalViewMode("employment")
                        loadData()
                        supabase
                          .from("profiles")
                          .select("*")
                          .eq("id", viewEmployeeProfile.id)
                          .single()
                          .then(({ data }) => {
                            if (data) setViewEmployeeProfile(data as EmployeeProfile)
                          })
                      }}
                    />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="type" className="min-h-0 flex-grow">
                <ScrollArea className="h-full">
                  <div className="space-y-4 px-5 py-4 sm:px-6">
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                      <span className="text-xs font-semibold text-amber-700 uppercase dark:text-amber-400">Note</span>
                      <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                        Converting this employee&apos;s employment type will archive their current staff ID (
                        <strong className="font-mono">{viewEmployeeProfile.employee_number || "N/A"}</strong>) in
                        history and generate a new ID based on the selected series. The old ID remains linked to this
                        profile for historical reference and will not be reassigned.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <Label htmlFor="convert_employment_type">New Employment Type</Label>
                          <Select
                            value={convertType}
                            onValueChange={(value: any) => {
                              setConvertType(value)
                              if (value !== "contract") {
                                setConvertCategory("")
                              } else if (contractCategories.length > 0) {
                                setConvertCategory(contractCategories[0].code)
                              }
                            }}
                          >
                            <SelectTrigger id="convert_employment_type" className="mt-1.5">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full_time">Full Time</SelectItem>
                              <SelectItem value="part_time">Part Time</SelectItem>
                              <SelectItem value="contract">Contract</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {convertType === "contract" && (
                          <div>
                            <Label htmlFor="convert_contract_category">Contract Category</Label>
                            <Select value={convertCategory} onValueChange={(value) => setConvertCategory(value)}>
                              <SelectTrigger id="convert_contract_category" className="mt-1.5">
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                              <SelectContent>
                                {contractCategories.map((cat) => (
                                  <SelectItem key={cat.id} value={cat.code}>
                                    {cat.name} ({cat.code})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>

                      <div className="bg-muted/30 rounded-lg border p-3">
                        <span className="text-muted-foreground text-xs font-semibold uppercase">
                          Expected ID Series Preview
                        </span>
                        <p className="text-primary mt-1 font-mono text-sm font-bold">
                          {(() => {
                            const currentYear = new Date().getFullYear()
                            if (convertType === "full_time") {
                              return `ACOB/${currentYear}/... (Next sequence number)`
                            } else if (convertType === "part_time") {
                              return `ACOB/PT/${currentYear}/... (Next part-time number)`
                            } else {
                              return `ACOB/${convertCategory || "SIWES"}/${currentYear}/... (Next contract number)`
                            }
                          })()}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end gap-2 border-t pt-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setModalViewMode("employment")
                        }}
                        disabled={isConverting}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={async () => {
                          setIsConverting(true)
                          try {
                            const response = await fetch("/api/admin/employees/convert-type", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                profileId: viewEmployeeProfile.id,
                                newType: convertType,
                                newCategoryCode: convertType === "contract" ? convertCategory : null,
                              }),
                            })
                            const result = await response.json()
                            if (!response.ok) throw new Error(result.error || "Failed to convert")
                            toast.success(result.message)
                            loadData()
                            // Reload profile immediately
                            const { data: updatedProfile } = await supabase
                              .from("profiles")
                              .select("*, contract_categories(*)")
                              .eq("id", viewEmployeeProfile.id)
                              .single()
                            if (updatedProfile) {
                              setViewEmployeeProfile(updatedProfile as any)
                            }
                            setModalViewMode("employment")
                          } catch (err: any) {
                            toast.error(err.message || "Failed to convert type")
                          } finally {
                            setIsConverting(false)
                          }
                        }}
                        loading={isConverting}
                        className="gap-1.5"
                      >
                        <ArrowRight className="h-4 w-4" />
                        Confirm Conversion
                      </Button>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          )}

          {/* ── Edit Profile ── */}
          {viewEmployeeProfile && modalViewMode === "edit" && (
            <ScrollArea className="h-full">
              <div className="space-y-4 px-5 py-4 sm:px-6">
                <div>
                  <Label htmlFor="role">Role *</Label>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableRoles().map((role) => (
                        <SelectItem key={role} value={role}>
                          {getRoleDisplayName(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {userProfile?.role === "admin"
                      ? "As Admin, you can assign: Visitor and Employee roles"
                      : "As Super Admin, you can assign any role"}
                  </p>
                  {editForm.role === "admin" && (
                    <div className="mt-3 space-y-2">
                      <Label>Admin Routes *</Label>
                      <AdminRoutesPicker
                        values={editForm.admin_routes}
                        onChange={(values) => setEditForm((prev) => ({ ...prev, admin_routes: values }))}
                      />
                      <p className="text-muted-foreground text-xs">Admin must have at least one route.</p>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="department">Department *</Label>
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
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      id="is_department_lead"
                      type="checkbox"
                      checked={editForm.is_department_lead}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          is_department_lead: e.target.checked,
                          lead_departments: e.target.checked && prev.department ? [prev.department] : [],
                        }))
                      }
                      className="rounded"
                    />
                    <Label htmlFor="is_department_lead">Department Lead</Label>
                  </div>
                </div>

                <div>
                  <Label htmlFor="office_location">Office Location</Label>
                  <SearchableSelect
                    value={editForm.office_location}
                    onValueChange={(value) => setEditForm({ ...editForm, office_location: value })}
                    placeholder="Select office location"
                    options={officeLocations.map((loc) => ({ value: loc, label: loc }))}
                  />
                </div>

                <div>
                  <Label htmlFor="designation">Designation</Label>
                  <Input
                    id="designation"
                    value={editForm.designation}
                    onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                    placeholder="e.g., Senior Developer"
                  />
                </div>

                {/* More Options */}
                <div className="border-t pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    className="w-full justify-between"
                  >
                    <span className="font-medium">More Personal Options</span>
                    {showMoreOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>

                  {showMoreOptions && (
                    <div className="animate-in slide-in-from-top-2 mt-4 space-y-4">
                      <div className="space-y-4">
                        <h4 className="text-foreground text-sm font-semibold">Personal Information</h4>
                        <div>
                          <Label>Employee Number</Label>
                          <Input value={editForm.employee_number} className="font-mono" readOnly disabled />
                          <p className="text-muted-foreground mt-1 text-xs">
                            Employee number is locked after creation.
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label>First Name</Label>
                            <Input
                              value={editForm.first_name}
                              onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                              placeholder="First name"
                            />
                          </div>
                          <div>
                            <Label>Last Name</Label>
                            <Input
                              value={editForm.last_name}
                              onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                              placeholder="Last name"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Other Names</Label>
                          <Input
                            value={editForm.other_names}
                            onChange={(e) => setEditForm({ ...editForm, other_names: e.target.value })}
                            placeholder="Middle name or other names"
                          />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label>Company Email</Label>
                            <Input
                              type="email"
                              value={editForm.company_email}
                              onChange={(e) => setEditForm({ ...editForm, company_email: e.target.value })}
                              disabled={!canManageUsers}
                              placeholder="email@company.com"
                            />
                          </div>
                          <div>
                            <Label>Additional Email</Label>
                            <Input
                              type="email"
                              value={editForm.additional_email}
                              onChange={(e) => setEditForm({ ...editForm, additional_email: e.target.value })}
                              placeholder="email@example.com"
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label>Phone Number</Label>
                            <Input
                              type="tel"
                              value={editForm.phone_number}
                              onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
                              placeholder="+234 800 000 0000"
                            />
                          </div>
                          <div>
                            <Label>Additional Phone</Label>
                            <Input
                              type="tel"
                              value={editForm.additional_phone}
                              onChange={(e) => setEditForm({ ...editForm, additional_phone: e.target.value })}
                              placeholder="Alternative phone"
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label>Date of Birth</Label>
                            <BirthdayInput
                              birthday={editForm.birthday}
                              birthYear={editForm.birth_year}
                              onChange={({ birthday, birthYear }) =>
                                setEditForm({ ...editForm, birthday, birth_year: birthYear })
                              }
                            />
                            <p className="text-muted-foreground mt-1 text-xs">Year is optional.</p>
                          </div>
                          <div>
                            <Label>Employment Date</Label>
                            <Input
                              type="date"
                              value={editForm.employment_date}
                              onChange={(e) => setEditForm({ ...editForm, employment_date: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 border-t pt-4">
                        <h4 className="text-foreground text-sm font-semibold">Address</h4>
                        <Textarea
                          value={editForm.residential_address}
                          onChange={(e) => setEditForm({ ...editForm, residential_address: e.target.value })}
                          placeholder="Full residential address"
                          rows={2}
                        />
                      </div>

                      <div className="space-y-4 border-t pt-4">
                        <h4 className="text-foreground text-sm font-semibold">Job Information</h4>
                        <Textarea
                          value={editForm.job_description}
                          onChange={(e) => setEditForm({ ...editForm, job_description: e.target.value })}
                          placeholder="Job description or responsibilities"
                          rows={4}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>

        {/* ── Footer ── */}
        <DialogFooter className="bg-background/95 flex w-full flex-col gap-2 border-t px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            {isSubView && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModalViewMode(modalViewMode === "status" ? "employment" : "profile")}
                disabled={isSaving || isConverting}
              >
                ← Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {modalViewMode === "edit" && (
              <Button onClick={onSave} loading={isSaving} size="sm">
                Save Changes
              </Button>
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
                  if (viewEmployeeProfile) {
                    setConvertType(viewEmployeeProfile.employment_type || "full_time")
                    setConvertCategory(viewEmployeeProfile.contract_categories?.code || "")
                  }
                  setModalViewMode("status")
                }}
                className="gap-1.5"
              >
                <UserCircle className="h-3.5 w-3.5" />
                Change Status / Type
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
