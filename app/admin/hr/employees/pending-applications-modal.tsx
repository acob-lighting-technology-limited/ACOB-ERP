"use client"

import { useCallback, useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, CheckCircle, UserPlus, ChevronRight, ShieldCheck, Hash } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { format } from "date-fns"
import { cn, formatName } from "@/lib/utils"
import { QUERY_KEYS } from "@/lib/query-keys"

import { logger } from "@/lib/logger"

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

interface ApprovalEmailWarning {
  audience: "employee" | "management"
  reason: string
  recipients: string[]
}

async function fetchPendingApplications(): Promise<PendingUser[]> {
  const response = await fetch("/api/admin/pending-users", { cache: "no-store" })
  const payload = (await response.json().catch(() => null)) as { data?: PendingUser[]; error?: string } | null
  if (!response.ok) throw new Error(payload?.error || "Failed to load applications")
  return payload?.data || []
}

export function PendingApplicationsModal({ onEmployeeCreated }: PendingApplicationsModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingReject, setPendingReject] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [hireDate, setHireDate] = useState(new Date().toISOString().split("T")[0])

  const [supabase] = useState(() => createClient())
  const queryClient = useQueryClient()

  const { data: pendingUsers = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.pendingApplications(),
    queryFn: fetchPendingApplications,
    enabled: isOpen,
  })

  const { data: approvalEmailPreview, isLoading: isLoadingApprovalPreview } = useQuery<ApprovalEmailPreview>({
    queryKey: ["pending-approval-email-preview", selectedUser?.id, employeeId],
    queryFn: async () => {
      if (!selectedUser?.id || !employeeId) {
        throw new Error("Missing approval preview context")
      }

      const response = await fetch(
        `/api/admin/pending-users/${selectedUser.id}/approval-preview?employeeId=${encodeURIComponent(employeeId)}`
      )
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to load approval email preview")
      }

      return result as ApprovalEmailPreview
    },
    enabled: isOpen && !!selectedUser?.id && !!employeeId,
  })

  const fetchSuggestedId = useCallback(async () => {
    try {
      const { data: lastProfile } = await supabase
        .from("profiles")
        .select("employee_number")
        .not("employee_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      let nextIdNumber = 1
      const currentYear = new Date().getFullYear()

      if (lastProfile && lastProfile.employee_number) {
        const parts = lastProfile.employee_number.split("/")
        if (parts.length === 3) {
          const lastNum = parseInt(parts[2], 10)
          if (!isNaN(lastNum)) {
            nextIdNumber = lastNum + 1
          }
        }
      }
      setEmployeeId(`ACOB/${currentYear}/${nextIdNumber.toString().padStart(3, "0")}`)
    } catch (err) {
      log.error("Error suggesting ID:", err)
      setEmployeeId(`ACOB/${new Date().getFullYear()}/001`)
    }
  }, [supabase])

  const handleUserSelect = useCallback(
    (user: PendingUser) => {
      setSelectedUser(user)
      void fetchSuggestedId()
    },
    [fetchSuggestedId]
  )

  // Auto-select first user when data loads
  useEffect(() => {
    if (pendingUsers.length > 0 && !selectedUser) {
      handleUserSelect(pendingUsers[0])
    }
  }, [pendingUsers, selectedUser, handleUserSelect])

  const handleApprove = async () => {
    if (!selectedUser) return

    // Validate ID format before sending
    const empNumPattern = /^ACOB\/[0-9]{4}\/[0-9]{3}$/
    if (employeeId && !empNumPattern.test(employeeId)) {
      toast.error("Employee ID MUST be in format: ACOB/YEAR/NUMBER (e.g., ACOB/2026/001)")
      return
    }

    setIsProcessing(true)

    try {
      const response = await fetch("/api/admin/approve-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingUserId: selectedUser.id,
          employeeId: employeeId,
          hireDate: hireDate,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to approve user")
      }

      const emailWarnings = Array.isArray(result.emailWarnings) ? (result.emailWarnings as ApprovalEmailWarning[]) : []

      if (emailWarnings.length > 0) {
        toast.warning("User approved, but some emails were not sent", {
          description: emailWarnings.map((warning) => `${warning.audience}: ${warning.reason}`).join(" | "),
        })
      } else {
        toast.success("User approved and account created successfully")
      }

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.pendingApplications() })
      const remaining = pendingUsers.filter((u) => u.id !== selectedUser.id)
      if (remaining.length > 0) {
        handleUserSelect(remaining[0])
      } else {
        setSelectedUser(null)
        setEmployeeId("")
      }
      onEmployeeCreated()
    } catch (error: unknown) {
      log.error("Approval error:", error)
      toast.error(error instanceof Error ? error.message : "Failed to approve user")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!selectedUser) return

    setIsProcessing(true)
    try {
      const response = await fetch("/api/admin/reject-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingUserId: selectedUser.id }),
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
        setEmployeeId("")
      }
    } catch (error: unknown) {
      log.error("Rejection error:", error)
      toast.error("Failed to reject application")
    } finally {
      setIsProcessing(false)
    }
  }

  const DetailRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="border-border hover:bg-muted/50 grid grid-cols-4 border-b transition-colors">
      <div className="border-border bg-muted/40 flex items-center border-r p-3">
        <span className="text-muted-foreground text-xs font-bold uppercase">{label}</span>
      </div>
      <div className="bg-background col-span-3 flex items-center p-3">
        <span className="text-foreground text-sm font-medium">{value || "—"}</span>
      </div>
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
                        <div className="flex flex-col items-end">
                          <span className="text-muted-foreground mb-1 text-[10px] font-bold uppercase">Assign ID</span>
                          <div className="relative w-44">
                            <Hash className="text-primary absolute top-2.5 left-2.5 h-3.5 w-3.5" />
                            <Input
                              value={employeeId}
                              onChange={(e) => setEmployeeId(e.target.value)}
                              className="bg-primary/5 border-primary/20 focus-visible:ring-primary h-9 pl-8 font-mono text-xs font-bold"
                              placeholder="ACOB/2026/001"
                            />
                          </div>
                        </div>
                        <Badge variant="outline" className="mb-1 self-end py-0.5 text-[10px] font-bold">
                          PENDING APPROVAL
                        </Badge>
                      </div>
                    </div>

                    {/* Table Grid with full borders */}
                    <div className="border-border overflow-hidden rounded-lg border shadow-sm">
                      <DetailRow label="First Name" value={formatName(selectedUser.first_name)} />
                      <DetailRow label="Last Name" value={formatName(selectedUser.last_name)} />
                      <DetailRow label="Other Names" value={formatName(selectedUser.other_names)} />
                      <div className="border-border grid grid-cols-1 border-b">
                        <div className="bg-muted/20 text-muted-foreground border-border border-b p-2 text-[10px] font-bold uppercase">
                          Organizational Data
                        </div>
                        <div className="grid grid-cols-1">
                          <DetailRow label="Department" value={selectedUser.department} />
                          <DetailRow label="Designation" value={selectedUser.designation} />
                          <DetailRow label="System Email" value={selectedUser.company_email} />
                          <DetailRow label="Assigned ID" value={employeeId} />
                          <DetailRow label="Office Location" value={selectedUser.office_location || "N/A"} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1">
                        <div className="bg-muted/20 text-muted-foreground border-border border-b p-2 text-[10px] font-bold uppercase">
                          Personal & Contact
                        </div>
                        <div className="grid grid-cols-1">
                          <DetailRow label="Phone Number" value={selectedUser.phone_number} />
                          <DetailRow label="Personal Email" value={selectedUser.personal_email} />
                          <DetailRow label="Address" value={selectedUser.residential_address} />
                          <DetailRow
                            label="Application Date"
                            value={format(new Date(selectedUser.created_at), "PPPP")}
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

      <AlertDialog open={pendingReject} onOpenChange={(open) => !open && setPendingReject(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Application</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject this application? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setPendingReject(false)
                handleReject()
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
