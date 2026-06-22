"use client"

import { useMemo, useRef, useState, useEffect } from "react"
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
import { LeaveDetailDialog } from "./_components/leave-detail-dialog"
import { createClient } from "@/lib/supabase/client"
import { formatName } from "@/lib/utils"
import { formatWATDateTime } from "@/lib/utils/date"

export interface LeaveItem {
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
  admin_manual?: boolean | null
  approved_at?: string | null
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

export interface LeaveActionHistoryItem {
  id: string
  leave_request_id: string
  status?: string | null
  comments?: string | null
  approved_at?: string | null
  stage_code?: string | null
  request?: LeaveItem | null
}

export type PersonNameRef = {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  company_email?: string | null
}

export const STAGE_LABELS: Record<string, string> = {
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

export function expectedApproverLabel(item: LeaveItem) {
  const status = String(item.status || "").toLowerCase()
  if (["approved", "completed", "rejected", "cancelled"].includes(status)) {
    return "-"
  }
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

export function getStageBadge(item: LeaveItem) {
  const rawStage = item.current_stage_code || item.approval_stage || ""
  const stage = rawStage.toLowerCase()
  const label = STAGE_LABELS[rawStage] || rawStage

  let colorClass = "bg-muted/10 text-muted-foreground border-muted-foreground/20"
  if (stage.includes("reliever")) {
    colorClass = "bg-purple-500/10 text-purple-500 border-purple-500/20"
  } else if (stage.includes("department_lead") || stage.includes("supervisor")) {
    colorClass = "bg-amber-500/10 text-amber-500 border-amber-500/20"
  } else if (stage.includes("admin_hr_lead") || stage.includes("hr_pending")) {
    colorClass = "bg-blue-500/10 text-blue-500 border-blue-500/20"
  } else if (stage.includes("md")) {
    colorClass = "bg-rose-500/10 text-rose-500 border-rose-500/20"
  } else if (stage.includes("hcs")) {
    colorClass = "bg-violet-500/10 text-violet-500 border-violet-500/20"
  } else if (stage === "completed" || stage === "approved") {
    colorClass = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
  } else if (stage === "rejected") {
    colorClass = "bg-red-500/10 text-red-500 border-red-500/20"
  } else if (stage === "cancelled") {
    colorClass = "bg-muted/10 text-muted-foreground border-muted-foreground/20"
  }

  return (
    <Badge variant="outline" className={colorClass}>
      {label}
    </Badge>
  )
}

export function approvalStageKey(code?: string | null) {
  const value = String(code || "").toLowerCase()
  if (value.includes("reliever")) return "reliever"
  if (value.includes("department_lead")) return "department_lead"
  if (value.includes("admin_hr_lead")) return "admin_hr_lead"
  if (value.includes("hcs")) return "hcs"
  if (value.includes("md")) return "md"
  return value || "unknown"
}

export function approvalStageLabel(code?: string | null) {
  const value = String(code || "").toLowerCase()
  if (value.includes("reliever")) return "Reliever"
  if (value.includes("department_lead")) return "Department Lead"
  if (value.includes("admin_hr_lead")) return "Admin & HR Lead"
  if (value.includes("hcs")) return "HCS"
  if (value.includes("md")) return "MD"
  return formatName(code || "Stage")
}

export function resolvePersonName(person?: PersonNameRef | null) {
  if (!person) return ""
  const full = String(person.full_name || "").trim()
  if (full) return full
  const composed = `${person.first_name || ""} ${person.last_name || ""}`.trim()
  if (composed) return composed
  const email = String(person.company_email || "").trim()
  if (email) return email.split("@")[0] || email
  return ""
}

interface ActionDialogState {
  open: boolean
  id: string
  action: "approve" | "reject"
  missingDocuments: string[]
}

async function fetchLeaveApprovalData(apiBasePath: string): Promise<{
  myQueue: LeaveItem[]
  allPendingQueue: LeaveItem[]
  history: LeaveItem[]
  allRequests: LeaveItem[]
  reviewHistory: LeaveActionHistoryItem[]
}> {
  const myQueueRes = await fetch(`${apiBasePath}/queue`)
  if (!myQueueRes.ok) throw new Error("Failed to load leave queue")
  const myQueuePayload = await myQueueRes.json()

  let allQueuePayload: { data?: LeaveItem[] } = { data: [] }
  let requestPayload: { data?: LeaveItem[] } = { data: [] }
  const [allQueueRes, requestsRes] = await Promise.allSettled([
    fetch(`${apiBasePath}/queue?all=true`),
    fetch(`${apiBasePath}/requests?all=true&limit=100`),
  ])
  if (allQueueRes.status === "rejected") {
    throw new Error(`Queue fetch rejected: ${allQueueRes.reason}`)
  }
  if (!allQueueRes.value.ok) {
    const errorBody = await allQueueRes.value.json().catch(() => ({ error: "Unknown error" }))
    throw new Error(
      `Queue fetch failed (${allQueueRes.value.status}): ${errorBody.error || allQueueRes.value.statusText}`
    )
  }
  allQueuePayload = await allQueueRes.value.json()

  if (requestsRes.status === "rejected") {
    throw new Error(`Requests fetch rejected: ${requestsRes.reason}`)
  }
  if (!requestsRes.value.ok) {
    const errorBody = await requestsRes.value.json().catch(() => ({ error: "Unknown error" }))
    throw new Error(
      `Requests fetch failed (${requestsRes.value.status}): ${errorBody.error || requestsRes.value.statusText}`
    )
  }
  requestPayload = await requestsRes.value.json()

  const allRequests = (requestPayload.data || []) as LeaveItem[]
  return {
    myQueue: myQueuePayload.data || [],
    allPendingQueue: allQueuePayload.data || [],
    history: allRequests.filter(
      (item) => !["pending", "pending_evidence"].includes(String(item.status || "").toLowerCase())
    ),
    allRequests: allRequests,
    reviewHistory: myQueuePayload.history || [],
  }
}

export function LeaveApprovePage({
  backLinkHref,
  apiBasePath = "/api/hr/leave",
}: { backLinkHref?: string; apiBasePath?: string } = {}) {
  const normalizedApiBasePath = apiBasePath.replace(/\/$/, "")
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState("all")
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({
    open: false,
    id: "",
    action: "reject",
    missingDocuments: [],
  })
  const overrideEvidenceRef = useRef(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedLeaveDetail, setSelectedLeaveDetail] = useState<LeaveItem | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id)
      }
    })
  }, [])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.leaveRequests({ scope: "approve", apiBasePath: normalizedApiBasePath }),
    queryFn: () => fetchLeaveApprovalData(normalizedApiBasePath),
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
      const response = await fetch(`${normalizedApiBasePath}/approve`, {
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
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.leaveRequests({ scope: "approve", apiBasePath: normalizedApiBasePath }),
      })
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
        hideOnMobile: true,
      },
      {
        key: "stage",
        label: "Current Stage",
        accessor: (r) =>
          STAGE_LABELS[r.current_stage_code || r.approval_stage] || r.current_stage_code || r.approval_stage,
        hideOnMobile: true,
        render: (r) => getStageBadge(r),
      },
      {
        key: "approver",
        label: "Pending Approver",
        accessor: (r) => expectedApproverLabel(r),
        hideOnMobile: true,
        render: (r) => <span className="text-sm">{expectedApproverLabel(r)}</span>,
      },
    ],
    []
  )

  const dynamicTabs = useMemo(() => {
    const myCount = data?.myQueue.length ?? 0
    const globalCount = data?.allPendingQueue.length ?? 0
    const historyCount = data?.history.length ?? 0
    const allCount = data?.allRequests.length ?? 0

    return [
      { key: "all", label: `All (${allCount})`, icon: CalendarCheck2 },
      { key: "my-actions", label: `My Actions (${myCount})`, icon: AlertCircle },
      { key: "pending", label: `Global Queue (${globalCount})`, icon: Clock },
      { key: "history", label: `History (${historyCount})`, icon: History },
    ]
  }, [data])

  const activeData = useMemo(() => {
    if (!data) return []
    if (activeTab === "my-actions") return data.myQueue
    if (activeTab === "pending") return data.allPendingQueue
    if (activeTab === "history") return data.history
    return data.allRequests
  }, [data, activeTab])

  const filters = useMemo(() => {
    const allData = data?.allRequests || []
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
      {
        key: "reviewer",
        label: "My Decisions",
        options: [{ value: "acted_by_me", label: "Acted by me" }],
        mode: "custom",
        filterFn: (row: LeaveItem, vals: string[]) => {
          if (!currentUserId || !vals.includes("acted_by_me")) return true
          const isApprover =
            row.approvals?.some((app) => app.approver_id === currentUserId || app.approver?.id === currentUserId) ??
            false
          const isManualBypasser = !!(row.admin_manual && row.approved_by_profile?.id === currentUserId)
          return isApprover || isManualBypasser
        },
      },
    ] as DataTableFilter<LeaveItem>[]
  }, [data, currentUserId])

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

      <LeaveDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        leave={selectedLeaveDetail}
        onApprove={(id) => handleAction(id, "approve")}
        onReject={(id) => handleAction(id, "reject")}
        showActionButtons={activeTab === "my-actions"}
      />

      <DataTablePage
        title="Leave Approvals"
        description="Review and manage leave requests, endorsements, and workflow history."
        icon={CalendarCheck2}
        backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
        tabs={dynamicTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        <DataTable<LeaveItem>
          data={activeData}
          columns={columns}
          getRowId={(r) => r.id}
          pagination={{ pageSize: 50 }}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : null}
          onRetry={refetch}
          searchPlaceholder="Search employee name or leave type..."
          searchFn={(r, q) => `${r.user?.full_name} ${r.leave_type?.name} ${r.status}`.toLowerCase().includes(q)}
          filters={filters}
          forceRowActionsDropdown
          rowActions={
            activeTab === "my-actions"
              ? [
                  {
                    label: "View Detail",
                    icon: Eye,
                    onClick: (r) => {
                      setSelectedLeaveDetail(r)
                      setDetailDialogOpen(true)
                    },
                  },
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
                    onClick: (r) => {
                      setSelectedLeaveDetail(r)
                      setDetailDialogOpen(true)
                    },
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
                    <div>
                      <span className="text-muted-foreground">Reliever:</span>{" "}
                      <span className="font-medium">{resolvePersonName(r.reliever) || "Not assigned"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Current Stage:</span>{" "}
                      <span className="font-medium">
                        {approvalStageLabel(r.current_stage_code || r.approval_stage)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Evidence:</span>{" "}
                      <Badge variant={r.evidence_complete ? "default" : "secondary"}>
                        {r.evidence_complete ? "Complete" : "Incomplete"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Status:</span>{" "}
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
                    </div>
                    <div>
                      <span className="text-muted-foreground">Reason:</span>{" "}
                      <span className="font-medium">{r.reason || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Resume Date:</span>{" "}
                      <span className="font-medium">{r.resume_date || "-"}</span>
                    </div>
                    {r.required_documents && r.required_documents.length > 0 ? (
                      <div>
                        <span className="text-muted-foreground">Required Docs:</span>{" "}
                        <span className="font-medium">{r.required_documents.join(", ")}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">Approval Timeline</p>
                    {stageAuditMap.size === 0 ? (
                      r.admin_manual ? (
                        <ul className="space-y-1">
                          <li className="text-xs">
                            <span className="font-medium">Manually Approved:</span>{" "}
                            <span className="text-emerald-500 capitalize">approved</span>
                            {r.approved_by_profile ? ` by ${resolvePersonName(r.approved_by_profile)}` : ""}
                            {r.approved_at ? ` at ${formatWATDateTime(r.approved_at)}` : ""}
                          </li>
                        </ul>
                      ) : (
                        <p className="text-muted-foreground text-xs">No approvals recorded yet.</p>
                      )
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
                          const statusLower = String(r.status || "").toLowerCase()
                          const isApprovedOrCompleted = ["approved", "completed"].includes(statusLower)
                          const isCancelled = statusLower === "cancelled"
                          const isRejected = statusLower === "rejected"
                          const expectedPersonName =
                            stageKey === "reliever"
                              ? resolvePersonName(r.reliever) || "Assigned Reliever"
                              : stageKey === "department_lead"
                                ? resolvePersonName(r.supervisor) || "Department Lead"
                                : stageKey === "admin_hr_lead"
                                  ? resolvePersonName(r.approved_by_profile) || "Admin & HR Lead"
                                  : stageName[stageKey]

                          return (
                            <li key={stageKey} className="text-xs">
                              <span className="font-medium">{stageName[stageKey]}:</span>{" "}
                              {item ? (
                                <>
                                  <span className="capitalize">{item.status}</span>
                                  {stageActorName ? ` by ${stageActorName}` : ""}
                                  {stageActorName ? ` (${stageName[stageKey]})` : ""}
                                  {item.approved_at ? ` at ${formatWATDateTime(item.approved_at)}` : ""}
                                </>
                              ) : stageKey === "reliever" && !hasRelieverAssignee ? (
                                <span className="text-muted-foreground">Not required for this request</span>
                              ) : stageKey === "reliever" && relieverHandledByLead ? (
                                <span className="text-muted-foreground">
                                  {`Handled by ${departmentLeadApproverName || resolvePersonName(r.supervisor) || "Department Lead"}`}
                                </span>
                              ) : isCancelled ? (
                                <span className="text-muted-foreground">Not reached (Cancelled)</span>
                              ) : isRejected ? (
                                <span className="text-muted-foreground">Not reached (Rejected)</span>
                              ) : isApprovedOrCompleted ||
                                (stageKey === "reliever" && advancedPastReliever && currentStageKey !== "reliever") ? (
                                <span className="text-muted-foreground">Bypassed ({expectedPersonName})</span>
                              ) : (
                                <span className="text-muted-foreground">Pending action ({expectedPersonName})</span>
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
      </DataTablePage>
    </>
  )
}
