"use client"

import { useMemo, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Clock, History, CalendarCheck2, CheckCircle2, AlertCircle, Eye, Check, X, FileText } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import { formatName } from "@/lib/utils"

interface LeaveItem {
  id: string
  user_id: string
  start_date: string
  end_date: string
  resume_date: string
  days_count: number
  reason: string
  status: string
  approval_stage: string
  current_stage_code?: string
  current_stage_order?: number
  current_approver_user_id?: string
  reliever_id?: string | null
  supervisor_id?: string | null
  created_at: string
  user?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name: string
    company_email: string
    department?: string
  }
  reliever?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  supervisor?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  approved_by_profile?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  leave_type?: { name: string }
  current_approver?: { id: string; full_name: string; company_email: string; role?: string | null } | null
  approvals?: Array<{
    id: string
    approver_id?: string | null
    approval_level?: number | null
    status?: string | null
    comments?: string | null
    approved_at?: string | null
    stage_code?: string | null
    stage_order?: number | null
    approver?: {
      id?: string
      full_name?: string | null
      first_name?: string | null
      last_name?: string | null
      company_email?: string | null
    } | null
  }>
  evidence?: Array<{
    id: string
    document_type: string
    file_url: string
    status: "pending" | "verified" | "rejected"
    notes?: string | null
  }>
  required_documents?: string[]
  missing_documents?: string[]
  evidence_complete?: boolean
}

interface LeaveActionHistoryItem {
  id: string
  leave_request_id: string
  status?: string | null
  comments?: string | null
  approved_at?: string | null
  stage_code?: string | null
  request?: LeaveItem | null
}

type PersonNameRef = {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  company_email?: string | null
}

const STAGE_LABELS: Record<string, string> = {
  pending_reliever: "Waiting Reliever",
  pending_department_lead: "Waiting Department Lead",
  pending_admin_hr_lead: "Waiting Admin & HR Lead",
  pending_md: "Waiting MD",
  pending_hcs: "Waiting HCS",
  reliever_pending: "Waiting Reliever",
  supervisor_pending: "Waiting Department Lead",
  hr_pending: "Waiting Admin & HR Lead",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
}

interface ActionDialogState {
  open: boolean
  id: string
  action: "approve" | "reject"
  missingDocuments: string[]
}

const TABS: DataTableTab[] = [
  { key: "my-actions", label: "My Actions", icon: AlertCircle },
  { key: "pending", label: "Global Queue", icon: Clock },
  { key: "history", label: "History", icon: History },
]

async function fetchLeaveApprovalData(): Promise<{
  myQueue: LeaveItem[]
  allPendingQueue: LeaveItem[]
  history: LeaveItem[]
  reviewHistory: LeaveActionHistoryItem[]
}> {
  const myQueueRes = await fetch("/api/hr/leave/queue")
  if (!myQueueRes.ok) throw new Error("Failed to load leave queue")
  const myQueuePayload = await myQueueRes.json()

  let allQueuePayload: { data?: LeaveItem[] } = { data: [] }
  let requestPayload: { data?: LeaveItem[] } = { data: [] }
  const [allQueueRes, requestsRes] = await Promise.allSettled([
    fetch("/api/hr/leave/queue?all=true"),
    fetch("/api/hr/leave/requests?all=true&limit=200"),
  ])
  if (allQueueRes.status === "fulfilled" && allQueueRes.value.ok) {
    allQueuePayload = await allQueueRes.value.json()
  }
  if (requestsRes.status === "fulfilled" && requestsRes.value.ok) {
    requestPayload = await requestsRes.value.json()
  }

  const allRequests = (requestPayload.data || []) as LeaveItem[]
  return {
    myQueue: myQueuePayload.data || [],
    allPendingQueue: allQueuePayload.data || [],
    history: allRequests.filter(
      (item) => !["pending", "pending_evidence"].includes(String(item.status || "").toLowerCase())
    ),
    reviewHistory: myQueuePayload.history || [],
  }
}

