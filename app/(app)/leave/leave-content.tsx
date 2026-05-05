"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { CalendarDays, Clock, Plus, ExternalLink, Trash2, Pencil, Paperclip, CircleHelp } from "lucide-react"
import type { LeaveApprovalAudit, LeaveBalance, LeaveRequest, LeaveType } from "./page"

import { LeaveTypesCard } from "@/components/leave/leave-types-card"
import { LeaveDeleteConfirmDialog } from "@/components/leave/leave-delete-confirm-dialog"
import { LeaveRequestFormDialog } from "@/components/leave/leave-request-form-dialog"
import {
  LeaveApprovePromptDialog,
  LeaveRejectPromptDialog,
  LeaveEvidencePromptDialog,
} from "@/components/leave/leave-prompt-dialogs"
import { fetchLeaveData, addDays } from "@/components/leave/leave-data"
import type { LeaveCalendarData, LeaveRelieverDebug, LeaveReviewHistoryItem } from "@/components/leave/leave-data"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatName } from "@/lib/utils"

interface LeaveContentProps {
  currentUserId: string
  initialRequests: LeaveRequest[]
  initialBalances: LeaveBalance[]
  initialLeaveTypes: LeaveType[]
  initialRelieverOptions: { value: string; label: string }[]
  initialRelieverDebug: LeaveRelieverDebug | null
}

type ApproverQueueItem = LeaveRequest & {
  user?: {
    full_name?: string | null
  } | null
}

type LeaveQueryData = {
  requests: LeaveRequest[]
  balances: LeaveBalance[]
  approverQueue: ApproverQueueItem[]
  pendingReviewHistory: LeaveReviewHistoryItem[]
  leaveTypes: LeaveType[]
  relieverOptions: { value: string; label: string }[]
  relieverDebug: LeaveRelieverDebug | null
  leaveCalendar: LeaveCalendarData
}

type LeaveRoutePreview = {
  requester_kind: string
  stages: Array<{
    stage_code: string
    role_code: string
    label: string
  }>
}

type PersonNameRef = {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  company_email?: string | null
}

const EMPTY_REQUEST_FORM = {
  leave_type_id: "",
  start_date: "",
  days_count: 1,
  emergency_override: false,
  reason: "",
  reliever_identifier: "",
  handover_note: "",
  attachment: null as File | null,
}

const TABS: DataTableTab[] = [
  { key: "my-requests", label: "My Requests", icon: Clock },
  { key: "approvals", label: "Pending Reviews", icon: Clock },
]

