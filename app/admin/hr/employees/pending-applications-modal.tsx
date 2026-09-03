"use client"

import { useCallback, useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, CheckCircle, UserPlus, ChevronRight, ShieldCheck, Hash, Mail } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { format } from "date-fns"
import { cn, formatName } from "@/lib/utils"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toLocalISODate } from "@/lib/utils/date"
import { useDepartments } from "@/hooks/use-departments"
import { OFFICE_LOCATIONS } from "@/lib/rooms-and-offices"

import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("hr-employees-pending-applications-modal")

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

interface PendingApplicationsModalProps {
  onEmployeeCreated: () => void
}

interface ApprovalEmailPreview {
  tempPassword: string
  portalUrl: string
  welcome: {
    enabled: boolean
    subject: string
    recipients: string[]
    html: string
  }
  internal: {
    enabled: boolean
    subject: string
    recipients: string[]
    html: string
  }
}

interface PendingEmailDispatch {
  profileId: string
  welcome: { subject: string; recipients: string[]; html: string }
  internal: { subject: string; recipients: string[]; html: string }
}

interface ApprovalEmailWarning {
  audience: "employee" | "management"
  reason: string
  recipients: string[]
}

async function fetchPendingApplications(): Promise<PendingUser[]> {
  const response = await apiFetch("/api/admin/pending-users", { cache: "no-store" })
  const payload = (await response.json().catch(() => null)) as { data?: PendingUser[]; error?: string } | null
  if (!response.ok) throw new Error(payload?.error || "Failed to load applications")
  return payload?.data || []
}

