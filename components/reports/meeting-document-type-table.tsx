"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertCircle, CalendarDays, Download, FileText, Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { buildMeetingDocumentFileName } from "@/lib/reports/meeting-date"
import { REPORT_DOC_MAX_SIZE_BYTES, formatLimitMb } from "@/lib/reports/document-upload-limits"
import { apiFetch } from "@/lib/api-client"

type DocumentType = "minutes"

type MeetingDocument = {
  id: string
  meeting_week: number
  meeting_year: number
  meeting_date?: string | null
  document_type: DocumentType
  file_name: string
  signed_url: string | null
  created_at: string
  uploaded_by?: string | null
  is_locked?: boolean
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
type UploadPhase = "idle" | "converting" | "uploading"

interface Props {
  documentType: DocumentType
  title: string
  description: string
  backHref: string
  backLabel: string
  readOnly?: boolean
}

function compareWeekYear(aWeek: number, aYear: number, bWeek: number, bYear: number): number {
  if (aYear !== bYear) return aYear - bYear
  return aWeek - bWeek
}

function formatMeetingDate(value?: string | null): string {
  if (!value) return "-"
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return "-"
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function formatSubmittedDate(value: string): string {
  return formatWATDateTime(value, { day: "2-digit", month: "short", year: "numeric" })
}

export function MeetingDocumentTypeTable({
  documentType,
  title,
  description,
  backHref,
  backLabel,
  readOnly = false,
}: Props) {
  const supabase = createClient()
  const officeWeek = getCurrentOfficeWeek()
  const [showCreate, setShowCreate] = useState(false)
  const [editingDoc, setEditingDoc] = useState<MeetingDocument | null>(null)
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<MeetingDocument | null>(null)
  const [isDeletingDoc, setIsDeletingDoc] = useState(false)
  const [weekNumber, setWeekNumber] = useState(officeWeek.week)
  const [yearNumber, setYearNumber] = useState(officeWeek.year)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")

  const weekOptions = useMemo(() => Array.from({ length: 53 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(
    () => [officeWeek.year - 1, officeWeek.year, officeWeek.year + 1, officeWeek.year + 2],
    [officeWeek.year]
  )

  const {
    data: rows = [],
    refetch,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["meeting-doc-table", documentType],
    queryFn: async (): Promise<MeetingDocument[]> => {
      const response = await apiFetch(
        `/api/reports/meeting-week-documents?documentType=${documentType}&currentOnly=true`
      )
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to fetch documents")
      return payload.data || []
    },
  })

  const { data: selectedWeekLockState } = useQuery({
    queryKey: ["meeting-doc-selected-week-lock", documentType, weekNumber, yearNumber],
    enabled: !readOnly,
    queryFn: async () => {
      const { data, error: lockError } = await supabase.rpc("weekly_report_lock_state", {
        p_week: weekNumber,
        p_year: yearNumber,
      })
      if (lockError) throw new Error(lockError.message)
      return Array.isArray(data) && data[0] ? Boolean(data[0].is_locked) : false
    },
  })

  const uploadedByIds = useMemo(
    () => Array.from(new Set(rows.map((row) => row.uploaded_by).filter((value): value is string => Boolean(value)))),
    [rows]
  )

  const { data: uploadedByNameMap = new Map<string, string>() } = useQuery({
    queryKey: ["meeting-doc-uploaded-by", uploadedByIds],
    enabled: uploadedByIds.length > 0,
    queryFn: async () => {
      const { data, error: uploadedByError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", uploadedByIds)
      if (uploadedByError) throw new Error(uploadedByError.message)
      return new Map((data || []).map((row) => [String(row.id), String(row.full_name || "Unknown")]))
    },
  })

  const availableRows = useMemo(
    () =>
      rows
        .filter((row) => compareWeekYear(row.meeting_week, row.meeting_year, officeWeek.week, officeWeek.year) <= 0)
        .sort((a, b) => {
          if (a.meeting_year !== b.meeting_year) return b.meeting_year - a.meeting_year
          return b.meeting_week - a.meeting_week
        }),
    [officeWeek.week, officeWeek.year, rows]
  )

  const isSelectedWeekLocked = Boolean(selectedWeekLockState)
  const selectedWeekExistingRow = useMemo(
    () => rows.find((row) => row.meeting_week === weekNumber && row.meeting_year === yearNumber) || null,
    [rows, weekNumber, yearNumber]
  )
  const isCreateBlockedForSelectedWeek = !editingDoc && isSelectedWeekLocked && Boolean(selectedWeekExistingRow)

  const weekFilterOptions = useMemo(
    () =>
      weekOptions.map((week) => ({
        value: String(week),
        label: `Week ${week}`,
      })),
    [weekOptions]
  )

  const yearFilterOptions = useMemo(
    () =>
      yearOptions.map((year) => ({
        value: String(year),
        label: String(year),
      })),
    [yearOptions]
  )

  const lockFilterOptions = useMemo(
    () => [
      { value: "open", label: "Open" },
      { value: "locked", label: "Locked" },
    ],
    []
  )

  const stats = useMemo(() => {
    const total = availableRows.length
    const locked = availableRows.filter((row) => Boolean(row.is_locked)).length
    const downloadable = availableRows.filter((row) => Boolean(row.signed_url)).length
    const currentYear = availableRows.filter((row) => row.meeting_year === officeWeek.year).length

    return { total, locked, downloadable, currentYear }
  }, [availableRows, officeWeek.year])

  const upload = async () => {
    if (readOnly) {
      toast.error("You can only upload from Admin Reports.")
      return
    }
    if (!file) {
      toast.error("Please select a PDF or DOCX file")
      return
    }
    if (file.size > REPORT_DOC_MAX_SIZE_BYTES) {
      toast.error(`File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}`)
      return
    }
    if (editingDoc ? isSelectedWeekLocked : isCreateBlockedForSelectedWeek) {
      toast.error(`Week ${weekNumber}, ${yearNumber} is locked and can no longer be changed`)
      return
    }

    setSaving(true)
    try {
      const requiresConversion = file.type === DOCX_MIME
      const formData = new FormData()
      formData.append("file", file)
      formData.append("meetingWeek", String(weekNumber))
      formData.append("meetingYear", String(yearNumber))
      formData.append("documentType", documentType)

      if (requiresConversion) {
        setUploadPhase("converting")
      } else {
        setUploadPhase("uploading")
      }

      let phaseTimer: ReturnType<typeof setTimeout> | null = null
      if (requiresConversion) {
        phaseTimer = setTimeout(() => {
          setUploadPhase("uploading")
        }, 1200)
      }

      const response = await apiFetch("/api/reports/meeting-week-documents", { method: "POST", body: formData })
      if (phaseTimer) clearTimeout(phaseTimer)
      setUploadPhase("uploading")
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Upload failed")

      toast.success(payload?.converted ? "Document uploaded and converted to PDF" : "Document uploaded")
      setShowCreate(false)
      setEditingDoc(null)
      setFile(null)
      await refetch()
    } catch (uploadError: unknown) {
      toast.error(uploadError instanceof Error ? uploadError.message : "Upload failed")
    } finally {
      setSaving(false)
      setUploadPhase("idle")
    }
  }

  const uploadLabel =
    uploadPhase === "converting" ? "Converting..." : uploadPhase === "uploading" ? "Uploading..." : "Upload"

  const remove = async (id: string) => {
    if (readOnly) {
      toast.error("You can only delete from Admin Reports.")
      return
    }
    const target = rows.find((row) => row.id === id)
    if (target?.is_locked) {
      toast.error(
        `Week ${target.meeting_week ?? weekNumber}, ${target.meeting_year ?? yearNumber} is locked and can no longer be changed`
      )
      return
    }
    try {
      const response = await apiFetch(`/api/reports/meeting-week-documents?id=${id}`, { method: "DELETE" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Delete failed")
      toast.success("Document deleted")
      setPendingDeleteDoc(null)
      await refetch()
    } catch (removeError: unknown) {
      toast.error(removeError instanceof Error ? removeError.message : "Delete failed")
    }
  }

  const handleDownload = async (row: MeetingDocument) => {
    if (!row.signed_url) return
    const toastId = toast.loading("Preparing download...")
    try {
      const anchor = document.createElement("a")
      anchor.href = row.signed_url
      anchor.download = buildMeetingDocumentFileName({
        documentType: row.document_type,
        meetingDate: row.meeting_date || `${row.meeting_year}-01-01`,
        meetingWeek: row.meeting_week,
        extension: "pdf",
      })
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => {
        toast.dismiss(toastId)
      }, 6000)
    } catch (downloadError: unknown) {
      toast.dismiss(toastId)
      toast.error(downloadError instanceof Error ? downloadError.message : "Download failed")
    }
  }

  const openEdit = (row: MeetingDocument) => {
    if (row.is_locked) {
      toast.error(`Week ${row.meeting_week}, ${row.meeting_year} is locked and can no longer be edited`)
      return
    }
    setEditingDoc(row)
    setWeekNumber(row.meeting_week)
    setYearNumber(row.meeting_year)
    setFile(null)
    setUploadPhase("idle")
    setShowCreate(true)
  }

  const columns = useMemo<DataTableColumn<MeetingDocument>[]>(
    () => [
      {
        key: "meeting_date",
        label: "Meeting Date",
        sortable: true,
        accessor: (row) => row.meeting_date || "",
        render: (row) => formatMeetingDate(row.meeting_date),
      },
      {
        key: "meeting_week",
        label: "Week",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => row.meeting_week,
        render: (row) => <span className="font-medium">{`W${row.meeting_week}`}</span>,
      },
      {
        key: "meeting_year",
        label: "Year",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => row.meeting_year,
      },
      {
        key: "submitted_by",
        label: "Submitted By",
        hideOnMobile: true,
        accessor: (row) => (row.uploaded_by ? uploadedByNameMap.get(row.uploaded_by) || "-" : "-"),
        render: (row) => (row.uploaded_by ? uploadedByNameMap.get(row.uploaded_by) || "-" : "-"),
      },
      {
        key: "created_at",
        label: "Submitted Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => row.created_at,
        resizable: true,
        initialWidth: 220,
        render: (row) => formatSubmittedDate(row.created_at),
      },
      {
        key: "lock_status",
        label: "Status",
        accessor: (row) => (row.is_locked ? "locked" : "open"),
        render: (row) => (
          <Badge variant={row.is_locked ? "secondary" : "outline"}>{row.is_locked ? "Locked" : "Open"}</Badge>
        ),
      },
    ],
    [uploadedByNameMap]
  )

  const filters = useMemo<DataTableFilter<MeetingDocument>[]>(
    () => [
      {
        key: "meeting_week",
        label: "Week",
        options: weekFilterOptions,
      },
      {
        key: "meeting_year",
        label: "Year",
        options: yearFilterOptions,
      },
      {
        key: "lock_status",
        label: "Status",
        options: lockFilterOptions,
      },
    ],
    [lockFilterOptions, weekFilterOptions, yearFilterOptions]
  )

  const rowActions = useMemo(() => {
    const actions = []
    if (!readOnly) {
      actions.push({
        label: "Edit",
        icon: Pencil,
        onClick: (row: MeetingDocument) => openEdit(row),
      })
      actions.push({
        label: "Delete",
        icon: Trash2,
        variant: "destructive" as const,
        onClick: (row: MeetingDocument) => {
          if (row.is_locked) {
            toast.error(`Week ${row.meeting_week}, ${row.meeting_year} is locked and can no longer be deleted`)
            return
          }
          setPendingDeleteDoc(row)
        },
      })
    }
    actions.push({
      label: "Download",
      icon: Download,
      onClick: (row: MeetingDocument) => {
        if (!row.signed_url) {
          toast.error("No downloadable file is available for this record")
          return
        }
        void handleDownload(row)
      },
    })
    return actions
  }, [readOnly])

  return (
    <DataTablePage
      title={title}
      description={description}
      icon={FileText}
      backLink={{ href: backHref, label: backLabel }}
      actions={
        readOnly ? null : (
          <Button
            onClick={() => {
              setEditingDoc(null)
              setWeekNumber(officeWeek.week)
              setYearNumber(officeWeek.year)
              setFile(null)
              setUploadPhase("idle")
              setShowCreate(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Documents"
            value={stats.total}
            icon={FileText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Locked"
            value={stats.locked}
            icon={Lock}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Downloadable"
            value={stats.downloadable}
            icon={Download}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="This Year"
            value={stats.currentYear}
            icon={CalendarDays}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <AlertDialog
        open={pendingDeleteDoc !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingDoc) setPendingDeleteDoc(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteDoc
                ? `Delete ${pendingDeleteDoc.document_type.replace("_", " ")} for Week ${pendingDeleteDoc.meeting_week}, ${pendingDeleteDoc.meeting_year}. This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingDoc}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isDeletingDoc}
              onClick={async () => {
                if (pendingDeleteDoc) {
                  setIsDeletingDoc(true)
                  try {
                    await remove(pendingDeleteDoc.id)
                  } finally {
                    setIsDeletingDoc(false)
                  }
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open)
          if (!open) {
            setEditingDoc(null)
            setWeekNumber(officeWeek.week)
            setYearNumber(officeWeek.year)
            setFile(null)
            setUploadPhase("idle")
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingDoc ? `Edit ${title}` : title}</DialogTitle>
            <DialogDescription>Upload a PDF or DOCX. DOCX files are converted to PDF before storage.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Week</Label>
              <Select
                value={String(weekNumber)}
                onValueChange={(value) => setWeekNumber(Number(value))}
                disabled={Boolean(editingDoc)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekOptions.map((week) => (
                    <SelectItem key={week} value={String(week)}>
                      Week {week}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Year</Label>
              <Select
                value={String(yearNumber)}
                onValueChange={(value) => setYearNumber(Number(value))}
                disabled={Boolean(editingDoc)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Upload PDF or DOCX</Label>
              <Input
                type="file"
                accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  const selected = event.target.files?.[0] || null
                  if (selected && selected.size > REPORT_DOC_MAX_SIZE_BYTES) {
                    toast.error(`File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}`)
                    event.currentTarget.value = ""
                    setFile(null)
                    return
                  }
                  if (selected?.type === DOCX_MIME) {
                    toast.info("This DOCX file will be converted to PDF before it is stored.")
                  }
                  setFile(selected)
                }}
                disabled={editingDoc ? isSelectedWeekLocked : isCreateBlockedForSelectedWeek}
              />
              <p className="text-muted-foreground text-xs">
                Accepted: PDF, DOCX. DOCX uploads are converted to PDF before storage. Max file size:{" "}
                {formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}
              </p>
              {editingDoc && isSelectedWeekLocked ? (
                <p className="text-muted-foreground text-xs">
                  This week is locked after the meeting grace window, so past records are read-only.
                </p>
              ) : null}
              {!editingDoc && isCreateBlockedForSelectedWeek ? (
                <p className="text-muted-foreground text-xs">
                  This week is locked and already has a document, so only download is allowed.
                </p>
              ) : null}
              {!editingDoc && isSelectedWeekLocked && !selectedWeekExistingRow ? (
                <p className="text-muted-foreground text-xs">
                  This week is locked, but first-time upload is still allowed because no document exists yet.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => {
                void upload()
              }}
              disabled={saving || (editingDoc ? isSelectedWeekLocked : isCreateBlockedForSelectedWeek)}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadLabel}
                </>
              ) : (
                uploadLabel
              )}
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={saving}>
              Cancel
            </Button>
            {readOnly ? (
              <Button variant="secondary" asChild>
                <Link href="/admin/reports/general-meeting/minutes-of-meeting">Open Admin Reports</Link>
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <DataTable<MeetingDocument>
        data={availableRows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search by file name, week, or year..."
        searchFn={(row, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            row.file_name.toLowerCase().includes(normalizedQuery) ||
            String(row.meeting_week).includes(normalizedQuery) ||
            String(row.meeting_year).includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={rowActions}
        expandable={{
          render: (row) => {
            const submittedBy =
              row.uploaded_by && uploadedByNameMap.has(row.uploaded_by) ? uploadedByNameMap.get(row.uploaded_by) : "-"

            return (
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">File Name</p>
                  <p className="mt-2 text-sm break-words">{row.file_name}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Meeting Date</p>
                  <p className="mt-2 text-sm">{formatMeetingDate(row.meeting_date)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Submitted By</p>
                  <p className="mt-2 text-sm">{submittedBy}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Status</p>
                  <p className="mt-2 text-sm">{row.is_locked ? "Locked after grace period" : "Editable"}</p>
                </div>
              </div>
            )
          },
        }}
        viewToggle
        cardRenderer={(row) => {
          const submittedBy =
            row.uploaded_by && uploadedByNameMap.has(row.uploaded_by) ? uploadedByNameMap.get(row.uploaded_by) : "-"

          return (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{`W${row.meeting_week} ${row.meeting_year}`}</p>
                  <p className="text-muted-foreground text-sm">{formatMeetingDate(row.meeting_date)}</p>
                </div>
                <Badge variant={row.is_locked ? "secondary" : "outline"}>{row.is_locked ? "Locked" : "Open"}</Badge>
              </div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted By</span>
                  <span>{submittedBy}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span>{formatSubmittedDate(row.created_at)}</span>
                </div>
              </div>
            </div>
          )
        }}
        emptyTitle="No documents found"
        emptyDescription="No meeting documents matched the current filters."
        emptyIcon={AlertCircle}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