export function LeaveContent({
  currentUserId,
  initialRequests,
  initialBalances,
  initialLeaveTypes,
  initialRelieverOptions,
  initialRelieverDebug,
}: LeaveContentProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState("my-requests")

  const { data: leaveData } = useQuery<LeaveQueryData>({
    queryKey: QUERY_KEYS.leaveRequests({ userId: currentUserId }),
    queryFn: () => fetchLeaveData(currentUserId),
    refetchOnMount: "always",
    initialData: {
      requests: initialRequests,
      balances: initialBalances,
      approverQueue: [],
      pendingReviewHistory: [],
      leaveTypes: initialLeaveTypes,
      relieverOptions: initialRelieverOptions,
      relieverDebug: initialRelieverDebug,
      leaveCalendar: {
        blackout_months: [12, 1],
        department_booked_dates: [],
      },
    },
  })

  const {
    requests,
    balances,
    leaveTypes,
    approverQueue,
    pendingReviewHistory,
    relieverOptions,
    relieverDebug,
    leaveCalendar,
  } = leaveData

  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null)
  const [approvePrompt, setApprovePrompt] = useState<{ requestId: string } | null>(null)
  const [rejectPrompt, setRejectPrompt] = useState<{ requestId: string } | null>(null)
  const [evidencePrompt, setEvidencePrompt] = useState<{ requestId: string; documentType: string } | null>(null)
  const [deleteConfirmRequest, setDeleteConfirmRequest] = useState<LeaveRequest | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isOverviewOpen, setIsOverviewOpen] = useState(false)
  const [isCreateBlockedOpen, setIsCreateBlockedOpen] = useState(false)
  const [formData, setFormData] = useState(EMPTY_REQUEST_FORM)

  const { data: leaveRoutePreview } = useQuery<LeaveRoutePreview>({
    queryKey: ["leave-flow-my-preview", formData.reliever_identifier || ""],
    queryFn: async () => {
      const relieverIdParam = formData.reliever_identifier
        ? `?reliever_id=${encodeURIComponent(formData.reliever_identifier)}`
        : ""
      const response = await fetch(`/api/hr/leave/flow/my-preview${relieverIdParam}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Failed to load approval route preview")
      return payload.data as LeaveRoutePreview
    },
    enabled: open,
  })

  const myRequests = useMemo(
    () => requests.filter((request) => request.user_id === currentUserId),
    [requests, currentUserId]
  )

  const balanceMap = useMemo(() => new Map(balances.map((b) => [b.leave_type_id, b])), [balances])
  const leaveTypeMap = useMemo(() => new Map(leaveTypes.map((t) => [t.id, t])), [leaveTypes])
  const consumedDaysByType = useMemo(() => {
    const map = new Map<string, number>()
    for (const request of myRequests) {
      if (["rejected", "cancelled"].includes(String(request.status || "").toLowerCase())) continue
      const leaveTypeId = request.leave_type_id
      const current = map.get(leaveTypeId) || 0
      map.set(leaveTypeId, current + Number(request.days_count || 0))
    }
    return map
  }, [myRequests])
  const availableDaysByType = useMemo(() => {
    const entries = leaveTypes.map((leaveType) => {
      const policyMax = Number(leaveType.max_days || 0)
      const consumed = Number(consumedDaysByType.get(leaveType.id) || 0)
      const derivedRemaining = Math.max(0, policyMax - consumed)
      const balanceRaw = balanceMap.get(leaveType.id)?.balance_days
      const normalizedBalance = Math.max(0, Number(balanceRaw ?? derivedRemaining))
      const effectiveMax = policyMax > 0 ? Math.min(policyMax, normalizedBalance) : normalizedBalance
      return [leaveType.id, Math.max(0, effectiveMax)] as const
    })
    return Object.fromEntries(entries) as Record<string, number>
  }, [balanceMap, consumedDaysByType, leaveTypes])
  const selectedAvailableDays = formData.leave_type_id ? (availableDaysByType[formData.leave_type_id] ?? 0) : 0
  const selectedLeaveType = leaveTypeMap.get(formData.leave_type_id)
  const normalizedLeaveCode = String(selectedLeaveType?.code || "")
    .trim()
    .toLowerCase()
  const normalizedLeaveName = String(selectedLeaveType?.name || "")
    .trim()
    .toLowerCase()
  const isSickLeave = normalizedLeaveCode === "sick" || normalizedLeaveName.includes("sick")
  const requiresAttachmentOnCreate = Boolean(
    !editingRequestId && (isSickLeave || selectedLeaveType?.required_documents?.length)
  )

  const stats = useMemo(() => {
    const totalTaken = myRequests
      .filter((r) => r.status === "approved")
      .reduce((acc, r) => acc + (r.days_count || 0), 0)
    const pending = myRequests.filter((r) => ["pending", "pending_evidence"].includes(r.status)).length
    return {
      totalTaken,
      pending,
      availableBalances: balances.filter((b) => b.balance_days > 0).length,
      waitingReviews: approverQueue.length,
    }
  }, [myRequests, balances, approverQueue])

  const columns: DataTableColumn<LeaveRequest>[] = useMemo(
    () => [
      {
        key: "leave_type",
        label: "Type",
        sortable: true,
        accessor: (r) => leaveTypeMap.get(r.leave_type_id)?.name || "Leave",
      },
      {
        key: "period",
        label: "Period",
        accessor: (r) => `${r.start_date} to ${r.end_date}`,
        render: (r) => (
          <div className="flex flex-col text-xs">
            <span className="font-medium">
              {r.start_date} to {r.end_date}
            </span>
            <span className="text-muted-foreground">{r.days_count} day(s)</span>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => (
          <Badge
            variant={
              r.status === "approved"
                ? "default"
                : ["rejected", "cancelled"].includes(r.status)
                  ? "destructive"
                  : "outline"
            }
            className="capitalize"
          >
            {formatName(r.status)}
          </Badge>
        ),
      },
      {
        key: "stage",
        label: "Current Stage",
        accessor: (r) => r.current_stage_code || r.approval_stage || "-",
        render: (r) => (
          <span className="text-muted-foreground text-xs">
            {formatName(r.current_stage_code || r.approval_stage || "-")}
          </span>
        ),
      },
    ],
    [leaveTypeMap]
  )

  const filters: DataTableFilter<LeaveRequest>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "pending", label: "Pending" },
        { value: "pending_evidence", label: "Pending Evidence" },
        { value: "approved", label: "Approved" },
        { value: "rejected", label: "Rejected" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
    {
      key: "leave_type",
      label: "Leave Type",
      options: leaveTypes.map((leaveType) => ({
        value: leaveType.id,
        label: leaveType.name,
      })),
      mode: "custom",
      filterFn: (row, selected) => selected.includes(row.leave_type_id),
    },
  ]

  const approvalFilters: DataTableFilter<ApproverQueueItem>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "pending", label: "Pending" },
          { value: "pending_evidence", label: "Pending Evidence" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ],
      },
      {
        key: "leave_type",
        label: "Leave Type",
        options: leaveTypes.map((leaveType) => ({
          value: leaveType.id,
          label: leaveType.name,
        })),
        mode: "custom",
        filterFn: (row, selected) => selected.includes(row.leave_type_id),
      },
    ],
    [leaveTypes]
  )

  const staticRowActions: RowAction<LeaveRequest>[] = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (item) => openEditDialog(item),
      hidden: (r) => {
        const isEditAllowed =
          ["pending", "pending_evidence"].includes(r.status) &&
          ["pending_reliever", "reliever_pending"].includes(r.current_stage_code || r.approval_stage || "")
        return !isEditAllowed
      },
    },
    {
      label: "Upload Evidence",
      icon: Paperclip,
      onClick: (item) => setEvidencePrompt({ requestId: item.id, documentType: "Sick Note" }),
      hidden: (r) => r.status !== "pending_evidence",
    },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive",
      onClick: (item) => setDeleteConfirmRequest(item),
      hidden: (r) => !["pending", "pending_evidence"].includes(r.status),
    },
  ]

  function openEditDialog(request: LeaveRequest) {
    setEditingRequestId(request.id)
    setFormData({
      leave_type_id: request.leave_type_id,
      start_date: request.start_date,
      days_count: Number(request.days_count) || 1,
      emergency_override: false,
      reason: request.reason || "",
      reliever_identifier: request.reliever_id || "",
      handover_note: request.handover_note || "",
      attachment: null,
    })
    setOpen(true)
  }

  function openCreateDialog() {
    setEditingRequestId(null)
    setFormData(EMPTY_REQUEST_FORM)
    setOpen(true)
  }

  async function handleSubmitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const isEditing = !!editingRequestId
      const { attachment, ...requestPayload } = formData
      if (!isEditing && requiresAttachmentOnCreate && !attachment) {
        throw new Error("Attachment is required for this leave type")
      }
      const response = await fetch("/api/hr/leave/requests", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditing ? { id: editingRequestId, ...requestPayload } : requestPayload),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to submit request")

      const createdOrUpdatedId = String(payload?.data?.id || editingRequestId || "")
      let successMessage = String(payload?.message || "")
      if (attachment && createdOrUpdatedId) {
        const requiredDocumentsFromResponse = Array.isArray(payload?.data?.required_documents)
          ? (payload.data.required_documents as string[])
          : []
        const requiredDocumentsFromSelection = Array.isArray(selectedLeaveType?.required_documents)
          ? selectedLeaveType.required_documents
          : []
        const requiredDocuments = requiredDocumentsFromResponse.length
          ? requiredDocumentsFromResponse
          : requiredDocumentsFromSelection
        const evidenceDocumentTypes = requiredDocuments.length ? requiredDocuments : ["supporting_document"]

        const uploadPayload = new FormData()
        uploadPayload.set("file", attachment)
        uploadPayload.set("document_type", evidenceDocumentTypes[0])

        const uploadResponse = await fetch("/api/hr/leave/evidence/upload", {
          method: "POST",
          body: uploadPayload,
        })
        const uploadBody = await uploadResponse.json().catch(() => ({}))
        if (!uploadResponse.ok || !uploadBody?.data?.file_url) {
          throw new Error(uploadBody?.error || "Leave request saved, but attachment upload failed")
        }

        for (const documentType of evidenceDocumentTypes) {
          const evidenceResponse = await fetch("/api/hr/leave/evidence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leave_request_id: createdOrUpdatedId,
              document_type: documentType,
              file_url: String(uploadBody.data.file_url),
              notes: "Uploaded with leave request form",
            }),
          })
          const evidenceBody = await evidenceResponse.json().catch(() => ({}))
          if (!evidenceResponse.ok) {
            throw new Error(evidenceBody?.error || "Leave request saved, but evidence link failed")
          }
        }

        successMessage = "Leave request created successfully"
      }

      toast.success(successMessage || "Request submitted")
      setOpen(false)
      setFormData(EMPTY_REQUEST_FORM)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.leaveRequests({ userId: currentUserId }) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Submission failed")
    } finally {
      setSubmitting(false)
    }
  }

  async function executeDeleteRequest(request: LeaveRequest) {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/hr/leave/requests?id=${encodeURIComponent(request.id)}`, {
        method: "DELETE",
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Delete failed")
      queryClient.setQueryData<LeaveQueryData>(QUERY_KEYS.leaveRequests({ userId: currentUserId }), (previous) => {
        if (!previous) return previous
        return {
          ...previous,
          requests: previous.requests.filter((item) => item.id !== request.id),
          approverQueue: previous.approverQueue.filter((item) => item.id !== request.id),
        }
      })
      setDeleteConfirmRequest(null)
      toast.success(payload.message || "Leave request deleted")
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.leaveRequests({ userId: currentUserId }) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed")
    } finally {
      setIsDeleting(false)
    }
  }

  async function submitAction(requestId: string, action: "approve" | "reject", comments: string) {
    try {
      const response = await fetch("/api/hr/leave/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leave_request_id: requestId, action, comments }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Action failed")
      toast.success(payload.message || "Action recorded")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.leaveRequests({ userId: currentUserId }) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed")
    }
  }

  async function submitEvidence(requestId: string, documentType: string, file: File) {
    try {
      const uploadPayload = new FormData()
      uploadPayload.set("file", file)
      uploadPayload.set("document_type", documentType)

      const uploadResponse = await fetch("/api/hr/leave/evidence/upload", {
        method: "POST",
        body: uploadPayload,
      })
      const uploadBody = await uploadResponse.json().catch(() => ({}))
      const uploadedUrl = String(uploadBody?.data?.file_url || "").trim()
      if (!uploadResponse.ok || !uploadedUrl) {
        throw new Error(uploadBody?.error || "Evidence file upload failed")
      }

      const response = await fetch("/api/hr/leave/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_request_id: requestId,
          document_type: documentType,
          file_url: uploadedUrl,
          notes: "Uploaded from leave evidence dialog",
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Evidence upload failed")
      toast.success(payload.message || "Evidence added")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.leaveRequests({ userId: currentUserId }) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evidence upload failed")
      throw error
    }
  }

  const hasPendingRequest = myRequests.some((r) => ["pending", "pending_evidence"].includes(r.status))

  function approvalStageLabel(code?: string | null) {
    const value = String(code || "").toLowerCase()
    if (value.includes("reliever")) return "Reliever"
    if (value.includes("department_lead")) return "Department Lead"
    if (value.includes("admin_hr_lead")) return "Admin & HR Lead"
    if (value.includes("hcs")) return "HCS"
    if (value.includes("md")) return "MD"
    return formatName(code || "Stage")
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

  return (
    <DataTablePage
      title="My Leave Center"
      description="Track eligibility, submit requests, and manage approvals in one view."
      icon={CalendarDays}
      backLink={{ href: "/profile", label: "Back to Home" }}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Taken (Days)"
            value={stats.totalTaken}
            icon={CalendarDays}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Ongoing Requests"
            value={stats.pending}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Available Balances"
            value={stats.availableBalances}
            icon={ExternalLink}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          {stats.waitingReviews > 0 && (
            <StatCard
              title="Need Your Review"
              value={stats.waitingReviews}
              icon={Plus}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
          )}
        </div>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsOverviewOpen(true)}>
            <CircleHelp className="mr-2 h-4 w-4" />
            Overview
          </Button>
          <Button
            onClick={() => {
              if (hasPendingRequest) {
                setIsCreateBlockedOpen(true)
                return
              }
              openCreateDialog()
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {activeTab === "my-requests" && (
          <DataTable<LeaveRequest>
            data={myRequests}
            columns={columns}
            getRowId={(r) => r.id}
            filters={filters}
            searchPlaceholder="Search reason or type..."
            searchFn={(r, q) => `${leaveTypeMap.get(r.leave_type_id)?.name} ${r.reason}`.toLowerCase().includes(q)}
            rowActions={staticRowActions}
            expandable={{
              render: (row) => {
                const timeline = [...(row.approvals || [])].sort((left, right) => {
                  const leftOrder = Number(left.stage_order || left.approval_level || 999)
                  const rightOrder = Number(right.stage_order || right.approval_level || 999)
                  if (leftOrder !== rightOrder) return leftOrder - rightOrder
                  return String(left.approved_at || "").localeCompare(String(right.approved_at || ""))
                })

                const stageAuditMap = new Map<string, LeaveApprovalAudit>()
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

                if (timeline.length === 0) {
                  if (row.reliever_decision_at) {
                    stageAuditMap.set("reliever", {
                      id: `${row.id}-reliever-fallback`,
                      status: row.status === "rejected" ? "rejected" : "approved",
                      stage_code: "pending_reliever",
                      approved_at: row.reliever_decision_at,
                      approver: row.reliever
                        ? {
                            id: row.reliever.id,
                            full_name: row.reliever.full_name,
                            company_email: row.reliever.company_email,
                          }
                        : null,
                    })
                  }

                  if (row.supervisor_decision_at) {
                    stageAuditMap.set("department_lead", {
                      id: `${row.id}-deptlead-fallback`,
                      status: row.status === "rejected" ? "rejected" : "approved",
                      stage_code: "pending_department_lead",
                      approved_at: row.supervisor_decision_at,
                      approver: row.supervisor
                        ? {
                            id: row.supervisor.id,
                            full_name: row.supervisor.full_name,
                            company_email: row.supervisor.company_email,
                          }
                        : null,
                    })
                  }

                  if (row.hr_decision_at) {
                    stageAuditMap.set("admin_hr_lead", {
                      id: `${row.id}-hr-fallback`,
                      status: row.status === "rejected" ? "rejected" : "approved",
                      stage_code: "pending_admin_hr_lead",
                      approved_at: row.hr_decision_at,
                      approver: row.approved_by_profile
                        ? {
                            id: row.approved_by_profile.id,
                            full_name: row.approved_by_profile.full_name,
                            company_email: row.approved_by_profile.company_email,
                          }
                        : null,
                    })
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
                const currentStageKey = approvalStageKey(row.current_stage_code || row.approval_stage)
                const hasRelieverAssignee = Boolean(row.reliever?.id)
                const relieverHandledByLead =
                  Boolean(row.reliever?.id) &&
                  Boolean(row.supervisor?.id) &&
                  row.reliever?.id === row.supervisor?.id &&
                  Boolean(stageAuditMap.get("department_lead"))
                const departmentLeadApproverName = resolvePersonName(stageAuditMap.get("department_lead")?.approver)
                const advancedPastReliever = ["department_lead", "admin_hr_lead", "hcs", "md"].includes(currentStageKey)

                return (
                  <div className="grid gap-3 p-2 text-sm md:grid-cols-2">
                    <div className="space-y-1">
                      <p>
                        <span className="text-muted-foreground">Reliever:</span>{" "}
                        <span className="font-medium">{resolvePersonName(row.reliever) || "Not assigned"}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Current Stage:</span>{" "}
                        <span className="font-medium">
                          {approvalStageLabel(row.current_stage_code || row.approval_stage)}
                        </span>
                      </p>
                    </div>
                    <div className="space-y-1">
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
                                ? resolvePersonName(row.reliever) || null
                                : stageKey === "department_lead"
                                  ? resolvePersonName(row.supervisor) || null
                                  : stageKey === "admin_hr_lead"
                                    ? resolvePersonName(row.approved_by_profile) || null
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
                                ) : stageKey === "reliever" &&
                                  advancedPastReliever &&
                                  currentStageKey !== "reliever" ? (
                                  <span className="text-muted-foreground">Skipped by route rules</span>
                                ) : (
                                  <span className="text-muted-foreground">Pending / not acted</span>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )
              },
            }}
            urlSync
          />
        )}

        {activeTab === "approvals" && (
          <div className="space-y-4">
            <DataTable<ApproverQueueItem>
              data={approverQueue}
              getRowId={(r) => r.id}
              columns={[
                {
                  key: "requester",
                  label: "Requester",
                  accessor: (r) => r.user?.full_name || "Employee",
                },
                {
                  key: "period",
                  label: "Period",
                  accessor: (r) => `${r.start_date} to ${r.end_date}`,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (r) => <Badge variant="outline">{r.status}</Badge>,
                },
              ]}
              filters={approvalFilters}
              searchPlaceholder="Search requester or leave period..."
              searchFn={(r, q) =>
                `${r.user?.full_name || ""} ${r.start_date} ${r.end_date} ${r.reason || ""}`.toLowerCase().includes(q)
              }
              rowActions={[
                {
                  label: "Approve",
                  onClick: (r) => setApprovePrompt({ requestId: r.id }),
                },
                {
                  label: "Reject",
                  variant: "destructive",
                  onClick: (r) => setRejectPrompt({ requestId: r.id }),
                },
              ]}
            />

            <div className="rounded-lg border p-4">
              <p className="text-sm font-semibold">Recent Review History</p>
              <p className="text-muted-foreground mb-3 text-xs">
                Your latest acceptance and rejection decisions are recorded here.
              </p>
              {pendingReviewHistory.length === 0 ? (
                <p className="text-muted-foreground text-xs">No review activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {pendingReviewHistory.slice(0, 10).map((item) => (
                    <li key={item.id} className="rounded-md border p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={item.status === "rejected" ? "destructive" : "outline"} className="capitalize">
                          {item.status || "recorded"}
                        </Badge>
                        <span className="font-medium">{formatName(item.stage_code || "approval_stage")}</span>
                        <span className="text-muted-foreground">{item.request?.user?.full_name || "Employee"}</span>
                        <span className="text-muted-foreground">
                          {item.approved_at ? new Date(item.approved_at).toLocaleString() : ""}
                        </span>
                      </div>
                      {item.comments ? <p className="mt-1 text-xs">{item.comments}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <LeaveDeleteConfirmDialog
        request={deleteConfirmRequest}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteConfirmRequest(null)
          }
        }}
        onConfirm={executeDeleteRequest}
        isDeleting={isDeleting}
      />

      <LeaveApprovePromptDialog
        approvePrompt={approvePrompt}
        onOpenChange={() => setApprovePrompt(null)}
        onConfirm={(requestId, feedback) => {
          submitAction(requestId, "approve", feedback)
          setApprovePrompt(null)
        }}
      />

      <LeaveRejectPromptDialog
        rejectPrompt={rejectPrompt}
        onOpenChange={() => setRejectPrompt(null)}
        onConfirm={(requestId, reason) => {
          submitAction(requestId, "reject", reason)
          setRejectPrompt(null)
        }}
      />

      <LeaveEvidencePromptDialog
        evidencePrompt={evidencePrompt}
        onOpenChange={() => setEvidencePrompt(null)}
        onConfirm={async (requestId, documentType, file) => {
          await submitEvidence(requestId, documentType, file)
          setEvidencePrompt(null)
        }}
      />

      <LeaveRequestFormDialog
        open={open}
        onOpenChange={setOpen}
        editingRequestId={editingRequestId}
        formData={formData}
        setFormData={setFormData}
        leaveTypes={leaveTypes}
        relieverOptions={relieverOptions}
        relieverDebug={relieverDebug}
        selectedLeaveType={selectedLeaveType}
        selectedBalance={balanceMap.get(formData.leave_type_id)}
        requiresAttachmentOnCreate={requiresAttachmentOnCreate}
        availableDays={selectedAvailableDays}
        availableDaysByType={availableDaysByType}
        approvalRouteStages={leaveRoutePreview?.stages || []}
        preview={addDays(formData.start_date, Number(formData.days_count))}
        leaveCalendar={leaveCalendar}
        canSubmit={
          !!formData.leave_type_id &&
          !!formData.start_date &&
          !!formData.reason &&
          !!formData.reliever_identifier &&
          !!formData.handover_note &&
          Number(formData.days_count) > 0 &&
          Number(formData.days_count) <= selectedAvailableDays &&
          (!requiresAttachmentOnCreate || Boolean(formData.attachment))
        }
        submitting={submitting}
        onSubmit={handleSubmitRequest}
      />

      <Dialog open={isOverviewOpen} onOpenChange={setIsOverviewOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Leave Overview</DialogTitle>
            <DialogDescription>
              Quick guide for leave balances, request flow, and what each leave type allows.
            </DialogDescription>
          </DialogHeader>
          <LeaveTypesCard leaveTypes={leaveTypes} balanceMap={balanceMap} />
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateBlockedOpen} onOpenChange={setIsCreateBlockedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cannot Create New Request</DialogTitle>
            <DialogDescription>
              You already have an ongoing leave request. Submit a new one only after the current request is approved,
              rejected, or cancelled.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button onClick={() => setIsCreateBlockedOpen(false)}>Okay</Button>
          </div>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
