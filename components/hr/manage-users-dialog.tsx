"use client"

import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminRoutesPicker } from "@/components/ui/admin-routes-picker"
import { Checkbox } from "@/components/ui/checkbox"
import {
  UserPlus,
  UserMinus,
  Plus,
  Loader2,
  CheckCircle,
  ChevronRight,
  ShieldCheck,
  Hash,
  Mail,
  AlertTriangle,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { cn, formatName } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toLocalISODate } from "@/lib/utils/date"
import { useDepartments } from "@/hooks/use-departments"
import { getRoleDisplayName } from "@/lib/permissions"
import { OFFICE_LOCATIONS } from "@/lib/rooms-and-offices"
import { getAssignableRolesForActor } from "@/lib/role-management"
import { formValidation } from "@/lib/validation"
import { logger } from "@/lib/logger"
import type { UserRole } from "@/types/database"
import type { Employee, UserProfile } from "@/app/admin/hr/employees/admin-employee-content"
import { apiFetch } from "@/lib/api-client"

const log = logger("manage-users-dialog")

// ─── Exit reasons ──────────────────────────────────────────────────────────────

const exitReasonOptions = [
  { value: "resignation", label: "Resignation" },
  { value: "mutual_separation", label: "Mutual Separation" },
  { value: "contract_completed", label: "Contract Completed" },
  { value: "retirement", label: "Retirement" },
  { value: "workforce_reduction", label: "Workforce Reduction" },
  { value: "disciplinary_dismissal", label: "Disciplinary Dismissal" },
]

// ─── Pending application types ─────────────────────────────────────────────────

interface PendingUser {
  id: string
  first_name: string
  last_name: string
  other_names?: string
  department: string
  designation: string
  company_email: string
  personal_email: string
  phone_number: string
  residential_address: string
  office_location?: string
  created_at: string
  status: string
  employment_type?: string
  contract_category_id?: string
  contract_categories?: { name: string; code: string } | null
}

interface ApprovalEmailPreview {
  tempPassword: string
  portalUrl: string
  welcome: { enabled: boolean; subject: string; recipients: string[]; html: string }
  internal: { enabled: boolean; subject: string; recipients: string[]; html: string }
}

interface PendingEmailDispatch {
  profileId: string
  welcome: { subject: string; recipients: string[]; html: string }
  internal: { subject: string; recipients: string[]; html: string }
}

async function fetchPendingApplications(): Promise<PendingUser[]> {
  const res = await apiFetch("/api/admin/pending-users", { cache: "no-store" })
  const payload = (await res.json().catch(() => null)) as { data?: PendingUser[]; error?: string } | null
  if (!res.ok) throw new Error(payload?.error || "Failed to load applications")
  return payload?.data || []
}

// ─── Create user schema ────────────────────────────────────────────────────────

const createSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  otherNames: z.string().optional(),
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  department: z.string().min(1, "Department is required"),
  companyRole: z.string().min(2, "Designation is required"),
  phoneNumber: z.string().regex(/^0[789][01]\d{8}$/, "Must be a valid Nigerian phone number (e.g., 08012345678)"),
  role: z.string(),
  admin_routes: z.array(z.string()),
  employmentType: z.enum(["full_time", "part_time", "contract"]),
  contractCategoryCode: z.string().optional(),
  gender: z.enum(["male", "female"], { message: "Gender is required" }),
  dateOfBirth: z.string().optional(),
  additionalPhone: z.string().optional(),
  residentialAddress: z.string().min(5, "Address must be at least 5 characters"),
  officeLocation: z.string().optional(),
})
type CreateFormValues = z.infer<typeof createSchema>

