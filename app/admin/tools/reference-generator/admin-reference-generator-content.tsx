"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CheckCircle, Clock, FileText, ListFilter, ChevronDown, ChevronUp, Building2, ShieldCheck } from "lucide-react"
import type { CorrespondenceRecord, CorrespondenceStatus } from "@/types/correspondence"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { formatName } from "@/lib/utils"
import { logger } from "@/lib/logger"

const log = logger("reference-generator")

interface DepartmentCodeOption {
  department_name: string
  department_code: string
  is_active: boolean
}

interface AdminReferenceGeneratorContentProps {
  initialRecords: CorrespondenceRecord[]
  departmentCodes: DepartmentCodeOption[]
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

const DepartmentCodeFormSchema = z.object({
  department_name: z.string().min(1, "Department name is required"),
  department_code: z.string().min(1, "Department code is required"),
})

type DepartmentCodeFormValues = z.infer<typeof DepartmentCodeFormSchema>

export function AdminReferenceGeneratorContent({
  initialRecords,
  departmentCodes,
}: AdminReferenceGeneratorContentProps) {
  const [records, setRecords] = useState<CorrespondenceRecord[]>(initialRecords)
  const [loadingRecordId, setLoadingRecordId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [activeTab, setActiveTab] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(initialRecords.length)
  const [isLoading, setIsLoading] = useState(false)
  const [showCodeManagement, setShowCodeManagement] = useState(false)
  const [globalCounts, setGlobalCounts] = useState({ total: 0, underReview: 0, approved: 0, rejected: 0 })

  const codeForm = useForm<DepartmentCodeFormValues>({
    resolver: zodResolver(DepartmentCodeFormSchema),
    defaultValues: { department_name: "", department_code: "" },
  })
  const [showMappings, setShowMappings] = useState(false)
  const [decisionPrompt, setDecisionPrompt] = useState<{
    recordId: string
    decision: "approved" | "rejected" | "returned_for_correction"
  } | null>(null)

  useEffect(() => {
    async function fetchGlobalCounts() {
      try {
        const [all, underReview, approved, rejected] = await Promise.all([
          fetch("/api/correspondence/records?page=1&limit=1", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/correspondence/records?page=1&limit=1&status=under_review", { cache: "no-store" }).then((r) =>
            r.json()
          ),
          fetch("/api/correspondence/records?page=1&limit=1&status=approved", { cache: "no-store" }).then((r) =>
            r.json()
          ),
          fetch("/api/correspondence/records?page=1&limit=1&status=rejected", { cache: "no-store" }).then((r) =>
            r.json()
          ),
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
    void fetchGlobalCounts()
  }, [])

  const stats = useMemo(() => {
    return {
      total: globalCounts.total,
      underReview: globalCounts.underReview,
      approved: globalCounts.approved,
      rejected: globalCounts.rejected,
    }
  }, [globalCounts])
  const statusLabel = (status: string) => (status === "under_review" ? "Sent for review" : formatName(status))

  useEffect(() => {
    async function loadRecords() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "50",
        })
        if (statusFilter !== "all") params.set("status", statusFilter)
        if (searchQuery.trim()) params.set("search", searchQuery.trim())

        const res = await fetch(`/api/correspondence/records?${params.toString()}`, { cache: "no-store" })
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
  }, [page, searchQuery, statusFilter])

  async function decide(recordId: string, decision: "approved" | "rejected" | "returned_for_correction") {
    setDecisionPrompt({ recordId, decision })
  }

  async function submitDecisionNote(comments: string) {
    if (!decisionPrompt) return

    const { recordId, decision } = decisionPrompt
    const prevRecord = records.find((r) => r.id === recordId)
    setLoadingRecordId(recordId)
    try {
      const res = await fetch(`/api/correspondence/records/${recordId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comments: comments || null }),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error || "Failed to apply decision")
      }

      const newStatus = ((body.data?.record?.status as string) ?? decision) as CorrespondenceStatus
      toast.success(`Record ${newStatus.replaceAll("_", " ")}`)
      setRecords((current) =>
        current.map((record) => (record.id === recordId ? { ...record, status: newStatus } : record))
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

  const updateDepartmentCode = codeForm.handleSubmit(async (data) => {
    try {
      const res = await fetch("/api/correspondence/department-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department_name: data.department_name.trim(),
          department_code: data.department_code.trim().toUpperCase(),
          is_active: true,
        }),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error || "Failed to update department code")
      }

      toast.success("Department code updated")
      codeForm.reset({ department_name: "", department_code: "" })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update department code"))
    }
  })

  const columns: DataTableColumn<CorrespondenceRecord>[] = [
    {
      key: "reference_number",
      label: "Reference",
      sortable: true,
      resizable: true,
      initialWidth: 220,
      accessor: (r) => r.reference_number,
      render: (r) => (
        <span className="font-medium">
          {["approved", "sent", "filed"].includes(r.status) ? r.reference_number : "-"}
        </span>
      ),
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
      render: (r) => <Badge>{statusLabel(r.status)}</Badge>,
    },
    {
      key: "created_by",
      label: "Created by",
      sortable: true,
      accessor: (r) => r.sender_name || "-",
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      accessor: (r) => r.created_at,
      render: (r) =>
        r.created_at
          ? new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          : "-",
    },
  ]

  const tabs: DataTableTab[] = [
    { key: "all", label: "All" },
    { key: "under_review", label: "Under Review" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
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
    },
    {
      key: "letter_type",
      label: "Type",
      options: [
        { value: "internal", label: "Internal" },
        { value: "external", label: "External" },
      ],
    },
    {
      key: "year",
      label: "Year",
      options: Array.from(
        new Set(
          records
            .map((record) => new Date(record.created_at || "").getFullYear())
            .filter((year) => Number.isFinite(year))
            .map((year) => ({ value: String(year), label: String(year) }))
        )
      ),
      mode: "custom",
      filterFn: (row, selected) => selected.includes(String(new Date(row.created_at || "").getFullYear())),
    },
  ]

  return (
    <DataTablePage
      title="Correspondence"
      description="Manage correspondence references and tracking."
      icon={ListFilter}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => {
        setActiveTab(tab)
        if (tab === "all") setStatusFilter("all")
        if (tab === "under_review") setStatusFilter("under_review")
        if (tab === "approved") setStatusFilter("approved")
        if (tab === "rejected") setStatusFilter("rejected")
      }}
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total"
            value={stats.total}
            icon={FileText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Under Review"
            value={stats.underReview}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Approved"
            value={stats.approved}
            icon={CheckCircle}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Rejected"
            value={stats.rejected}
            icon={ShieldCheck}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="border-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Building2 className="h-4 w-4" /> Department Code Management
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowCodeManagement((prev) => !prev)}
              >
                {showCodeManagement ? "Collapse" : "Expand"}
                {showCodeManagement ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
          {showCodeManagement && (
            <CardContent className="space-y-4">
              <form onSubmit={updateDepartmentCode} className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Department Name</Label>
                  <Input {...codeForm.register("department_name")} className="h-9 text-sm" />
                  {codeForm.formState.errors.department_name && (
                    <p className="text-destructive text-[10px]">{codeForm.formState.errors.department_name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Department Code</Label>
                  <Input {...codeForm.register("department_code")} className="h-9 text-sm" />
                  {codeForm.formState.errors.department_code && (
                    <p className="text-destructive text-[10px]">{codeForm.formState.errors.department_code.message}</p>
                  )}
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="h-9 w-full md:w-auto">
                    Save Code
                  </Button>
                </div>
              </form>

              <div className="space-y-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-8 px-0 text-xs transition-colors"
                  onClick={() => setShowMappings((prev) => !prev)}
                >
                  Active mappings: {departmentCodes.filter((item) => item.is_active).length}
                  {showMappings ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                </Button>

                {showMappings && (
                  <div className="bg-muted/20 rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableHead className="h-9 text-[10px] font-black uppercase">Department</TableHead>
                          <TableHead className="h-9 text-[10px] font-black uppercase">Code</TableHead>
                          <TableHead className="h-9 text-[10px] font-black uppercase">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {departmentCodes.map((item) => (
                          <TableRow key={item.department_name} className="hover:bg-muted/30">
                            <TableCell className="py-2 text-xs font-medium">{item.department_name}</TableCell>
                            <TableCell className="py-2 font-mono text-xs">{item.department_code}</TableCell>
                            <TableCell className="py-2">
                              <Badge
                                variant={item.is_active ? "default" : "outline"}
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {item.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>

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
          onPageChange={setPage}
          onSearchChange={setSearchQuery}
          onFilterChange={(f: Record<string, string[]>) => {
            if (f.status && f.status.length > 0) {
              setStatusFilter(f.status[0])
            } else {
              setStatusFilter("all")
            }
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
                  <span className="text-muted-foreground">Sender:</span> {r.sender_name || "-"}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Due Date:</span> {r.due_date || "-"}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Action Required:</span> {r.action_required ? "Yes" : "No"}
                </p>
              </div>
            ),
          }}
          emptyTitle="No references found"
          emptyDescription="No correspondence records match the current filters."
          emptyIcon={ListFilter}
          skeletonRows={5}
          urlSync
        />
      </div>

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
    </DataTablePage>
  )
}
