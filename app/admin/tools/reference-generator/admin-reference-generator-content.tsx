"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import { Building2, CheckCircle, Clock, FileText, ListFilter, ShieldCheck, Download } from "lucide-react"
import type { CorrespondenceRecord, CorrespondenceStatus } from "@/types/correspondence"
import { getCanonicalDepartmentOrder } from "@/shared/departments"
import { useDepartments } from "@/hooks/use-departments"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { formatName } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { apiFetch } from "@/lib/api-client"
import {
  exportCorrespondenceToExcel,
  exportCorrespondenceToPDF,
  exportCorrespondenceToWord,
} from "@/lib/correspondence/correspondence-export"

const log = logger("reference-generator")

interface AdminReferenceGeneratorContentProps {
  initialRecords: CorrespondenceRecord[]
  lockedDepartment?: string
  backLinkHref?: string
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function AdminReferenceGeneratorContent({
  initialRecords,
  lockedDepartment,
  backLinkHref = "/admin",
}: AdminReferenceGeneratorContentProps) {
  const { departments: dynamicDepartments } = useDepartments()
  const availableDepartments = dynamicDepartments.length > 0 ? dynamicDepartments : getCanonicalDepartmentOrder()

  const [records, setRecords] = useState<CorrespondenceRecord[]>(initialRecords)
  const [loadingRecordId, setLoadingRecordId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"all" | "external" | "internal">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(initialRecords.length)
  const [isLoading, setIsLoading] = useState(false)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [tabCounts, setTabCounts] = useState({ all: initialRecords.length, external: 0, internal: 0 })
  const [globalCounts, setGlobalCounts] = useState({ total: 0, underReview: 0, approved: 0, rejected: 0 })
  const [departmentFilter, setDepartmentFilter] = useState("")
  // This table is server-paginated, so the DataTable cannot filter rows itself —
  // every active filter has to be forwarded to the API or it does nothing.
  const [statusFilter, setStatusFilter] = useState("")
  const [yearFilter, setYearFilter] = useState("")

  const recordsUrl = useCallback(
    (params: URLSearchParams) => {
      if (lockedDepartment) params.set("department", lockedDepartment)
      else if (departmentFilter) params.set("department", departmentFilter)
      return `/api/correspondence/records?${params.toString()}`
    },
    [lockedDepartment, departmentFilter]
  )

  /** Applies the filter-bar selections that the server understands. */
  const applyServerFilters = useCallback(
    (params: URLSearchParams) => {
      if (statusFilter) params.set("status", statusFilter)
      if (yearFilter) {
        params.set("date_from", `${yearFilter}-01-01`)
        params.set("date_to", `${yearFilter}-12-31T23:59:59.999Z`)
      }
      return params
    },
    [statusFilter, yearFilter]
  )

  const [decisionPrompt, setDecisionPrompt] = useState<{
    recordId: string
    decision: "approved" | "rejected" | "returned_for_correction"
  } | null>(null)

  useEffect(() => {
    async function fetchTabCounts() {
      try {
        const [all, external, internal] = await Promise.all([
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1" })), { cache: "no-store" }).then((r) =>
            r.json()
          ),
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1", letter_type: "external" })), {
            cache: "no-store",
          }).then((r) => r.json()),
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1", letter_type: "internal" })), {
            cache: "no-store",
          }).then((r) => r.json()),
        ])
        setTabCounts({
          all: Number(all.total || 0),
          external: Number(external.total || 0),
          internal: Number(internal.total || 0),
        })
      } catch (err) {
        log.error("Failed to fetch tab counts", err)
      }
    }

    async function fetchGlobalCounts() {
      try {
        const [all, underReview, approved, rejected] = await Promise.all([
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1" })), { cache: "no-store" }).then((r) =>
            r.json()
          ),
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1", status: "under_review" })), {
            cache: "no-store",
          }).then((r) => r.json()),
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1", status: "approved" })), {
            cache: "no-store",
          }).then((r) => r.json()),
          apiFetch(recordsUrl(new URLSearchParams({ page: "1", limit: "1", status: "rejected" })), {
            cache: "no-store",
          }).then((r) => r.json()),
        ])
        setGlobalCounts({
          total: Number(all.total || 0),
          underReview: Number(underReview.total || 0),
          approved: Number(approved.total || 0),
          rejected: Number(rejected.total || 0),
        })
      } catch (err) {
        log.error("Failed to fetch global counts", err)
      }
    }
    void fetchTabCounts()
    void fetchGlobalCounts()
  }, [recordsUrl])

  const stats = useMemo(() => {
    return {
      total: globalCounts.total,
      underReview: globalCounts.underReview,
      approved: globalCounts.approved,
      rejected: globalCounts.rejected,
    }
  }, [globalCounts])
  const statusLabel = (status: string) => (status === "under_review" ? "Sent for review" : formatName(status))
  const statusBadgeClass = (status: string) => {
    if (status === "approved") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
    if (status === "rejected") return "bg-red-500/10 text-red-500 border-red-500/20"
    if (status === "returned_for_correction") return "bg-amber-500/10 text-amber-500 border-amber-500/20"
    if (status === "under_review") return "bg-blue-500/10 text-blue-500 border-blue-500/20"
    if (status === "draft") return "bg-slate-500/10 text-slate-500 border-slate-500/20"
    if (status === "sent" || status === "filed") return "bg-violet-500/10 text-violet-500 border-violet-500/20"
    return "bg-muted text-muted-foreground border-muted-foreground/20"
  }

  const handleExport = async (format: "excel" | "pdf" | "word") => {
    setIsLoading(true)
    const exportToast = toast.loading(`Exporting correspondence to ${format}...`)
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "5000",
      })
      if (activeTab !== "all") params.set("letter_type", activeTab)
      if (searchQuery.trim()) params.set("search", searchQuery.trim())
      applyServerFilters(params)

      const res = await apiFetch(recordsUrl(params), { cache: "no-store" })
      const json = await res.json()
      const allMatchingRecords = json.data || []

      if (allMatchingRecords.length === 0) {
        toast.error("No correspondence records to export", { id: exportToast })
        return
      }

      if (format === "excel") {
        await exportCorrespondenceToExcel(allMatchingRecords)
      } else if (format === "pdf") {
        await exportCorrespondenceToPDF(allMatchingRecords)
      } else if (format === "word") {
        await exportCorrespondenceToWord(allMatchingRecords)
      }
      toast.success("Export completed successfully", { id: exportToast })
    } catch (err) {
      log.error("Failed to export correspondence records", err)
      toast.error("Export failed", { id: exportToast })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    async function loadRecords() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "50",
        })
        if (activeTab !== "all") params.set("letter_type", activeTab)
        if (searchQuery.trim()) params.set("search", searchQuery.trim())
        applyServerFilters(params)

        const res = await apiFetch(recordsUrl(params), { cache: "no-store" })
        const json = await res.json()
        setRecords(json.data || [])
        setTotal(Number(json.total || 0))
      } catch (err) {
        log.error("Failed to load records", err)
      } finally {
        setIsLoading(false)
      }
    }

    void loadRecords()
  }, [page, searchQuery, activeTab, recordsUrl, applyServerFilters])

  async function decide(recordId: string, decision: "approved" | "rejected" | "returned_for_correction") {
    setDecisionPrompt({ recordId, decision })
  }

  async function submitDecisionNote(comments: string) {
    if (!decisionPrompt) return

    const { recordId, decision } = decisionPrompt
    const prevRecord = records.find((r) => r.id === recordId)
    setLoadingRecordId(recordId)
    try {
      const res = await apiFetch(`/api/correspondence/records/${recordId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          comments: comments || null,
          acting_department: lockedDepartment || null,
        }),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error || "Failed to apply decision")
      }

      const updatedRecord = body.data?.record as CorrespondenceRecord | undefined
      const newStatus = (updatedRecord?.status ?? decision) as CorrespondenceStatus
      toast.success(`Record ${newStatus.replaceAll("_", " ")}`)
      setRecords((current) =>
        current.map((record) => (record.id === recordId ? { ...record, ...updatedRecord, status: newStatus } : record))
      )
      setGlobalCounts((prev) => {
        const next = { ...prev }
        if (prevRecord?.status === "under_review") next.underReview = Math.max(0, prev.underReview - 1)
        if (newStatus === "approved") next.approved = prev.approved + 1
        if (newStatus === "rejected") next.rejected = prev.rejected + 1
        return next
      })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to apply decision"))
    } finally {
      setLoadingRecordId(null)
      setDecisionPrompt(null)
    }
  }

  const columns: DataTableColumn<CorrespondenceRecord>[] = [
    {
      key: "reference_number",
      label: "Reference",
      sortable: true,
      resizable: true,
      initialWidth: 220,
      accessor: (r) => r.reference_number,
      render: (r) => {
        if (!["approved", "sent", "filed"].includes(r.status) || !r.reference_number) {
          return "-"
        }

        const copyToClipboard = (text: string) => {
          navigator.clipboard.writeText(text)
          toast.success(`Copied: ${text}`)
        }

        if (r.letter_type === "external" && r.simulated_sequence) {
          const lastSlashIndex = r.reference_number.lastIndexOf("/")
          if (lastSlashIndex !== -1) {
            const prefix = r.reference_number.substring(0, lastSlashIndex + 1)
            const seqStr = String(r.simulated_sequence).padStart(3, "0")
            const simulatedRef = `${prefix}${seqStr}`
            if (simulatedRef !== r.reference_number) {
              return (
                <span className="flex flex-wrap items-center gap-x-1 font-medium">
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={() => copyToClipboard(r.reference_number!)}
                    title="Click to copy original reference"
                  >
                    {r.reference_number}
                  </span>
                  <span
                    className="text-muted-foreground cursor-pointer text-xs font-normal hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(simulatedRef)
                    }}
                    title="Click to copy simulated reference"
                  >
                    ({simulatedRef})
                  </span>
                </span>
              )
            }
          }
        }
        return (
          <span
            className="cursor-pointer font-medium hover:underline"
            onClick={() => copyToClipboard(r.reference_number!)}
            title="Click to copy reference"
          >
            {r.reference_number}
          </span>
        )
      },
    },
    {
      key: "letter_type",
      label: "Type",
      sortable: true,
      accessor: (r) => r.letter_type || "external",
      render: (r) => <Badge variant="outline">{r.letter_type || "external"}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => <Badge className={statusBadgeClass(r.status)}>{statusLabel(r.status)}</Badge>,
    },
    {
      key: "requested_by",
      label: "Requested by",
      sortable: true,
      hideOnMobile: true,
      accessor: (r) => r.sender_name || "-",
    },
    {
      key: "created_by",
      label: "Created by",
      sortable: true,
      hideOnMobile: true,
      accessor: (r) => r.created_by_name || r.sender_name || "-",
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      hideOnMobile: true,
      accessor: (r) => r.created_at,
      render: (r) =>
        r.created_at ? formatWATDate(r.created_at, { day: "2-digit", month: "short", year: "numeric" }) : "-",
    },
  ]

  const tabs: DataTableTab[] = [
    { key: "all", label: `All (${tabCounts.all})` },
    { key: "external", label: `External (${tabCounts.external})` },
    { key: "internal", label: `Internal (${tabCounts.internal})` },
  ]

  const filters: DataTableFilter<CorrespondenceRecord>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "under_review", label: "Sent for review" },
        { value: "approved", label: "Approved" },
        { value: "rejected", label: "Rejected" },
        { value: "returned_for_correction", label: "Returned for correction" },
        { value: "assigned_action_pending", label: "Assigned action pending" },
        { value: "open", label: "Open" },
        { value: "sent", label: "Sent" },
        { value: "filed", label: "Filed" },
      ],
      multi: false,
      // Server does the actual filtering (see onFilterChange -> statusFilter).
      mode: "custom",
      filterFn: () => true,
    },
    {
      key: "year",
      label: "Year",
      multi: false,
      // Dedupe the years themselves — a Set of freshly-built objects never
      // collapses duplicates, so every record used to add its own option.
      options: Array.from(
        new Set(
          records
            .map((record) => new Date(record.created_at || "").getFullYear())
            .filter((year) => Number.isFinite(year))
        )
      )
        .sort((a, b) => b - a)
        .map((year) => ({ value: String(year), label: String(year) })),
      // Server does the actual filtering (see onFilterChange → yearFilter).
      mode: "custom",
      filterFn: () => true,
    },
    // Department filter is server-side (see onFilterChange → departmentFilter).
    // Hidden when the page is already locked to a single department.
    ...(lockedDepartment
      ? []
      : [
          {
            key: "department",
            label: "Department",
            icon: <Building2 className="h-4 w-4" />,
            multi: false,
            mode: "custom" as const,
            // Server does the actual filtering; keep client-side rows intact.
            filterFn: () => true,
            options: availableDepartments.map((name) => ({ value: name, label: name })),
          } satisfies DataTableFilter<CorrespondenceRecord>,
        ]),
  ]

  return (
    <DataTablePage
      title="Correspondence"
      description="Manage correspondence references and tracking."
      icon={ListFilter}
      backLink={{
        href: backLinkHref,
        label: lockedDepartment ? "Back to Department" : "Back to Admin",
      }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => {
        setActiveTab(tab as "all" | "external" | "internal")
        setPage(1)
      }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setExportOptionsOpen(true)}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total"
            value={stats.total}
            icon={FileText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Under Review"
            value={stats.underReview}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Approved"
            value={stats.approved}
            icon={CheckCircle}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Rejected"
            value={stats.rejected}
            icon={ShieldCheck}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<CorrespondenceRecord>
        data={records}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search reference, subject, recipient, or sender..."
        searchFn={(r, q) =>
          `${r.reference_number} ${r.subject} ${r.recipient_name || ""} ${r.sender_name || ""}`
            .toLowerCase()
            .includes(q)
        }
        filters={filters}
        isLoading={isLoading}
        pagination={{ pageSize: 50, serverSide: true }}
        totalRows={total}
        currentPage={page - 1}
        onPageChange={(p) => setPage(p + 1)}
        onSearchChange={setSearchQuery}
        onFilterChange={(f) => {
          const dept = f.department?.[0] ?? ""
          const status = f.status?.[0] ?? ""
          const year = f.year?.[0] ?? ""

          if (dept === departmentFilter && status === statusFilter && year === yearFilter) {
            return
          }

          setDepartmentFilter(dept)
          setStatusFilter(status)
          setYearFilter(year)
          setPage(1)
        }}
        rowActions={[
          {
            label: "Approve",
            onClick: (r) => decide(r.id, "approved"),
            hidden: (r) => r.status !== "under_review" || loadingRecordId === r.id,
          },
          {
            label: "Reject",
            onClick: (r) => decide(r.id, "rejected"),
            hidden: (r) => r.status !== "under_review" || loadingRecordId === r.id,
          },
          {
            label: "Return for correction",
            onClick: (r) => decide(r.id, "returned_for_correction"),
            hidden: (r) => r.status !== "under_review" || loadingRecordId === r.id,
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="grid gap-3 md:grid-cols-2">
              <p className="text-sm md:col-span-2">
                <span className="text-muted-foreground">Subject:</span> {r.subject}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Department:</span>{" "}
                {r.department_name || r.assigned_department_name || "-"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Recipient:</span> {r.recipient_name || "-"}
                {r.recipient_code ? ` (${r.recipient_code})` : ""}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Requested by:</span> {r.sender_name || "-"}
              </p>
              {r.created_by_name && r.created_by_name !== r.sender_name && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Created by:</span> {r.created_by_name}
                </p>
              )}
              <p className="text-sm">
                <span className="text-muted-foreground">Due Date:</span> {r.due_date || "-"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Action Required:</span> {r.action_required ? "Yes" : "No"}
              </p>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) =>
            r.status === "approved"
              ? "bg-emerald-500"
              : r.status === "rejected"
                ? "bg-rose-500"
                : r.status === "under_review"
                  ? "bg-blue-500"
                  : "bg-amber-500",
          title: (r) => `${r.reference_number} · ${r.subject}`,
          subtitle: (r) =>
            `${r.department_name || r.assigned_department_name || "No dept"} · ${r.recipient_name || "No recipient"} · ${formatWATDate(r.created_at)}`,
          trailing: (r) => (
            <Badge variant="outline" className={`text-[10px] capitalize ${statusBadgeClass(r.status)}`}>
              {statusLabel(r.status)}
            </Badge>
          ),
        }}
        cardRenderer={(r) => (
          <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{r.reference_number}</p>
                <p className="text-muted-foreground line-clamp-1 text-xs">{r.subject}</p>
              </div>
              <Badge variant="outline" className={`capitalize ${statusBadgeClass(r.status)}`}>
                {statusLabel(r.status)}
              </Badge>
            </div>
            <div className="text-muted-foreground space-y-1 border-t pt-2 text-xs">
              <p>Recipient: {r.recipient_name || "—"}</p>
              <div className="flex items-center justify-between text-[10px]">
                <span>{r.department_name || r.assigned_department_name || "—"}</span>
                <span>{formatWATDate(r.created_at)}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No references found"
        emptyDescription="No correspondence records match the current filters."
        emptyIcon={ListFilter}
        skeletonRows={5}
        urlSync
      />

      <PromptDialog
        open={decisionPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setDecisionPrompt(null)
        }}
        title={
          decisionPrompt?.decision === "approved"
            ? "Approval note"
            : decisionPrompt?.decision === "rejected"
              ? "Why are you rejecting this reference?"
              : "Why are you returning this reference?"
        }
        description="Add a note so the requester can see why this action was taken."
        label="Approver note"
        placeholder="Write a short explanation..."
        inputType="textarea"
        required={decisionPrompt?.decision !== "approved"}
        confirmLabel="Submit decision"
        confirmVariant={decisionPrompt?.decision === "rejected" ? "destructive" : "default"}
        onConfirm={submitDecisionNote}
      />

      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title="Export Correspondence"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
          { id: "word", label: "Word (.docx)", icon: "word" },
        ]}
        onSelect={(id) => {
          void handleExport(id as "excel" | "pdf" | "word")
        }}
      />
    </DataTablePage>
  )
}