interface PerPersonEntry {
  exitDate: string
  reasonCode: string
}

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface ManageUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: "create" | "applications" | "exit"
  employees: Employee[]
  onSuccess: () => void
  canManageUsers: boolean
  userProfile: UserProfile
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ManageUsersDialog({
  open,
  onOpenChange,
  defaultTab = "create",
  employees,
  onSuccess,
  canManageUsers,
  userProfile,
}: ManageUsersDialogProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab)
  const [supabase] = useState(() => createClient())
  const queryClient = useQueryClient()
  const today = toLocalISODate()
  const { departments: DEPARTMENTS } = useDepartments()

  // ── CREATE USER ──────────────────────────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false)
  const rhf = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      otherNames: "",
      email: "",
      department: "",
      companyRole: "",
      phoneNumber: "",
      role: "employee",
      admin_routes: [],
      employmentType: "full_time",
      contractCategoryCode: "",
      gender: "male",
      dateOfBirth: "",
      additionalPhone: "",
      residentialAddress: "",
      officeLocation: "",
    },
  })
  const {
    register,
    watch,
    setValue,
    formState: { errors },
    reset: resetCreate,
  } = rhf
  const roleValue = watch("role")
  const employmentTypeValue = watch("employmentType")
  const contractCategoryCodeValue = watch("contractCategoryCode")
  const selectedGender = watch("gender")

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
    enabled: open,
  })

  const getPreviewId = () => {
    const currentYear = new Date().getFullYear()
    if (employmentTypeValue === "full_time") {
      return `ACOB/${currentYear}/...`
    } else if (employmentTypeValue === "part_time") {
      return `ACOB/PT/${currentYear}/...`
    } else {
      const catCode = contractCategoryCodeValue || "CATEGORY"
      return `ACOB/${catCode}/${currentYear}/...`
    }
  }

  const handleCreateUser = async () => {
    if (isCreating || !canManageUsers) return
    const v = rhf.getValues()
    if (!formValidation.isCompanyEmail(v.email)) {
      toast.error("Invalid email domain")
      return
    }
    setIsCreating(true)
    try {
      const res = await apiFetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: v.firstName,
          lastName: v.lastName,
          otherNames: v.otherNames,
          email: v.email,
          department: v.department,
          companyRole: v.companyRole,
          phoneNumber: v.phoneNumber,
          role: v.role,
          admin_routes: v.admin_routes,
          employmentType: v.employmentType,
          contractCategoryCode: v.contractCategoryCode || null,
          gender: v.gender,
          dateOfBirth: v.dateOfBirth || null,
          additionalPhone: v.additionalPhone || null,
          residentialAddress: v.residentialAddress,
          officeLocation: v.officeLocation || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create user")
      toast.success("User created successfully")
      resetCreate()
      onSuccess()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user")
    } finally {
      setIsCreating(false)
    }
  }

  // ── REVIEW APPLICATIONS ──────────────────────────────────────────────────────
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingReject, setPendingReject] = useState(false)
  const [employmentType, setEmploymentType] = useState<"full_time" | "part_time" | "contract">("full_time")
  const [contractCategoryCode, setContractCategoryCode] = useState("")
  const [hireDate, setHireDate] = useState(today)
  const [pendingEmailDispatch, setPendingEmailDispatch] = useState<PendingEmailDispatch | null>(null)
  const [isSendingEmails, setIsSendingEmails] = useState(false)

  // Edit fields states for Review Applications
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [otherNames, setOtherNames] = useState("")
  const [department, setDepartment] = useState("")
  const [designation, setDesignation] = useState("")
  const [companyEmail, setCompanyEmail] = useState("")
  const [personalEmailState, setPersonalEmailState] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [residentialAddress, setResidentialAddress] = useState("")
  const [officeLocation, setOfficeLocation] = useState("")

  const { data: pendingUsers = [], isLoading: isLoadingPending } = useQuery({
    queryKey: QUERY_KEYS.pendingApplications(),
    queryFn: fetchPendingApplications,
    enabled: open,
  })

  const { data: approvalEmailPreview, isLoading: isLoadingApprovalPreview } = useQuery<ApprovalEmailPreview>({
    queryKey: ["pending-approval-email-preview", selectedUser?.id, employmentType, contractCategoryCode],
    queryFn: async () => {
      if (!selectedUser?.id) throw new Error("Missing context")
      const currentYear = new Date().getFullYear()
      const dummyId =
        employmentType === "full_time"
          ? `ACOB/${currentYear}/999`
          : employmentType === "part_time"
            ? `ACOB/PT/${currentYear}/999`
            : `ACOB/${contractCategoryCode || "SIWES"}/${currentYear}/999`

      const res = await apiFetch(
        `/api/admin/pending-users/${selectedUser.id}/approval-preview?employeeId=${encodeURIComponent(dummyId)}`
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed to load preview")
      return result as ApprovalEmailPreview
    },
    enabled: open && activeTab === "applications" && !!selectedUser?.id,
  })

  const handleUserSelect = useCallback((user: PendingUser) => {
    setSelectedUser(user)
    setEmploymentType((user.employment_type as any) || "full_time")
    setContractCategoryCode(user.contract_categories?.code || "")
    setFirstName(user.first_name || "")
    setLastName(user.last_name || "")
    setOtherNames(user.other_names || "")
    setDepartment(user.department || "")
    setDesignation(user.designation || "")
    setCompanyEmail(user.company_email || "")
    setPersonalEmailState(user.personal_email || "")
    setPhoneNumber(user.phone_number || "")
    setResidentialAddress(user.residential_address || "")
    setOfficeLocation(user.office_location || "")
  }, [])

  useEffect(() => {
    if (pendingUsers.length > 0 && !selectedUser) handleUserSelect(pendingUsers[0])
  }, [pendingUsers, selectedUser, handleUserSelect])

  const handleApprove = async () => {
    if (!selectedUser) return
    setIsProcessing(true)
    try {
      // 1. Update the record in pending_users with the edited details
      const { error: updateError } = await supabase
        .from("pending_users")
        .update({
          first_name: firstName,
          last_name: lastName,
          other_names: otherNames || null,
          department: department,
          designation: designation,
          company_email: companyEmail,
          personal_email: personalEmailState,
          phone_number: phoneNumber,
          residential_address: residentialAddress,
          office_location: officeLocation || null,
        })
        .eq("id", selectedUser.id)

      if (updateError) throw updateError

      // 2. Call the approve-user API route
      const res = await apiFetch("/api/admin/approve-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingUserId: selectedUser.id,
          hireDate,
          sendEmails: false,
          employmentType,
          contractCategoryCode: employmentType === "contract" ? contractCategoryCode : null,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed to approve")
      toast.success("Account created successfully")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.pendingApplications() })
      const remaining = pendingUsers.filter((u) => u.id !== selectedUser.id)
      if (remaining.length > 0) handleUserSelect(remaining[0])
      else {
        setSelectedUser(null)
      }
      onSuccess()
      if (result.profileId && result.pendingEmailPreview) {
        setPendingEmailDispatch({
          profileId: result.profileId as string,
          welcome: result.pendingEmailPreview.welcome as PendingEmailDispatch["welcome"],
          internal: result.pendingEmailPreview.internal as PendingEmailDispatch["internal"],
        })
      }
    } catch (err: any) {
      log.error({ err }, "Approval error")
      toast.error(err.message || "Failed to approve")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async (rejectionReason: string) => {
    if (!selectedUser) return
    setIsProcessing(true)
    try {
      const res = await apiFetch("/api/admin/reject-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingUserId: selectedUser.id, rejectionReason }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to reject")
      toast.success("Application rejected")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.pendingApplications() })
      const remaining = pendingUsers.filter((u) => u.id !== selectedUser.id)
      if (remaining.length > 0) handleUserSelect(remaining[0])
      else {
        setSelectedUser(null)
      }
    } catch (err) {
      log.error({ err }, "Rejection error")
      toast.error("Failed to reject application")
    } finally {
      setIsProcessing(false)
    }
  }

  // ── EXIT EMPLOYEE ────────────────────────────────────────────────────────────
  const activeEmployees = employees.filter((e) => e.employment_status === "active")
  const [exitSearch, setExitSearch] = useState("")
  const [selectedExitIds, setSelectedExitIds] = useState<Set<string>>(new Set())
  const [sharedExitDate, setSharedExitDate] = useState(today)
  const [sharedExitReason, setSharedExitReason] = useState("")
  const [exitOverrides, setExitOverrides] = useState<Record<string, Partial<PerPersonEntry>>>({})
  const [isExiting, setIsExiting] = useState(false)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [exitNotifyOpen, setExitNotifyOpen] = useState(false)
  const [isSendingExitNotif, setIsSendingExitNotif] = useState(false)
  const [succeededExitIds, setSucceededExitIds] = useState<string[]>([])

  const filteredExitEmployees = activeEmployees.filter((e) => {
    if (!exitSearch.trim()) return true
    const q = exitSearch.toLowerCase()
    return `${e.first_name} ${e.last_name} ${e.department} ${e.employee_number ?? ""}`.toLowerCase().includes(q)
  })

  const selectedExitEmployees = activeEmployees.filter((e) => selectedExitIds.has(e.id))

  const getExitEntry = (id: string): PerPersonEntry => ({
    exitDate: exitOverrides[id]?.exitDate ?? sharedExitDate,
    reasonCode: exitOverrides[id]?.reasonCode ?? sharedExitReason,
  })

  const setExitOverride = (id: string, field: keyof PerPersonEntry, value: string) =>
    setExitOverrides((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))

  const toggleExitEmployee = (id: string) => {
    setSelectedExitIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        setExitOverrides((o) => {
          const n = { ...o }
          delete n[id]
          return n
        })
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allExitValid = selectedExitEmployees.every((e) => {
    const entry = getExitEntry(e.id)
    return entry.reasonCode && entry.exitDate
  })

  const handleExitSubmit = async (sendNotification: boolean) => {
    setIsExiting(true)
    try {
      const payload = {
        employees: selectedExitEmployees.map((e) => ({
          employeeId: e.id,
          ...getExitEntry(e.id),
          reasonLabel: exitReasonOptions.find((o) => o.value === getExitEntry(e.id).reasonCode)?.label,
        })),
        sendNotification,
      }
      const res = await apiFetch("/api/v1/hr/employees/bulk-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed to exit employees")

      const { succeeded, failed, results } = result as {
        succeeded: number
        failed: number
        results: { id: string; success: boolean }[]
      }

      if (succeeded > 0) {
        setSucceededExitIds(results.filter((r) => r.success).map((r) => r.id))
        toast.success(
          `${succeeded} employee${succeeded > 1 ? "s" : ""} exited${failed > 0 ? ` (${failed} skipped)` : ""}`
        )
        onSuccess()
        setSelectedExitIds(new Set())
        setExitOverrides({})
        setExitConfirmOpen(false)
        if (!sendNotification) {
          setExitNotifyOpen(true)
          return
        }
      } else {
        toast.error("All exits failed — employees may have active blockers")
        setExitConfirmOpen(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to exit employees")
      setExitConfirmOpen(false)
    } finally {
      setIsExiting(false)
    }
  }

  const handleSendExitNotif = async () => {
    if (!succeededExitIds.length) return
    setIsSendingExitNotif(true)
    try {
      const res = await apiFetch("/api/v1/hr/employees/bulk-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employees: succeededExitIds.map((id) => ({ employeeId: id, ...getExitEntry(id) })),
          sendNotification: true,
        }),
      })
      if (res.ok) toast.success("Exit notification sent to all staff")
      else {
        const e = await res.json()
        toast.error(e.error || "Failed to send notification")
      }
    } catch {
      toast.error("Failed to send notification")
    } finally {
      setIsSendingExitNotif(false)
      setExitNotifyOpen(false)
    }
  }

  // ── Shared detail row ────────────────────────────────────────────────────────
  const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="border-border hover:bg-muted/50 grid grid-cols-4 border-b transition-colors">
      <div className="border-border bg-muted/40 flex items-center border-r p-3">
        <span className="text-muted-foreground text-xs font-bold uppercase">{label}</span>
      </div>
      <div className="bg-background col-span-3 flex items-center p-3">{value}</div>
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90vh] max-w-6xl flex-col overflow-hidden p-0">
          <div className="sr-only">
            <DialogTitle>Manage Users</DialogTitle>
            <DialogDescription>Create employees, review applications, and process exits.</DialogDescription>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="border-border border-b px-6 pt-5 pb-0">
              <h2 className="mb-4 text-lg font-bold tracking-tight">Manage Users</h2>
              <TabsList className="h-auto gap-0 rounded-none border-b-0 bg-transparent p-0">
                {[
                  { value: "create", icon: <Plus className="mr-1.5 h-3.5 w-3.5" />, label: "Create User" },
                  {
                    value: "applications",
                    icon: <UserPlus className="mr-1.5 h-3.5 w-3.5" />,
                    label: "Review Applications",
                    badge: pendingUsers.length > 0 ? pendingUsers.length : null,
                  },
                  { value: "exit", icon: <UserMinus className="mr-1.5 h-3.5 w-3.5" />, label: "Exit Employee" },
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="data-[state=active]:border-primary data-[state=active]:text-primary rounded-none border-b-2 border-transparent px-4 pb-3 text-sm font-medium data-[state=active]:shadow-none"
                  >
                    {tab.icon}
                    {tab.label}
                    {"badge" in tab && tab.badge && (
                      <Badge variant="destructive" className="ml-1.5 h-4 px-1.5 text-[10px]">
                        {tab.badge}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* ── TAB: Create User ───────────────────────────────────────────────── */}
            <TabsContent value="create" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
              <ScrollArea className="flex-1">
                <div className="space-y-4 p-6 pb-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="cu_fn">
                        First Name <span className="text-destructive">*</span>
                      </Label>
                      <Input id="cu_fn" {...register("firstName")} placeholder="John" className="mt-1.5" />
                      {errors.firstName && <p className="text-destructive mt-1 text-xs">{errors.firstName.message}</p>}
                    </div>
                    <div>
                      <Label htmlFor="cu_ln">
                        Last Name <span className="text-destructive">*</span>
                      </Label>
                      <Input id="cu_ln" {...register("lastName")} placeholder="Doe" className="mt-1.5" />
                      {errors.lastName && <p className="text-destructive mt-1 text-xs">{errors.lastName.message}</p>}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cu_on">Other Names</Label>
                    <Input
                      id="cu_on"
                      {...register("otherNames")}
                      placeholder="Middle name (optional)"
                      className="mt-1.5"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="cu_gender">
                        Gender <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={selectedGender}
                        onValueChange={(value) => setValue("gender", value as "male" | "female")}
                      >
                        <SelectTrigger id="cu_gender" className="mt-1.5">
                          <SelectValue placeholder="Select Gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                      {errors.gender && <p className="text-destructive mt-1 text-xs">{errors.gender.message}</p>}
                    </div>
                    <div>
                      <Label htmlFor="cu_dob">Date of Birth</Label>
                      <Input id="cu_dob" type="date" {...register("dateOfBirth")} className="mt-1.5" />
                      {errors.dateOfBirth && (
                        <p className="text-destructive mt-1 text-xs">{errors.dateOfBirth.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="cu_employment_type">Employment Type</Label>
                      <Select
                        value={employmentTypeValue}
                        onValueChange={(value) => {
                          setValue("employmentType", value as any)
                          if (value !== "contract") {
                            setValue("contractCategoryCode", "")
                          } else if (contractCategories.length > 0) {
                            setValue("contractCategoryCode", contractCategories[0].code)
                          }
                        }}
                      >
                        <SelectTrigger id="cu_employment_type" className="mt-1.5">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_time">Full Time</SelectItem>
                          <SelectItem value="part_time">Part Time</SelectItem>
                          <SelectItem value="contract">Contract</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {employmentTypeValue === "contract" && (
                      <div>
                        <Label htmlFor="cu_contract_category">Contract Category</Label>
                        <Select
                          value={contractCategoryCodeValue}
                          onValueChange={(value) => setValue("contractCategoryCode", value)}
                        >
                          <SelectTrigger id="cu_contract_category" className="mt-1.5">
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
                    <span className="text-muted-foreground text-xs font-semibold uppercase">Assigned ID Preview</span>
                    <p className="text-primary mt-1 font-mono text-sm font-bold">{getPreviewId()}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      The exact number will be generated automatically.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="cu_email">
                        Email <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cu_email"
                        type="email"
                        {...register("email")}
                        placeholder="john@acoblighting.com"
                        className="mt-1.5"
                      />
                      {errors.email && <p className="text-destructive mt-1 text-xs">{errors.email.message}</p>}
                    </div>
                    <div>
                      <Label htmlFor="cu_phone">
                        Phone Number <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cu_phone"
                        type="tel"
                        {...register("phoneNumber")}
                        placeholder="e.g., 08012345678"
                        className="mt-1.5"
                      />
                      {errors.phoneNumber && (
                        <p className="text-destructive mt-1 text-xs">{errors.phoneNumber.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="cu_additional_phone">Additional Phone (Optional)</Label>
                      <Input
                        id="cu_additional_phone"
                        type="tel"
                        {...register("additionalPhone")}
                        placeholder="e.g., 08012345678"
                        className="mt-1.5"
                      />
                      {errors.additionalPhone && (
                        <p className="text-destructive mt-1 text-xs">{errors.additionalPhone.message}</p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="cu_address">
                        Residential Address <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cu_address"
                        {...register("residentialAddress")}
                        placeholder="Full home address"
                        className="mt-1.5"
                      />
                      {errors.residentialAddress && (
                        <p className="text-destructive mt-1 text-xs">{errors.residentialAddress.message}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="cu_office_location">Office / Room (Optional)</Label>
                    <Select
                      value={watch("officeLocation")}
                      onValueChange={(value) => setValue("officeLocation", value)}
                    >
                      <SelectTrigger id="cu_office_location" className="mt-1.5">
                        <SelectValue placeholder="Select Office / Room" />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFICE_LOCATIONS.map((loc) => (
                          <SelectItem key={loc} value={loc}>
                            {loc}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.officeLocation && (
                      <p className="text-destructive mt-1 text-xs">{errors.officeLocation.message}</p>
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label>
                        Department <span className="text-destructive">*</span>
                      </Label>
                      <Select value={watch("department")} onValueChange={(v) => setValue("department", v)}>
                        <SelectTrigger className="mt-1.5">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.department && (
                        <p className="text-destructive mt-1 text-xs">{errors.department.message}</p>
                      )}
                    </div>
                    <div>
                      <Label>Role</Label>
                      <Select
                        value={roleValue}
                        onValueChange={(v) => {
                          setValue("role", v)
                          if (v !== "admin") setValue("admin_routes", [])
                        }}
                      >
                        <SelectTrigger className="mt-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(getAssignableRolesForActor(userProfile.role) as UserRole[]).map((r) => (
                            <SelectItem key={r} value={r}>
                              {getRoleDisplayName(r)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {roleValue === "admin" && (
                    <div>
                      <Label>
                        Admin Routes <span className="text-destructive">*</span>
                      </Label>
                      <AdminRoutesPicker
                        values={watch("admin_routes")}
                        onChange={(vals) => setValue("admin_routes", vals)}
                      />
                      <p className="text-muted-foreground mt-1 text-xs">Admin must have at least one route.</p>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="cu_desig">
                      Designation <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="cu_desig"
                      {...register("companyRole")}
                      placeholder="e.g., Senior Developer"
                      className="mt-1.5"
                    />
                    {errors.companyRole && (
                      <p className="text-destructive mt-1 text-xs">{errors.companyRole.message}</p>
                    )}
                  </div>
                </div>
              </ScrollArea>
              <div className="bg-background flex justify-end gap-2 border-t p-4">
                <Button variant="outline" onClick={() => resetCreate()} disabled={isCreating}>
                  Reset
                </Button>
                <Button onClick={rhf.handleSubmit(() => handleCreateUser())} disabled={isCreating} className="gap-2">
                  {isCreating ? (
                    "Creating…"
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Create User
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>

            {/* ── TAB: Review Applications ───────────────────────────────────────── */}
            <TabsContent value="applications" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 flex-1">
                {/* Queue sidebar */}
                <aside className="border-border bg-muted/10 flex w-[280px] shrink-0 flex-col border-r">
                  <div className="border-border bg-background border-b p-5">
                    <h3 className="font-bold">Queue</h3>
                    <p className="text-muted-foreground text-xs">Verification Needed</p>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="divide-border divide-y">
                      {isLoadingPending ? (
                        <div className="flex flex-col items-center gap-3 p-10 opacity-50">
                          <Loader2 className="text-primary h-5 w-5 animate-spin" />
                          <p className="text-xs">Loading…</p>
                        </div>
                      ) : pendingUsers.length === 0 ? (
                        <div className="space-y-2 p-10 text-center opacity-40">
                          <CheckCircle className="mx-auto h-7 w-7" />
                          <p className="text-xs font-medium">Queue is empty</p>
                        </div>
                      ) : (
                        pendingUsers.map((user) => (
                          <button
                            key={user.id}
                            onClick={() => handleUserSelect(user)}
                            className={cn(
                              "group flex w-full items-center justify-between px-5 py-4 text-left transition-all",
                              selectedUser?.id === user.id
                                ? "bg-muted border-l-primary border-l-4"
                                : "hover:bg-muted/50 border-l-4 border-l-transparent"
                            )}
                          >
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  "truncate text-sm font-bold",
                                  selectedUser?.id === user.id ? "text-primary" : "text-foreground"
                                )}
                              >
                                {formatName(user.first_name)} {formatName(user.last_name)}
                              </p>
                              <p className="text-muted-foreground mt-0.5 text-[11px]">
                                Applied {format(new Date(user.created_at), "MMM d, yyyy")}
                              </p>
                            </div>
                            <ChevronRight
                              className={cn(
                                "h-3 w-3 shrink-0",
                                selectedUser?.id === user.id ? "text-primary" : "text-muted-foreground/30"
                              )}
                            />
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </aside>

                {/* Applicant detail */}
                <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                  {selectedUser ? (
                    <>
                      <ScrollArea className="flex-1">
                        <div className="p-8 pb-28">
                          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                            <h3 className="text-lg font-bold">Applicant Verification Profile</h3>
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-end">
                                <span className="text-muted-foreground mb-1 text-[10px] font-bold uppercase">
                                  Hire Date
                                </span>
                                <Input
                                  type="date"
                                  value={hireDate}
                                  onChange={(e) => setHireDate(e.target.value)}
                                  className="h-9 w-40 font-mono text-xs"
                                />
                              </div>
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-muted-foreground text-[10px] font-bold uppercase">Type</span>
                                <Select
                                  value={employmentType}
                                  onValueChange={(value: any) => {
                                    setEmploymentType(value)
                                    if (value !== "contract") {
                                      setContractCategoryCode("")
                                    } else if (contractCategories.length > 0) {
                                      setContractCategoryCode(contractCategories[0].code)
                                    }
                                  }}
                                >
                                  <SelectTrigger className="h-9 w-32 text-xs font-bold">
                                    <SelectValue placeholder="Type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="full_time">Full Time</SelectItem>
                                    <SelectItem value="part_time">Part Time</SelectItem>
                                    <SelectItem value="contract">Contract</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {employmentType === "contract" && (
                                <div className="flex flex-col items-start gap-1">
                                  <span className="text-muted-foreground text-[10px] font-bold uppercase">
                                    Category
                                  </span>
                                  <Select
                                    value={contractCategoryCode}
                                    onValueChange={(value) => setContractCategoryCode(value)}
                                  >
                                    <SelectTrigger className="h-9 w-32 text-xs font-bold">
                                      <SelectValue placeholder="Category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {contractCategories.map((cat) => (
                                        <SelectItem key={cat.id} value={cat.code}>
                                          {cat.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              <Badge variant="outline" className="self-end text-[10px] font-bold">
                                PENDING
                              </Badge>
                            </div>
                          </div>

                          <div className="border-border overflow-hidden rounded-lg border shadow-sm">
                            <DetailRow
                              label="First Name"
                              value={
                                <Input
                                  value={firstName}
                                  onChange={(e) => setFirstName(e.target.value)}
                                  className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                />
                              }
                            />
                            <DetailRow
                              label="Last Name"
                              value={
                                <Input
                                  value={lastName}
                                  onChange={(e) => setLastName(e.target.value)}
                                  className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                />
                              }
                            />
                            <DetailRow
                              label="Other Names"
                              value={
                                <Input
                                  value={otherNames}
                                  onChange={(e) => setOtherNames(e.target.value)}
                                  className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                  placeholder="Optional other names"
                                />
                              }
                            />
                            <div>
                              <div className="bg-muted/20 text-muted-foreground border-border border-b p-2 text-[10px] font-bold uppercase">
                                Organisational
                              </div>
                              <DetailRow
                                label="Department"
                                value={
                                  <Select value={department} onValueChange={setDepartment}>
                                    <SelectTrigger className="h-8 w-full border-0 bg-transparent text-left font-medium shadow-none focus:ring-0">
                                      <SelectValue placeholder="Select Department" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DEPARTMENTS.map((dept) => (
                                        <SelectItem key={dept} value={dept}>
                                          {dept}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                }
                              />
                              <DetailRow
                                label="Designation"
                                value={
                                  <Input
                                    value={designation}
                                    onChange={(e) => setDesignation(e.target.value)}
                                    className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                  />
                                }
                              />
                              <DetailRow
                                label="System Email"
                                value={
                                  <Input
                                    value={companyEmail}
                                    onChange={(e) => setCompanyEmail(e.target.value)}
                                    className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                  />
                                }
                              />
                              <DetailRow
                                label="Expected Company ID"
                                value={
                                  <span className="text-foreground pl-3 text-sm font-medium">
                                    {employmentType === "full_time"
                                      ? `ACOB/${new Date().getFullYear()}/... (Auto-generated)`
                                      : employmentType === "part_time"
                                        ? `ACOB/PT/${new Date().getFullYear()}/... (Auto-generated)`
                                        : `ACOB/${contractCategoryCode || "SIWES"}/${new Date().getFullYear()}/... (Auto-generated)`}
                                  </span>
                                }
                              />
                              <DetailRow
                                label="Applicant Type Choice"
                                value={
                                  <span className="text-foreground pl-3 text-sm font-medium">
                                    {selectedUser.employment_type
                                      ? selectedUser.employment_type
                                          .replace("_", " ")
                                          .replace(/\b\w/g, (c) => c.toUpperCase())
                                      : "Not selected"}
                                  </span>
                                }
                              />
                              {selectedUser.employment_type === "contract" && (
                                <DetailRow
                                  label="Applicant Category Choice"
                                  value={
                                    <span className="text-foreground pl-3 text-sm font-medium">
                                      {selectedUser.contract_categories?.name
                                        ? `${selectedUser.contract_categories.name} (${selectedUser.contract_categories.code})`
                                        : "Not selected"}
                                    </span>
                                  }
                                />
                              )}
                              <DetailRow
                                label="Office"
                                value={
                                  <Select value={officeLocation} onValueChange={setOfficeLocation}>
                                    <SelectTrigger className="h-8 w-full border-0 bg-transparent text-left font-medium shadow-none focus:ring-0">
                                      <SelectValue placeholder="Select Location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {OFFICE_LOCATIONS.map((loc: string) => (
                                        <SelectItem key={loc} value={loc}>
                                          {loc}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                }
                              />
                            </div>
                            <div>
                              <div className="bg-muted/20 text-muted-foreground border-border border-b p-2 text-[10px] font-bold uppercase">
                                Personal & Contact
                              </div>
                              <DetailRow
                                label="Phone"
                                value={
                                  <Input
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                    className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                  />
                                }
                              />
                              <DetailRow
                                label="Personal Email"
                                value={
                                  <Input
                                    value={personalEmailState}
                                    onChange={(e) => setPersonalEmailState(e.target.value)}
                                    className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                  />
                                }
                              />
                              <DetailRow
                                label="Address"
                                value={
                                  <Input
                                    value={residentialAddress}
                                    onChange={(e) => setResidentialAddress(e.target.value)}
                                    className="focus-visible:ring-primary h-8 border-0 bg-transparent font-medium shadow-none focus-visible:ring-1"
                                  />
                                }
                              />
                              <DetailRow
                                label="Applied"
                                value={
                                  <span className="text-foreground pl-3 text-sm font-medium">
                                    {format(new Date(selectedUser.created_at), "PPPP")}
                                  </span>
                                }
                              />
                            </div>
                          </div>

                          <div className="bg-muted/40 border-border mt-8 flex items-start gap-3 rounded-lg border p-4">
                            <ShieldCheck className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                            <p className="text-muted-foreground text-xs leading-relaxed">
                              Verify all fields against official documentation before approving. Approval creates the
                              employee account immediately.
                            </p>
                          </div>

                          {approvalEmailPreview && (
                            <div className="mt-8 space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="font-semibold">Email Preview</h4>
                                {isLoadingApprovalPreview && <Loader2 className="text-primary h-4 w-4 animate-spin" />}
                              </div>
                              <Tabs defaultValue="welcome" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                  <TabsTrigger value="welcome">Welcome Email</TabsTrigger>
                                  <TabsTrigger value="internal">Internal Notice</TabsTrigger>
                                </TabsList>
                                <TabsContent value="welcome">
                                  <div className="border-border rounded-lg border">
                                    <div className="bg-muted/30 border-b p-3">
                                      <Badge variant={approvalEmailPreview.welcome.enabled ? "default" : "secondary"}>
                                        {approvalEmailPreview.welcome.enabled ? "ENABLED" : "DISABLED"}
                                      </Badge>
                                      <p className="mt-1 text-sm font-medium">{approvalEmailPreview.welcome.subject}</p>
                                    </div>
                                    <iframe
                                      title="Welcome email"
                                      srcDoc={approvalEmailPreview.welcome.html}
                                      className="h-96 w-full rounded-b-lg bg-white"
                                    />
                                  </div>
                                </TabsContent>
                                <TabsContent value="internal">
                                  <div className="border-border rounded-lg border">
                                    <div className="bg-muted/30 border-b p-3">
                                      <Badge variant={approvalEmailPreview.internal.enabled ? "default" : "secondary"}>
                                        {approvalEmailPreview.internal.enabled ? "ENABLED" : "DISABLED"}
                                      </Badge>
                                      <p className="mt-1 text-sm font-medium">
                                        {approvalEmailPreview.internal.subject}
                                      </p>
                                    </div>
                                    <iframe
                                      title="Internal email"
                                      srcDoc={approvalEmailPreview.internal.html}
                                      className="h-80 w-full rounded-b-lg bg-white"
                                    />
                                  </div>
                                </TabsContent>
                              </Tabs>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <div className="bg-background border-border absolute right-0 bottom-0 left-0 flex justify-end gap-3 border-t p-5">
                        <Button variant="outline" onClick={() => setPendingReject(true)} disabled={isProcessing}>
                          Reject Candidate
                        </Button>
                        <Button onClick={handleApprove} disabled={isProcessing} className="px-8 font-bold">
                          {isProcessing ? (
                            <>
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                              Processing
                            </>
                          ) : (
                            "Confirm & Approve"
                          )}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center opacity-30">
                      <UserPlus className="mb-3 h-10 w-10" />
                      <p className="text-sm font-medium">Select an application from the queue</p>
                    </div>
                  )}
                </main>
              </div>
            </TabsContent>

            {/* ── TAB: Exit Employee ─────────────────────────────────────────────── */}
            <TabsContent value="exit" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 flex-1">
                {/* Left: employee list */}
                <div className="border-border flex w-[300px] shrink-0 flex-col border-r">
                  <div className="border-border space-y-3 border-b p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">Active Employees</p>
                      {selectedExitIds.size > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {selectedExitIds.size} selected
                        </Badge>
                      )}
                    </div>
                    <div className="relative">
                      <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
                      <Input
                        placeholder="Search name, department…"
                        value={exitSearch}
                        onChange={(e) => setExitSearch(e.target.value)}
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="divide-border divide-y">
                      {filteredExitEmployees.length === 0 ? (
                        <p className="text-muted-foreground p-6 text-center text-sm">No active employees found</p>
                      ) : (
                        filteredExitEmployees.map((emp) => (
                          <label
                            key={emp.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors select-none",
                              selectedExitIds.has(emp.id) ? "bg-destructive/5" : "hover:bg-muted/50"
                            )}
                          >
                            <Checkbox
                              checked={selectedExitIds.has(emp.id)}
                              onCheckedChange={() => toggleExitEmployee(emp.id)}
                              className="shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {formatName(emp.first_name)} {formatName(emp.last_name)}
                              </p>
                              <p className="text-muted-foreground truncate text-xs">{emp.department}</p>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Right: exit config */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  {selectedExitEmployees.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center opacity-30">
                      <UserMinus className="mb-3 h-10 w-10" />
                      <p className="text-sm font-medium">Select employees on the left to configure their exit</p>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1">
                        <div className="space-y-5 p-5">
                          {/* Shared defaults */}
                          <div className="bg-muted/40 space-y-3 rounded-lg border p-4">
                            <p className="text-sm font-semibold">Shared defaults</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Exit Date</Label>
                                <Input
                                  type="date"
                                  value={sharedExitDate}
                                  onChange={(e) => setSharedExitDate(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Exit Reason</Label>
                                <Select value={sharedExitReason} onValueChange={setSharedExitReason}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select reason" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {exitReasonOptions.map((o) => (
                                      <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>

                          {/* Per-employee rows */}
                          <div className="space-y-3">
                            <p className="text-sm font-semibold">Selected employees</p>
                            {selectedExitEmployees.map((emp) => {
                              const entry = getExitEntry(emp.id)
                              const hasOverride = exitOverrides[emp.id]?.exitDate || exitOverrides[emp.id]?.reasonCode
                              return (
                                <div key={emp.id} className="space-y-3 rounded-lg border p-3">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-sm font-semibold">
                                        {formatName(emp.first_name)} {formatName(emp.last_name)}
                                      </span>
                                      <span className="text-muted-foreground ml-2 text-xs">{emp.department}</span>
                                    </div>
                                    {hasOverride && (
                                      <Badge variant="outline" className="text-[10px]">
                                        Custom
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-muted-foreground text-xs">Exit Date</Label>
                                      <Input
                                        type="date"
                                        value={entry.exitDate}
                                        onChange={(e) => setExitOverride(emp.id, "exitDate", e.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-muted-foreground text-xs">Exit Reason</Label>
                                      <Select
                                        value={entry.reasonCode}
                                        onValueChange={(v) => setExitOverride(emp.id, "reasonCode", v)}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select reason" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {exitReasonOptions.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>
                                              {o.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Warning */}
                          <div className="bg-destructive/10 border-destructive/20 flex items-start gap-2 rounded-lg border p-3">
                            <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
                            <p className="text-destructive text-xs">
                              This immediately revokes system access. Employees with active assets, tasks, or lead roles
                              will be skipped.
                            </p>
                          </div>
                        </div>
                      </ScrollArea>
                      <div className="bg-background flex justify-end border-t p-4">
                        <Button
                          variant="destructive"
                          disabled={isExiting || !allExitValid}
                          onClick={() => setExitConfirmOpen(true)}
                          className="min-w-[160px]"
                        >
                          {isExiting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Processing…
                            </>
                          ) : (
                            <>
                              <UserMinus className="mr-2 h-4 w-4" />
                              Exit {selectedExitEmployees.length} Employee{selectedExitEmployees.length > 1 ? "s" : ""}
                            </>
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Exit confirm */}
      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm exit</AlertDialogTitle>
            <AlertDialogDescription>
              This will exit{" "}
              <strong>
                {selectedExitEmployees.length} employee{selectedExitEmployees.length > 1 ? "s" : ""}
              </strong>{" "}
              and immediately revoke their system access. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExiting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isExiting}
              onClick={async () => {
                await handleExitSubmit(false)
              }}
            >
              Confirm Exit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exit notification */}
      <AlertDialog
        open={exitNotifyOpen}
        onOpenChange={(v) => {
          if (!isSendingExitNotif) setExitNotifyOpen(v)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send Exit Notification?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Send an all-staff email notifying everyone that{" "}
              <strong>
                {succeededExitIds.length === 1 ? "this employee has" : `${succeededExitIds.length} employees have`}
              </strong>{" "}
              exited the organisation?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSendingExitNotif} onClick={() => setExitNotifyOpen(false)}>
              No, skip
            </AlertDialogCancel>
            <Button
              loading={isSendingExitNotif}
              onClick={async () => {
                await handleSendExitNotif()
              }}
            >
              Yes, send notification
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Onboarding email dispatch */}
      <AlertDialog
        open={Boolean(pendingEmailDispatch)}
        onOpenChange={(v) => {
          if (!v && !isSendingEmails) setPendingEmailDispatch(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send Onboarding Emails?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Account created. Send onboarding emails to configured recipients?
              {pendingEmailDispatch && (
                <span className="mt-2 block text-xs">
                  Welcome → {pendingEmailDispatch.welcome.recipients.join(", ") || "none"}.<br />
                  Internal → {pendingEmailDispatch.internal.recipients.join(", ") || "none"}.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSendingEmails} onClick={() => setPendingEmailDispatch(null)}>
              No, skip
            </AlertDialogCancel>
            <Button
              loading={isSendingEmails}
              onClick={async () => {
                if (!pendingEmailDispatch) return
                setIsSendingEmails(true)
                try {
                  const res = await apiFetch("/api/admin/send-onboarding-emails", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(pendingEmailDispatch),
                  })
                  const data = await res.json()
                  if (res.ok) {
                    const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : []
                    warnings.length > 0
                      ? toast.warning("Emails sent with issues", { description: warnings.join(" | ") })
                      : toast.success("Onboarding emails sent successfully")
                  } else {
                    toast.error(data.error || "Failed to send emails")
                  }
                } catch {
                  toast.error("Failed to send emails")
                } finally {
                  setIsSendingEmails(false)
                  setPendingEmailDispatch(null)
                }
              }}
            >
              Yes, send emails
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject — captures the reason that is recorded against the application */}
      <PromptDialog
        open={pendingReject}
        onOpenChange={(v) => !v && setPendingReject(false)}
        title="Reject Application"
        description="This cannot be undone. The reason is recorded against the application."
        label="Reason for rejection"
        placeholder="e.g. Role has been filled"
        inputType="textarea"
        required
        confirmLabel="Reject"
        confirmLoadingLabel="Rejecting..."
        confirmVariant="destructive"
        onConfirm={async (reason) => {
          await handleReject(reason)
          setPendingReject(false)
        }}
      />
    </>
  )
}