export function PendingApplicationsModal({ onEmployeeCreated }: PendingApplicationsModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingReject, setPendingReject] = useState(false)
  const [employmentType, setEmploymentType] = useState<"full_time" | "part_time" | "contract">("full_time")
  const [contractCategoryCode, setContractCategoryCode] = useState("")
  const [pendingEmailDispatch, setPendingEmailDispatch] = useState<PendingEmailDispatch | null>(null)
  const [isSendingEmails, setIsSendingEmails] = useState(false)
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true)
  const [sendInternalEmail, setSendInternalEmail] = useState(false)

  // Edit fields states
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

  const { departments: DEPARTMENTS = [] } = useDepartments()

  const [supabase] = useState(() => createClient())
  const queryClient = useQueryClient()

  const { data: pendingUsers = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.pendingApplications(),
    queryFn: fetchPendingApplications,
    enabled: isOpen,
  })

  const [hireDate, setHireDate] = useState(toLocalISODate())

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

  const { data: approvalEmailPreview, isLoading: isLoadingApprovalPreview } = useQuery<ApprovalEmailPreview>({
    queryKey: ["pending-approval-email-preview", selectedUser?.id, employmentType, contractCategoryCode],
    queryFn: async () => {
      if (!selectedUser?.id) {
        throw new Error("Missing approval preview context")
      }

      // Construct a valid dummy ID for the preview API route matching regex
      const currentYear = new Date().getFullYear()
      const dummyId =
        employmentType === "full_time"
          ? `ACOB/${currentYear}/999`
          : employmentType === "part_time"
            ? `ACOB/PT/${currentYear}/999`
            : `ACOB/${contractCategoryCode || "SIWES"}/${currentYear}/999`

      const response = await apiFetch(
        `/api/admin/pending-users/${selectedUser.id}/approval-preview?employeeId=${encodeURIComponent(dummyId)}`
      )
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to load approval email preview")
      }

      return result as ApprovalEmailPreview
    },
    enabled: isOpen && !!selectedUser?.id,
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

  // Auto-select first user when data loads
  useEffect(() => {
    if (pendingUsers.length > 0 && !selectedUser) {
      handleUserSelect(pendingUsers[0])
    }
  }, [pendingUsers, selectedUser, handleUserSelect])

  const handleApprove = async () => {
    if (!selectedUser) return

    setIsProcessing(true)

    try {
      // 1. Update the record in pending_users with the edited details
      const { error: updateError } = await supabase
        .from("pending_users")
        .update({
          first_name: formatName(firstName),
          last_name: formatName(lastName),
          other_names: otherNames ? formatName(otherNames) : null,
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
      const response = await apiFetch("/api/admin/approve-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingUserId: selectedUser.id,
          hireDate: hireDate,
          sendEmails: false,
          employmentType: employmentType,
          contractCategoryCode: contractCategoryCode || null,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to approve user")
      }

      toast.success("Account created successfully")

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.pendingApplications() })
      const remaining = pendingUsers.filter((u) => u.id !== selectedUser.id)
      if (remaining.length > 0) {
        handleUserSelect(remaining[0])
      } else {
        setSelectedUser(null)
      }
      onEmployeeCreated()

      // Prompt admin to send onboarding emails
      if (result.profileId && result.pendingEmailPreview) {
        setSendWelcomeEmail(true)
        setSendInternalEmail(false)
        setPendingEmailDispatch({
          profileId: result.profileId as string,
          welcome: result.pendingEmailPreview.welcome as PendingEmailDispatch["welcome"],
          internal: result.pendingEmailPreview.internal as PendingEmailDispatch["internal"],
        })
      }
    } catch (error: unknown) {
      log.error("Approval error:", error)
      toast.error(error instanceof Error ? error.message : "Failed to approve user")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async (rejectionReason: string) => {
    if (!selectedUser) return

    setIsProcessing(true)
    try {
      const response = await apiFetch("/api/admin/reject-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingUserId: selectedUser.id, rejectionReason }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to reject application")

      toast.success("Application rejected")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.pendingApplications() })
      const remaining = pendingUsers.filter((u) => u.id !== selectedUser.id)
      if (remaining.length > 0) {
        handleUserSelect(remaining[0])
      } else {
        setSelectedUser(null)
      }
    } catch (error: unknown) {
      log.error("Rejection error:", error)
      toast.error("Failed to reject application")
    } finally {
      setIsProcessing(false)
    }
  }

  const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="border-border hover:bg-muted/50 grid grid-cols-4 border-b transition-colors">
      <div className="border-border bg-muted/40 flex items-center border-r p-3">
        <span className="text-muted-foreground text-xs font-bold uppercase">{label}</span>
      </div>
      <div className="bg-background col-span-3 flex items-center p-3">{value}</div>
    </div>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-9 gap-2">
          <UserPlus className="h-4 w-4" />
          Review Applications
          {pendingUsers.length > 0 && (
            <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
              {pendingUsers.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-background text-foreground flex h-[85vh] max-w-6xl flex-col overflow-hidden p-0 font-sans shadow-2xl">
        <div className="sr-only">
          <DialogTitle>Pending Onboarding Applications</DialogTitle>
          <DialogDescription>Review and approve system access for new employees.</DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* List Column (Standard Sidebar) */}
          <aside className="border-border bg-muted/10 flex w-[300px] flex-col border-r">
            <div className="border-border bg-background border-b p-6">
              <h2 className="text-lg font-bold tracking-tight">Queue</h2>
              <p className="text-muted-foreground text-xs font-medium">Verification Needed</p>
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-border divide-y">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center gap-4 p-12 opacity-50">
                    <Loader2 className="text-primary h-6 w-6 animate-spin" />
                    <p className="text-xs font-medium">Loading...</p>
                  </div>
                ) : pendingUsers.length === 0 ? (
                  <div className="space-y-3 p-12 text-center opacity-40">
                    <CheckCircle className="mx-auto h-8 w-8" />
                    <p className="text-xs font-medium">Queue is empty</p>
                  </div>
                ) : (
                  pendingUsers.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => handleUserSelect(user)}
                      className={cn(
                        "group relative flex w-full items-center justify-between px-6 py-4 text-left transition-all",
                        selectedUser?.id === user.id
                          ? "bg-muted border-l-primary border-l-4 shadow-sm"
                          : "hover:bg-muted/50 border-l-4 border-l-transparent"
                      )}
                    >
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "truncate text-sm font-bold transition-colors",
                            selectedUser?.id === user.id ? "text-primary" : "text-foreground"
                          )}
                        >
                          {formatName(user.first_name)} {formatName(user.last_name)}
                        </div>
                        <div className="text-muted-foreground mt-1 text-[11px] font-medium">
                          Applied {format(new Date(user.created_at), "MMM d, yyyy")}
                        </div>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform",
                          selectedUser?.id === user.id ? "text-primary translate-x-1" : "text-muted-foreground/30"
                        )}
                      />
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* Content Column (Standard Details) */}
          <main className="bg-background relative flex flex-1 flex-col">
            {selectedUser ? (
              <>
                <ScrollArea className="flex-1">
                  <div className="max-w-4xl p-10 pb-32">
                    <div className="mb-6 flex items-center justify-between">
                      <h2 className="text-xl font-bold tracking-tight">Applicant Verification Profile</h2>
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-end">
                          <span className="text-muted-foreground mb-1 text-[10px] font-bold uppercase">Hire Date</span>
                          <Input
                            type="date"
                            value={hireDate}
                            onChange={(e) => setHireDate(e.target.value)}
                            className="bg-primary/5 border-primary/20 focus-visible:ring-primary h-9 w-40 font-mono text-xs font-bold"
                          />
                        </div>
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-muted-foreground text-[10px] font-bold uppercase">
                            Staff Classification
                          </span>
                          <Select
                            value={
                              employmentType === "full_time"
                                ? "full_time"
                                : employmentType === "part_time"
                                  ? "part_time"
                                  : contractCategoryCode
                                    ? `cat:${contractCategoryCode}`
                                    : "cat:CTR"
                            }
                            onValueChange={(value) => {
                              if (value === "full_time") {
                                setEmploymentType("full_time")
                                setContractCategoryCode("")
                              } else if (value === "part_time") {
                                setEmploymentType("part_time")
                                setContractCategoryCode("")
                              } else if (value.startsWith("cat:")) {
                                setEmploymentType("contract")
                                setContractCategoryCode(value.replace("cat:", ""))
                              }
                            }}
                          >
                            <SelectTrigger className="bg-primary/5 border-primary/20 h-9 w-44 text-xs font-bold">
                              <SelectValue placeholder="Classification" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full_time">Full Time</SelectItem>
                              <SelectItem value="part_time">Part Time</SelectItem>
                              {contractCategories.map((cat) => (
                                <SelectItem key={cat.id} value={`cat:${cat.code}`}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Badge variant="outline" className="mb-1 self-end py-0.5 text-[10px] font-bold">
                          PENDING APPROVAL
                        </Badge>
                      </div>
                    </div>

                    {/* Table Grid with full borders */}
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
                      <div className="border-border grid grid-cols-1 border-b">
                        <div className="bg-muted/20 text-muted-foreground border-border border-b p-2 text-[10px] font-bold uppercase">
                          Organizational Data
                        </div>
                        <div className="grid grid-cols-1">
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
                            label="Office / Room"
                            value={
                              <Select value={officeLocation} onValueChange={setOfficeLocation}>
                                <SelectTrigger className="h-8 w-full border-0 bg-transparent text-left font-medium shadow-none focus:ring-0">
                                  <SelectValue placeholder="Select Office / Room" />
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
                      </div>
                      <div className="grid grid-cols-1">
                        <div className="bg-muted/20 text-muted-foreground border-border border-b p-2 text-[10px] font-bold uppercase">
                          Personal & Contact
                        </div>
                        <div className="grid grid-cols-1">
                          <DetailRow
                            label="Phone Number"
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
                            label="Application Date"
                            value={
                              <span className="text-foreground pl-3 text-sm font-medium">
                                {format(new Date(selectedUser.created_at), "PPPP")}
                              </span>
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-muted/40 border-border mt-10 flex items-start gap-4 rounded-lg border p-5">
                      <ShieldCheck className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold">Admin Notice</p>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          Ensure all data fields match official documentation. Approval will automatically update the HR
                          database and broadcast welcome emails.
                        </p>
                      </div>
                    </div>

                    <div className="mt-10 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold tracking-tight">Approval Email Preview</h3>
                          <p className="text-muted-foreground text-xs">
                            These are the exact recipients and rendered email bodies that will be used for approval.
                          </p>
                        </div>
                        {isLoadingApprovalPreview ? <Loader2 className="text-primary h-4 w-4 animate-spin" /> : null}
                      </div>

                      {approvalEmailPreview ? (
                        <Tabs defaultValue="welcome" className="w-full">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="welcome">Employee Welcome Mail</TabsTrigger>
                            <TabsTrigger value="internal">Internal Notification</TabsTrigger>
                          </TabsList>

                          <TabsContent value="welcome">
                            <div className="border-border overflow-hidden rounded-lg border">
                              <div className="bg-muted/30 border-border border-b p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={approvalEmailPreview.welcome.enabled ? "default" : "secondary"}>
                                    {approvalEmailPreview.welcome.enabled ? "EMAIL ENABLED" : "EMAIL DISABLED"}
                                  </Badge>
                                  <span className="text-sm font-semibold">{approvalEmailPreview.welcome.subject}</span>
                                </div>
                                <div className="mt-3 space-y-2">
                                  <p className="text-muted-foreground text-[11px] font-bold uppercase">Recipients</p>
                                  <div className="flex flex-wrap gap-2">
                                    {approvalEmailPreview.welcome.recipients.length > 0 ? (
                                      approvalEmailPreview.welcome.recipients.map((email) => (
                                        <Badge key={email} variant="outline" className="font-mono text-[11px]">
                                          {email}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-muted-foreground text-sm">
                                        No recipients will receive this email.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="bg-background p-3">
                                <iframe
                                  title="Employee welcome email preview"
                                  srcDoc={approvalEmailPreview.welcome.html}
                                  className="border-border h-[480px] w-full rounded-md border bg-white"
                                />
                              </div>
                            </div>
                          </TabsContent>

                          <TabsContent value="internal">
                            <div className="border-border overflow-hidden rounded-lg border">
                              <div className="bg-muted/30 border-border border-b p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={approvalEmailPreview.internal.enabled ? "default" : "secondary"}>
                                    {approvalEmailPreview.internal.enabled ? "EMAIL ENABLED" : "EMAIL DISABLED"}
                                  </Badge>
                                  <span className="text-sm font-semibold">{approvalEmailPreview.internal.subject}</span>
                                </div>
                                <div className="mt-3 space-y-2">
                                  <p className="text-muted-foreground text-[11px] font-bold uppercase">Recipients</p>
                                  <div className="flex flex-wrap gap-2">
                                    {approvalEmailPreview.internal.recipients.length > 0 ? (
                                      approvalEmailPreview.internal.recipients.map((email) => (
                                        <Badge key={email} variant="outline" className="font-mono text-[11px]">
                                          {email}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-muted-foreground text-sm">
                                        No internal recipients will receive this email.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="bg-background p-3">
                                <iframe
                                  title="Internal onboarding email preview"
                                  srcDoc={approvalEmailPreview.internal.html}
                                  className="border-border h-[420px] w-full rounded-md border bg-white"
                                />
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <div className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                          Email preview will appear once an applicant and employee ID are available.
                        </div>
                      )}
                    </div>
                  </div>
                </ScrollArea>

                {/* Fixed Footer Actions */}
                <div className="bg-background border-border absolute right-0 bottom-0 left-0 z-10 flex justify-end gap-3 border-t p-6">
                  <Button
                    variant="outline"
                    onClick={() => setPendingReject(true)}
                    disabled={isProcessing}
                    className="h-10 px-6 font-semibold"
                  >
                    {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reject Candidate"}
                  </Button>
                  <Button
                    onClick={handleApprove}
                    disabled={isProcessing}
                    className="bg-primary h-10 px-10 font-bold shadow-sm"
                  >
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
              <div className="flex flex-1 flex-col items-center justify-center p-12 text-center opacity-30">
                <UserPlus className="mb-4 h-10 w-10" />
                <h3 className="text-sm font-medium">Select an application from the queue</h3>
              </div>
            )}
          </main>
        </div>
      </DialogContent>

      <AlertDialog
        open={Boolean(pendingEmailDispatch)}
        onOpenChange={(open) => {
          if (!open && !isSendingEmails) setPendingEmailDispatch(null)
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Mail className="text-primary h-5 w-5" />
              Send Onboarding Emails?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The employee account has been created. Select which notification emails to send:
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingEmailDispatch && (
            <div className="space-y-3 py-2">
              <label className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors">
                <Checkbox
                  className="mt-0.5"
                  checked={sendWelcomeEmail}
                  onCheckedChange={(checked) => setSendWelcomeEmail(Boolean(checked))}
                />
                <div className="space-y-0.5 text-xs">
                  <div className="text-foreground font-semibold">Welcome & Setup Email to Employee</div>
                  <div className="text-muted-foreground">
                    Sends username, temporary password, and portal setup instructions to{" "}
                    <span className="text-foreground font-mono font-medium">
                      {pendingEmailDispatch.welcome.recipients.join(", ") || "employee"}
                    </span>
                    .
                  </div>
                </div>
              </label>

              <label className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors">
                <Checkbox
                  className="mt-0.5"
                  checked={sendInternalEmail}
                  onCheckedChange={(checked) => setSendInternalEmail(Boolean(checked))}
                />
                <div className="space-y-0.5 text-xs">
                  <div className="text-foreground font-semibold">Internal Notice to Department Leads</div>
                  <div className="text-muted-foreground">
                    Broadcasts new employee announcement to{" "}
                    <span className="text-foreground font-medium">
                      {pendingEmailDispatch.internal.recipients.length} lead(s)
                    </span>
                    .
                  </div>
                </div>
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSendingEmails} onClick={() => setPendingEmailDispatch(null)}>
              Skip all
            </AlertDialogCancel>
            <Button
              loading={isSendingEmails}
              disabled={!sendWelcomeEmail && !sendInternalEmail}
              onClick={async () => {
                if (!pendingEmailDispatch) return
                setIsSendingEmails(true)
                try {
                  const res = await apiFetch("/api/admin/send-onboarding-emails", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...pendingEmailDispatch,
                      sendWelcome: sendWelcomeEmail,
                      sendInternal: sendInternalEmail,
                    }),
                  })
                  const data = await res.json()
                  if (res.ok) {
                    const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : []
                    if (warnings.length > 0) {
                      toast.warning("Emails sent with some issues", { description: warnings.join(" | ") })
                    } else {
                      toast.success(
                        sendWelcomeEmail && sendInternalEmail
                          ? "Onboarding emails sent successfully"
                          : sendWelcomeEmail
                            ? "Welcome email sent to employee"
                            : "Internal notice sent to leads"
                      )
                    }
                  } else {
                    toast.error(data.error || "Failed to send onboarding emails")
                  }
                } catch {
                  toast.error("Failed to send onboarding emails")
                } finally {
                  setIsSendingEmails(false)
                  setPendingEmailDispatch(null)
                }
              }}
            >
              {sendWelcomeEmail && sendInternalEmail
                ? "Send both emails"
                : sendWelcomeEmail
                  ? "Send welcome email"
                  : sendInternalEmail
                    ? "Send lead notice"
                    : "None selected"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PromptDialog
        open={pendingReject}
        onOpenChange={(open) => !open && setPendingReject(false)}
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
    </Dialog>
  )
}