export default function LeaveApprovePage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState("my-actions")
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({
    open: false,
    id: "",
    action: "reject",
    missingDocuments: [],
  })
  const overrideEvidenceRef = useRef(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.leaveRequests({ scope: "approve" }),
    queryFn: fetchLeaveApprovalData,
  })

  const { mutateAsync: submitActionMutateAsync } = useMutation({
    mutationFn: async ({
      id,
      action,
      comments,
      overrideEvidence,
    }: {
      id: string
      action: "approve" | "reject"
      comments: string
      overrideEvidence: boolean
    }) => {
      const response = await fetch("/api/hr/leave/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leave_request_id: id, action, comments, override_evidence: overrideEvidence }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to process action")
      return payload
    },
    onSuccess: (payload) => {
      toast.success(payload.message || "Action completed")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.leaveRequests({ scope: "approve" }) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.leaveRequests() })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to process action")
    },
  })

  const handleAction = (id: string, action: "approve" | "reject") => {
    const list =
      activeTab === "history" ? data?.history : activeTab === "pending" ? data?.allPendingQueue : data?.myQueue
    const target = list?.find((item) => item.id === id)
    const needsOverride = action === "approve" && target && target.evidence_complete === false

    overrideEvidenceRef.current = needsOverride ?? false
    setActionDialog({
      open: true,
      id,
      action,
      missingDocuments: needsOverride ? target?.missing_documents || [] : [],
    })
  }

  function expectedApproverLabel(item: LeaveItem) {
    if (item.current_approver?.full_name) return item.current_approver.full_name
    const stage = item.current_stage_code || item.approval_stage
    const expectedByStage: Record<string, string> = {
      pending_reliever: "Assigned Reliever",
      reliever_pending: "Assigned Reliever",
      pending_department_lead: "Department Lead",
      supervisor_pending: "Department Lead",
      pending_admin_hr_lead: "Admin & HR Lead",
      hr_pending: "Admin & HR Lead",
      pending_md: "Managing Director (MD)",
      pending_hcs: "Head, Corporate Services (HCS)",
    }
    return expectedByStage[stage] || "Pending approver"
  }

  function approvalStageKey(code?: string | null) {
    const value = String(code || "").toLowerCase()
    if (value.includes("reliever")) return "reliever"
    if (value.includes("department_lead")) return "department_lead"
    if (value.includes("admin_hr_lead")) return "admin_hr_lead"
    if (value.includes("hcs")) return "hcs"
    if (value.includes("md")) return "md"
    return value || "unknown"
  }

  function approvalStageLabel(code?: string | null) {
    const value = String(code || "").toLowerCase()
    if (value.includes("reliever")) return "Reliever"
    if (value.includes("department_lead")) return "Department Lead"
    if (value.includes("admin_hr_lead")) return "Admin & HR Lead"
    if (value.includes("hcs")) return "HCS"
    if (value.includes("md")) return "MD"
    return formatName(code || "Stage")
  }

  function resolvePersonName(person?: PersonNameRef | null) {
    if (!person) return ""
    const full = String(person.full_name || "").trim()
    if (full) return full
    const composed = `${person.first_name || ""} ${person.last_name || ""}`.trim()
    if (composed) return composed
    const email = String(person.company_email || "").trim()
    if (email) return email.split("@")[0] || email
    return ""
  }

  const columns: DataTableColumn<LeaveItem>[] = useMemo(
    () => [
      {
        key: "employee",
        label: "Employee",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => r.user?.full_name || "Employee",
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-medium">{r.user?.full_name || "Employee"}</span>
            <span className="text-muted-foreground text-xs">{r.user?.company_email}</span>
          </div>
        ),
      },
      {
        key: "leave_type",
        label: "Leave Type",
        sortable: true,
        resizable: true,
        initialWidth: 150,
        accessor: (r) => r.leave_type?.name || "Leave Request",
      },
      {
        key: "period",
        label: "Period",
        accessor: (r) => `${r.start_date} to ${r.end_date}`,
        render: (r) => (
          <div className="flex flex-col text-xs">
            <span>
              {r.start_date} to {r.end_date}
            </span>
            <span className="text-muted-foreground">{r.days_count} day(s)</span>
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.user?.department || "-",
      },
      {
        key: "stage",
        label: "Current Stage",
        accessor: (r) =>
          STAGE_LABELS[r.current_stage_code || r.approval_stage] || r.current_stage_code || r.approval_stage,
        render: (r) => (
          <Badge variant="outline">
            {STAGE_LABELS[r.current_stage_code || r.approval_stage] || r.current_stage_code || r.approval_stage}
          </Badge>
        ),
      },
      {
        key: "approver",
        label: "Pending Approver",
        accessor: (r) => expectedApproverLabel(r),
        render: (r) => <span className="text-sm">{expectedApproverLabel(r)}</span>,
      },
      {
        key: "evidence",
        label: "Evidence",
        accessor: (r) => (r.evidence_complete ? "Complete" : "Incomplete"),
        render: (r) => (
          <Badge variant={r.evidence_complete ? "default" : "secondary"}>
            {r.evidence_complete ? "Complete" : "Incomplete"}
          </Badge>
        ),
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.status,
        render: (r) => (
          <Badge
            variant={
              r.status === "approved" || r.status === "completed"
                ? "default"
                : r.status === "rejected" || r.status === "cancelled"
                  ? "destructive"
                  : "secondary"
            }
          >
            {r.status}
          </Badge>
        ),
        hidden: activeTab !== "history",
      },
    ],
    [activeTab]
  )

  const activeData = useMemo(() => {
    if (!data) return []
    if (activeTab === "my-actions") return data.myQueue
    if (activeTab === "pending") return data.allPendingQueue
    return data.history
  }, [data, activeTab])

  const filters = useMemo(() => {
    const allData = [...(data?.myQueue || []), ...(data?.allPendingQueue || []), ...(data?.history || [])]
    const statuses = Array.from(
      new Set(
        [...allData.map((x) => x.status), "pending", "pending_evidence", "approved", "rejected", "cancelled"].filter(
          Boolean
        )
      )
    )
    const leaveTypes = Array.from(new Set(allData.map((x) => x.leave_type?.name).filter(Boolean)))
    const departments = Array.from(new Set(allData.map((x) => x.user?.department).filter(Boolean)))

    return [
      {
        key: "leave_type",
        label: "Leave Type",
        options: leaveTypes.map((lt) => ({ value: lt as string, label: lt as string })),
        mode: "custom",
        filterFn: (row: LeaveItem, vals: string[]) => !row.leave_type?.name || vals.includes(row.leave_type.name),
        hidden: leaveTypes.length === 0,
      },
      {
        key: "department",
        label: "Department",
        options: departments.map((d) => ({ value: d as string, label: d as string })),
        mode: "custom",
        filterFn: (row: LeaveItem, vals: string[]) => !row.user?.department || vals.includes(row.user.department),
        hidden: departments.length === 0,
      },
      {
        key: "status",
        label: "Status",
        options: statuses.map((s) => ({ value: s as string, label: formatName(s as string) })),
        mode: "custom",
        filterFn: (row: LeaveItem, vals: string[]) => !row.status || vals.includes(row.status),
      },
    ] as DataTableFilter<LeaveItem>[]
  }, [data])

  const stats = useMemo(
    () => ({
      allPending: data?.allPendingQueue.length || 0,
      myActions: data?.myQueue.length || 0,
      historyTotal: data?.history.length || 0,
    }),
    [data]
  )

  const isOverride = actionDialog.missingDocuments.length > 0

  return (
    <>
      <PromptDialog
        open={actionDialog.open}
        onOpenChange={(open) => setActionDialog((s) => ({ ...s, open }))}
        title={
          actionDialog.action === "approve"
            ? isOverride
              ? "Override Incomplete Evidence"
              : "Approval Feedback"
            : "Rejection Reason"
        }
        description={
          actionDialog.action === "approve"
            ? isOverride
              ? `Evidence is incomplete (${actionDialog.missingDocuments.join(", ")}). Provide an override reason to proceed with approval.`
              : "Please provide approval feedback before endorsing this leave request."
            : "Please provide a reason for rejecting this leave request."
        }
        label={
          actionDialog.action === "approve"
            ? isOverride
              ? "Override reason"
              : "Approval feedback"
            : "Rejection reason"
        }
        placeholder={
          actionDialog.action === "approve"
            ? isOverride
              ? "Explain why evidence requirement is being waived…"
              : "Enter approval feedback…"
            : "Enter rejection reason…"
        }
        inputType="textarea"
        required
        confirmLabel={
          actionDialog.action === "approve" ? (isOverride ? "Approve with Override" : "Endorse Request") : "Reject"
        }
        confirmLoadingLabel={
          actionDialog.action === "approve" ? (isOverride ? "Approving..." : "Endorsing...") : "Rejecting..."
        }
        confirmVariant={actionDialog.action === "reject" ? "destructive" : "default"}
        onConfirm={async (value) => {
          await submitActionMutateAsync({
            id: actionDialog.id,
            action: actionDialog.action,
            comments: value,
            overrideEvidence: overrideEvidenceRef.current,
          })
        }}
      />

      <DataTablePage
        title="Leave Approvals"
        description="Review and manage leave requests, endorsements, and workflow history."
        icon={CalendarCheck2}
        backLink={{ href: "/admin/hr", label: "Back to HR" }}
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        stats={
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              title="Global Pending"
              value={stats.allPending}
              icon={Clock}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="My Actions"
              value={stats.myActions}
              icon={AlertCircle}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="History"
              value={stats.historyTotal}
              icon={CheckCircle2}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
          </div>
        }
      >
        <DataTable<LeaveItem>
          data={activeData}
          columns={columns}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : null}
          onRetry={refetch}
          searchPlaceholder="Search employee name or leave type..."
          searchFn={(r, q) => `${r.user?.full_name} ${r.leave_type?.name} ${r.status}`.toLowerCase().includes(q)}
          filters={filters}
          rowActions={
            activeTab === "my-actions"
              ? [
                  {
                    label: "Endorse",
                    icon: Check,
                    onClick: (r) => handleAction(r.id, "approve"),
                  },
                  {
                    label: "Reject",
                    icon: X,
                    variant: "destructive",
                    onClick: (r) => handleAction(r.id, "reject"),
                  },
                ]
              : [
                  {
                    label: "View Detail",
                    icon: Eye,
                    onClick: () => {}, // Handled by expansion
                  },
                ]
          }
          expandable={{
            render: (r) => {
              const timeline = [...(r.approvals || [])].sort((left, right) => {
                const leftOrder = Number(left.stage_order || left.approval_level || 999)
                const rightOrder = Number(right.stage_order || right.approval_level || 999)
                if (leftOrder !== rightOrder) return leftOrder - rightOrder
                return String(left.approved_at || "").localeCompare(String(right.approved_at || ""))
              })

              const stageAuditMap = new Map<string, (typeof timeline)[number]>()
              for (const item of timeline) {
                const key = approvalStageKey(item.stage_code)
                const existing = stageAuditMap.get(key)
                if (!existing) {
                  stageAuditMap.set(key, item)
                  continue
                }

                const existingTime = existing.approved_at ? new Date(existing.approved_at).getTime() : 0
                const nextTime = item.approved_at ? new Date(item.approved_at).getTime() : 0
                if (nextTime >= existingTime) {
                  stageAuditMap.set(key, item)
                }
              }

              const stageOrder = ["reliever", "department_lead", "admin_hr_lead", "hcs", "md"]
              const stageName: Record<string, string> = {
                reliever: "Reliever",
                department_lead: "Department Lead",
                admin_hr_lead: "Admin & HR Lead",
                hcs: "HCS",
                md: "MD",
              }
              const currentStageKey = approvalStageKey(r.current_stage_code || r.approval_stage)
              const hasRelieverAssignee = Boolean(r.reliever?.id || r.reliever_id)
              const relieverHandledByLead =
                Boolean(r.reliever?.id || r.reliever_id) &&
                Boolean(r.supervisor?.id || r.supervisor_id) &&
                (r.reliever?.id || r.reliever_id) === (r.supervisor?.id || r.supervisor_id) &&
                Boolean(stageAuditMap.get("department_lead"))
              const departmentLeadApproverName = resolvePersonName(stageAuditMap.get("department_lead")?.approver)
              const advancedPastReliever = ["department_lead", "admin_hr_lead", "hcs", "md"].includes(currentStageKey)

              return (
                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <div className="space-y-3 text-sm">
                    <p>
                      <span className="text-muted-foreground">Reliever:</span>{" "}
                      <span className="font-medium">{resolvePersonName(r.reliever) || "Not assigned"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Current Stage:</span>{" "}
                      <span className="font-medium">
                        {approvalStageLabel(r.current_stage_code || r.approval_stage)}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Reason:</span>{" "}
                      <span className="font-medium">{r.reason || "-"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Resume Date:</span>{" "}
                      <span className="font-medium">{r.resume_date || "-"}</span>
                    </p>
                    {r.required_documents && r.required_documents.length > 0 ? (
                      <p>
                        <span className="text-muted-foreground">Required Docs:</span>{" "}
                        <span className="font-medium">{r.required_documents.join(", ")}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">Approval Timeline</p>
                    {stageAuditMap.size === 0 ? (
                      <p className="text-muted-foreground text-xs">No approvals recorded yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {stageOrder.map((stageKey) => {
                          const item = stageAuditMap.get(stageKey)
                          const stageActorName =
                            resolvePersonName(item?.approver) ||
                            (stageKey === "reliever"
                              ? resolvePersonName(r.reliever) || null
                              : stageKey === "department_lead"
                                ? resolvePersonName(r.supervisor) || null
                                : stageKey === "admin_hr_lead"
                                  ? resolvePersonName(r.approved_by_profile) || null
                                  : null)
                          return (
                            <li key={stageKey} className="text-xs">
                              <span className="font-medium">{stageName[stageKey]}:</span>{" "}
                              {item ? (
                                <>
                                  <span className="capitalize">{item.status}</span>
                                  {stageActorName ? ` by ${stageActorName}` : ""}
                                  {stageActorName ? ` (${stageName[stageKey]})` : ""}
                                  {item.approved_at ? ` at ${new Date(item.approved_at).toLocaleString()}` : ""}
                                </>
                              ) : stageKey === "reliever" && !hasRelieverAssignee ? (
                                <span className="text-muted-foreground">Not required for this request</span>
                              ) : stageKey === "reliever" && relieverHandledByLead ? (
                                <span className="text-muted-foreground">
                                  {departmentLeadApproverName
                                    ? `Handled by ${departmentLeadApproverName} (Department Lead)`
                                    : "Handled by Department Lead stage"}
                                </span>
                              ) : stageKey === "reliever" && advancedPastReliever && currentStageKey !== "reliever" ? (
                                <span className="text-muted-foreground">Skipped by route rules</span>
                              ) : (
                                <span className="text-muted-foreground">Pending / not acted</span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    <div className="space-y-2 pt-1">
                      <p className="text-muted-foreground text-xs">Evidence & Attachments</p>
                      {r.evidence && r.evidence.length > 0 ? (
                        r.evidence.map((doc) => (
                          <div
                            key={doc.id}
                            className="bg-muted/20 flex items-center justify-between rounded-md border p-2"
                          >
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{doc.document_type}</span>
                              <Badge variant="outline" className="mt-1 w-fit text-[10px]">
                                {doc.status}
                              </Badge>
                            </div>
                            <Button variant="ghost" size="sm" asChild>
                              <a href={doc.file_url} target="_blank" rel="noreferrer">
                                View File
                              </a>
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground rounded-md border border-dashed p-2 text-xs italic">
                          No evidence uploaded yet.
                        </p>
                      )}
                    </div>
                  </div>

                  {activeTab === "my-actions" && (
                    <div className="flex gap-2 border-t pt-3 md:col-span-2">
                      <Button onClick={() => handleAction(r.id, "approve")} className="gap-2">
                        <Check className="h-4 w-4" /> Endorse
                      </Button>
                      <Button variant="destructive" onClick={() => handleAction(r.id, "reject")} className="gap-2">
                        <X className="h-4 w-4" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              )
            },
          }}
          viewToggle
          cardRenderer={(r) => (
            <div className="bg-card space-y-4 rounded-xl border p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-semibold">{r.user?.full_name}</h4>
                  <p className="text-muted-foreground text-xs">{r.leave_type?.name}</p>
                </div>
                <Badge variant={r.status === "approved" || r.status === "completed" ? "default" : "secondary"}>
                  {r.status}
                </Badge>
              </div>

              <div className="text-muted-foreground space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {r.start_date} to {r.end_date} ({r.days_count} days)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {STAGE_LABELS[r.current_stage_code || r.approval_stage] || r.current_stage_code}
                  </Badge>
                </div>
              </div>

              {activeTab === "my-actions" && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="flex-1" onClick={() => handleAction(r.id, "approve")}>
                    Endorse
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => handleAction(r.id, "reject")}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          )}
          urlSync
        />

        <div className="mt-4 rounded-lg border p-4">
          <p className="text-sm font-semibold">Recent Review History</p>
          <p className="text-muted-foreground mb-3 text-xs">
            Latest acceptance and rejection decisions by your account.
          </p>
          {!data?.reviewHistory || data.reviewHistory.length === 0 ? (
            <p className="text-muted-foreground text-xs">No review activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.reviewHistory.slice(0, 10).map((entry) => (
                <li key={entry.id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={entry.status === "rejected" ? "destructive" : "outline"} className="capitalize">
                      {entry.status || "recorded"}
                    </Badge>
                    <span className="font-medium">{formatName(entry.stage_code || "approval_stage")}</span>
                    <span className="text-muted-foreground">{entry.request?.user?.full_name || "Employee"}</span>
                    <span className="text-muted-foreground">
                      {entry.approved_at ? new Date(entry.approved_at).toLocaleString() : ""}
                    </span>
                  </div>
                  {entry.comments ? <p className="mt-1 text-xs">{entry.comments}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DataTablePage>
    </>
  )
}
