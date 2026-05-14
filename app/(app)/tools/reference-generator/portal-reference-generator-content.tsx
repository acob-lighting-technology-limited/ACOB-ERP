"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { FileCode2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import type { CorrespondenceRecord } from "@/types/correspondence"
import { CreateReferenceDialog, type CreateReferenceForm } from "@/components/correspondence/create-reference-dialog"
import { formatName } from "@/lib/utils"

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

const EDITABLE_STATUSES = ["under_review", "returned_for_correction", "rejected"]

export function PortalReferenceGeneratorContent({
  currentViewerName,
  currentViewerId,
  currentViewerDepartment,
  initialRecords,
  departmentCodes,
}: PortalReferenceGeneratorContentProps) {
  const statusLabel = (status: string) => (status === "under_review" ? "Sent for review" : formatName(status))

  const initialDepartment = departmentCodes.some((item) => item.department_name === currentViewerDepartment)
    ? currentViewerDepartment
    : ""

  const [records, setRecords] = useState<CorrespondenceRecord[]>(initialRecords)
  const [activeTab, setActiveTab] = useState<"internal" | "external">("internal")
  const [isSaving, setIsSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<CorrespondenceRecord | null>(null)

  const emptyForm: CreateReferenceForm = {
    department_name: initialDepartment,
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
      external: records.filter((record) => record.letter_type === "external").length,
    }),
    [records]
  )

  const tabs: DataTableTab[] = useMemo(
    () => [
      { key: "internal", label: `Internal (${stats.internal})` },
      { key: "external", label: `External (${stats.external})` },
    ],
    [stats.external, stats.internal]
  )

  const filteredRecords = useMemo(
    () =>
      records.filter((record) =>
        activeTab === "internal" ? record.letter_type === "internal" : record.letter_type === "external"
      ),
    [records, activeTab]
  )

  useEffect(() => {
    let active = true

    async function loadRecords() {
      const response = await fetch("/api/correspondence/records?page=1&limit=100&scope=mine", { cache: "no-store" })
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
    if (!form.subject.trim()) {
      toast.error("Subject is required")
      return
    }
    if (!form.department_name) {
      toast.error("Department is required")
      return
    }
    if (!form.recipient_code.trim()) {
      toast.error("Recipient Code is required")
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
        const catRes = await fetch("/api/correspondence/categories", {
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
      formPayload.append("recipient_name", form.recipient_name || "")
      formPayload.append("recipient_code", form.recipient_code.trim().toUpperCase())
      formPayload.append("originator_id", form.requester_id || currentViewerId)
      formPayload.append("action_required", String(form.action_required))
      formPayload.append("due_date", form.due_date)
      formPayload.append("metadata", JSON.stringify(metadata || {}))
      form.attachments.forEach((file) => formPayload.append("attachments", file))

      const response = await fetch("/api/correspondence/records", { method: "POST", body: formPayload })
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
      const isResubmit = editingRecord.status === "rejected"
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

      const res = await fetch(`/api/correspondence/records/${editingRecord.id}`, {
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
      const res = await fetch(`/api/correspondence/records/${recordId}`, { method: "DELETE" })
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
        resizable: true,
        initialWidth: 220,
        render: (row) => (
          <span className="font-medium">
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
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => <Badge>{statusLabel(row.status)}</Badge>,
      },
      {
        key: "subject",
        label: "Subject",
        sortable: true,
        accessor: (row) => row.subject,
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
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as "internal" | "external")}
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
            currentUserName={currentViewerName}
          />
        </>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total"
            value={stats.total}
            icon={FileCode2}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Open"
            value={stats.open}
            icon={FileCode2}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Approved"
            value={stats.closed}
            icon={FileCode2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Internal"
            value={stats.internal}
            icon={FileCode2}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<CorrespondenceRecord>
        data={filteredRecords}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search reference, subject, recipient, or sender..."
        searchFn={(row, query) =>
          `${row.reference_number} ${row.subject} ${row.recipient_name || ""} ${row.sender_name || ""}`
            .toLowerCase()
            .includes(query)
        }
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
        expandable={{
          render: (row) => (
            <div className="grid gap-3 md:grid-cols-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Recipient:</span> {row.recipient_name || "-"}
                {row.recipient_code ? ` (${row.recipient_code})` : ""}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Sender:</span> {row.sender_name || "-"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Due Date:</span> {row.due_date || "-"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Action Required:</span> {row.action_required ? "Yes" : "No"}
              </p>
              {row.status === "rejected" && (
                <p className="text-destructive text-sm md:col-span-2">
                  <span className="font-medium">Rejected</span> — you can edit and resubmit, or delete this record.
                </p>
              )}
            </div>
          ),
        }}
        emptyTitle="No references found"
        emptyDescription="No correspondence records match the current filters."
        emptyIcon={FileCode2}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
