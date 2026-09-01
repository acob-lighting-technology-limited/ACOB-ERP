"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Building2, CalendarClock, Check, CircleDot, FileCode2, Mail, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import type { CorrespondenceRecord } from "@/types/correspondence"
import { CreateReferenceDialog, type CreateReferenceForm } from "@/components/correspondence/create-reference-dialog"
import { cn, formatName } from "@/lib/utils"
import { apiFetch } from "@/lib/api-client"

interface DepartmentCodeOption {
  department_name: string
  department_code: string
}

interface PortalReferenceGeneratorContentProps {
  currentViewerName: string
  currentViewerId: string
  currentViewerDepartment: string
  currentViewerRole?: string
  isDepartmentLead?: boolean
  initialRecords: CorrespondenceRecord[]
  departmentCodes: DepartmentCodeOption[]
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

const EDITABLE_STATUSES = ["under_review", "returned_for_correction"]

export function PortalReferenceGeneratorContent({
  currentViewerName,
  currentViewerId,
  currentViewerDepartment,
  initialRecords,
  departmentCodes,
}: PortalReferenceGeneratorContentProps) {
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

  const initialDepartment = departmentCodes.some((item) => item.department_name === currentViewerDepartment)
    ? currentViewerDepartment
    : ""

  const [records, setRecords] = useState<CorrespondenceRecord[]>(initialRecords)
  const [isSaving, setIsSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<CorrespondenceRecord | null>(null)

  const emptyForm: CreateReferenceForm = {
    department_name: initialDepartment,
    recipient_department_name: "",
    letter_type: "external",
    category: "",
    custom_category_name: "",
    custom_category_code: "",
    subject: "",
    recipient_name: "",
    recipient_code: "",
    requester_id: currentViewerId,
    action_required: false,
    due_date: "",
    metadata_text: "",
    attachments: [],
  }

  const [form, setForm] = useState<CreateReferenceForm>(emptyForm)
  const [editForm, setEditForm] = useState<CreateReferenceForm>(emptyForm)

  const stats = useMemo(
    () => ({
      total: records.length,
      open: records.filter((record) =>
        ["open", "draft", "under_review", "assigned_action_pending"].includes(record.status)
      ).length,
      closed: records.filter((record) => ["closed", "sent", "filed", "approved"].includes(record.status)).length,
      internal: records.filter((record) => record.letter_type === "internal").length,
    }),
    [records]
  )

  useEffect(() => {
    let active = true

    async function loadRecords() {
      // No page/limit: the API returns the full scoped set when neither is passed.
      // `limit=100` silently capped the list and made every stat card understate.
      const response = await apiFetch("/api/correspondence/records?scope=mine", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || !active) return
      setRecords(payload.data || [])
    }

    void loadRecords()

    return () => {
      active = false
    }
  }, [])

  async function createRecord(event: React.FormEvent) {
    event.preventDefault()
    const isInternal = (form.letter_type || "external") === "internal"
    const mdDepartment = departmentCodes.find((item) => item.department_code.toUpperCase() === "MD")

    if (!form.subject.trim()) {
      toast.error("Subject is required")
      return
    }
    if (!form.department_name) {
      toast.error("Request Department is required")
      return
    }
    if (isInternal && !mdDepartment) {
      toast.error("Executive Management (MD) department is not configured")
      return
    }
    if (!form.recipient_code.trim() && !isInternal) {
      toast.error("Recipient Code is required")
      return
    }
    if (isInternal && !mdDepartment?.department_code?.trim()) {
      toast.error("Executive Management recipient department code is required")
      return
    }
    if (!form.due_date) {
      toast.error("Due Date is required")
      return
    }

    setIsSaving(true)
    try {
      let categoryValue = form.category === "__custom__" ? "" : form.category
      if (form.category === "__custom__") {
        if (!form.custom_category_name.trim() || !form.custom_category_code.trim()) {
          toast.error("Custom category name and code are required")
          setIsSaving(false)
          return
        }
        const catRes = await apiFetch("/api/correspondence/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.custom_category_name.trim(), code: form.custom_category_code.trim() }),
        })
        const catPayload = await catRes.json()
        if (!catRes.ok && catRes.status !== 409) throw new Error(catPayload.error || "Failed to save custom category")
        categoryValue = form.custom_category_code.trim().toUpperCase()
      }

      const metadata = form.metadata_text.trim() ? { notes: form.metadata_text.trim() } : null
      const formPayload = new FormData()
      formPayload.append("department_name", form.department_name)
      formPayload.append("letter_type", form.letter_type || "external")
      formPayload.append("category", categoryValue)
      formPayload.append("subject", form.subject)
      formPayload.append("recipient_name", isInternal ? mdDepartment?.department_name || "" : form.recipient_name || "")
      formPayload.append(
        "recipient_code",
        (isInternal ? mdDepartment?.department_code || "" : form.recipient_code).trim().toUpperCase()
      )
      formPayload.append("originator_id", form.requester_id || currentViewerId)
      formPayload.append("action_required", String(form.action_required))
      formPayload.append("due_date", form.due_date)
      formPayload.append("metadata", JSON.stringify(metadata || {}))
      form.attachments.forEach((file) => formPayload.append("attachments", file))

      const response = await apiFetch("/api/correspondence/records", { method: "POST", body: formPayload })
      const responsePayload = await response.json()
      if (!response.ok) throw new Error(responsePayload.error || "Failed to create correspondence")
      toast.success("Correspondence created")
      setCreateOpen(false)
      setForm({ ...emptyForm })
      setRecords((current) => [responsePayload.data, ...current])
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to create correspondence"))
    } finally {
      setIsSaving(false)
    }
  }

  function openEdit(row: CorrespondenceRecord) {
    setEditingRecord(row)
    setEditForm({
      department_name: row.department_name || "",
      letter_type: row.letter_type || "external",
      category: row.category || "",
      custom_category_name: "",
      custom_category_code: "",
      subject: row.subject,
      recipient_department_name: row.letter_type === "internal" ? row.recipient_name || "" : "",
      recipient_name: row.recipient_name || "",
      recipient_code: row.recipient_code || "",
      requester_id: row.originator_id || currentViewerId,
      action_required: row.action_required ?? false,
      due_date: row.due_date || "",
      metadata_text: (row.metadata as Record<string, string> | null)?.notes || "",
      attachments: [],
    })
    setEditOpen(true)
  }

  async function updateRecord(event: React.FormEvent) {
    event.preventDefault()
    if (!editingRecord) return
    if (!editForm.subject.trim()) {
      toast.error("Subject is required")
      return
    }
    if (!editForm.due_date) {
      toast.error("Due Date is required")
      return
    }

    setIsSaving(true)
    try {
      const isResubmit = editingRecord.status === "returned_for_correction"
      const metadata = editForm.metadata_text.trim() ? { notes: editForm.metadata_text.trim() } : {}
      const body: Record<string, unknown> = {
        subject: editForm.subject.trim(),
        recipient_name: editForm.recipient_name.trim() || null,
        letter_type: editForm.letter_type || "external",
        category: editForm.category || null,
        due_date: editForm.due_date,
        metadata,
      }
      if (isResubmit) body.status = "under_review"

      const res = await apiFetch(`/api/correspondence/records/${editingRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to update correspondence")

      toast.success(isResubmit ? "Correspondence resubmitted for review" : "Correspondence updated")
      setEditOpen(false)
      setEditingRecord(null)
      setRecords((current) =>
        current.map((r) => (r.id === editingRecord.id ? { ...r, ...(payload.data as CorrespondenceRecord) } : r))
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update correspondence"))
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteRecord(recordId: string) {
    try {
      const res = await apiFetch(`/api/correspondence/records/${recordId}`, { method: "DELETE" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to delete correspondence")
      toast.success("Correspondence deleted")
      setRecords((current) => current.filter((r) => r.id !== recordId))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to delete correspondence"))
    }
  }

  const columns = useMemo<DataTableColumn<CorrespondenceRecord>[]>(
    () => [
      {
        key: "reference_number",
        label: "Reference",
        sortable: true,
        accessor: (row) => row.reference_number,
        render: (row) => (
          <span className="font-mono text-xs font-medium whitespace-nowrap">
            {["approved", "sent", "filed"].includes(row.status) ? row.reference_number : "-"}
          </span>
        ),
      },
      {
        key: "letter_type",
        label: "Type",
        sortable: true,
        accessor: (row) => row.letter_type || "-",
        render: (row) => <Badge variant="outline">{row.letter_type || "-"}</Badge>,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department_name || row.assigned_department_name || "-",
        hideOnMobile: true,
        render: (row) => (
          <span
            className="block max-w-[180px] truncate"
            title={row.department_name || row.assigned_department_name || undefined}
          >
            {row.department_name || row.assigned_department_name || "-"}
          </span>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => <Badge className={statusBadgeClass(row.status)}>{statusLabel(row.status)}</Badge>,
      },
      {
        key: "subject",
        label: "Subject",
        sortable: true,
        accessor: (row) => row.subject,
        render: (row) => (
          <span className="block max-w-[260px] truncate font-normal xl:max-w-md" title={row.subject}>
            {row.subject}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const filters = useMemo<DataTableFilter<CorrespondenceRecord>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: Array.from(new Set(records.map((record) => record.status))).map((status) => ({
          value: status,
          label: status.replaceAll("_", " "),
        })),
      },
      {
        key: "letter_type",
        label: "Type",
        options: [
          { value: "internal", label: "Internal" },
          { value: "external", label: "External" },
        ],
        mode: "custom",
        filterFn: (row, selected) => selected.includes(row.letter_type || ""),
      },
    ],
    [records]
  )

  return (
    <DataTablePage
      title="Correspondence"
      description="Create and manage correspondence references."
      icon={FileCode2}
      backLink={{ href: "/profile", label: "Back to Home" }}
      actions={
        <>
          <CreateReferenceDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            form={form}
            onFormChange={setForm}
            onSubmit={createRecord}
            isSaving={isSaving}
            departmentCodes={departmentCodes}
            currentUserId={currentViewerId}
            currentUserName={currentViewerName}
          />
          <CreateReferenceDialog
            mode="edit"
            open={editOpen}
            onOpenChange={(open) => {
              setEditOpen(open)
              if (!open) setEditingRecord(null)
            }}
            form={editForm}
            onFormChange={setEditForm}
            onSubmit={updateRecord}
            isSaving={isSaving}
            departmentCodes={departmentCodes}
            currentUserId={currentViewerId}
          />
        </>
      }
      spacing="tight"
      actionsPlacement="inline-always"
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total References"
            value={stats.total}
            icon={FileCode2}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Open / In Review"
            value={stats.open}
            icon={CircleDot}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Approved"
            value={stats.closed}
            icon={Check}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Internal"
            value={stats.internal}
            icon={Mail}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<CorrespondenceRecord>
        data={records}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search reference, subject, recipient, or sender..."
        searchFn={(row, query) =>
          `${row.reference_number} ${row.subject} ${row.recipient_name || ""} ${row.sender_name || ""}`
            .toLowerCase()
            .includes(query)
        }
        mobileRow={{
          title: (row) => (
            <span className="font-mono text-xs font-bold">
              {["approved", "sent", "filed"].includes(row.status) ? row.reference_number : "Reference pending"}
            </span>
          ),
          subtitle: (row) => row.subject,
          trailing: (row) => (
            <Badge className={cn("text-[10px]", statusBadgeClass(row.status))}>{statusLabel(row.status)}</Badge>
          ),
          detail: {
            title: (row) =>
              ["approved", "sent", "filed"].includes(row.status) && row.reference_number
                ? row.reference_number
                : "Reference Pending",
            subtitle: (row) => (
              <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-1.5 text-xs">
                <Badge variant="outline" className="text-[10px] font-medium uppercase">
                  {row.letter_type || "external"}
                </Badge>
                {(row.department_name || row.assigned_department_name) && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="text-muted-foreground/70 h-3.5 w-3.5" />
                    <span>{row.department_name || row.assigned_department_name}</span>
                  </span>
                )}
              </div>
            ),
            badges: (row) => (
              <Badge className={cn("text-[10px]", statusBadgeClass(row.status))}>{statusLabel(row.status)}</Badge>
            ),
            fields: (row) => [
              // Restored from the old expandable row: the amber pill says the record
              // came back, this says what to do about it.
              ...(row.status === "returned_for_correction"
                ? [
                    {
                      icon: AlertTriangle,
                      label: "Returned for correction",
                      value: "Edit this record and resubmit it for review.",
                      copyable: false,
                    },
                  ]
                : []),
              { icon: FileCode2, label: "Subject", value: row.subject, copyable: true },
              {
                icon: User,
                label: "Recipient",
                value: row.recipient_name
                  ? `${row.recipient_name}${row.recipient_code ? ` (${row.recipient_code})` : ""}`
                  : null,
              },
              { icon: User, label: "Requested by", value: row.sender_name },
              ...(row.created_by_name && row.created_by_name !== row.sender_name
                ? [{ icon: User, label: "Created by", value: row.created_by_name }]
                : []),
              { icon: CalendarClock, label: "Due date", value: row.due_date, copyable: false },
              {
                icon: CircleDot,
                label: "Action required",
                value: row.action_required ? "Yes" : "No",
                copyable: false,
              },
              ...((row.metadata as Record<string, string> | null)?.notes
                ? [
                    {
                      icon: FileCode2,
                      label: "Notes",
                      value: (row.metadata as Record<string, string>).notes,
                      copyable: true,
                    },
                  ]
                : []),
            ],
            actions: (row) => [
              ...(EDITABLE_STATUSES.includes(row.status)
                ? [
                    {
                      label: "Edit",
                      variant: "outline" as const,
                      onClick: () => openEdit(row),
                    },
                    {
                      label: "Delete",
                      variant: "destructive" as const,
                      onClick: () => void deleteRecord(row.id),
                    },
                  ]
                : []),
            ],
          },
        }}
        pagination={{ pageSize: 25 }}
        stickyToolbar
        viewToggle
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        cardRenderer={(row) => (
          <div className="bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold">
                {["approved", "sent", "filed"].includes(row.status) ? row.reference_number : "Reference Pending"}
              </span>
              <Badge variant="outline" className="text-xs capitalize">
                {row.letter_type || "-"}
              </Badge>
            </div>
            <div>
              <h4 className="line-clamp-2 text-sm font-semibold">{row.subject}</h4>
              <p className="text-muted-foreground text-xs">
                {row.department_name || row.assigned_department_name || "-"}
              </p>
            </div>
            <div className="border-border/40 flex items-center justify-between border-t pt-2 text-xs">
              <span className="text-muted-foreground capitalize">{statusLabel(row.status)}</span>
              {row.due_date && <span className="text-muted-foreground font-mono">{row.due_date}</span>}
            </div>
          </div>
        )}
        rowActions={[
          {
            label: "Edit",
            onClick: (row) => openEdit(row),
            hidden: (row) => !EDITABLE_STATUSES.includes(row.status),
          },
          {
            label: "Delete",
            onClick: (row) => {
              void deleteRecord(row.id)
            },
            hidden: (row) => !EDITABLE_STATUSES.includes(row.status),
          },
        ]}
        emptyTitle="No references found"
        emptyDescription="No correspondence records match the current filters."
        emptyIcon={FileCode2}
        skeletonRows={6}
        urlSync
      />
    </DataTablePage>
  )
}
