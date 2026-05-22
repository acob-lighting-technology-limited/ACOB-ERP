"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
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
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { REPORT_DOC_MAX_SIZE_BYTES, formatLimitMb } from "@/lib/reports/document-upload-limits"
import { buildMeetingDocumentFileName } from "@/lib/reports/meeting-date"
import {
  CalendarDays,
  Download,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Presentation,
  ShieldAlert,
  Trash2,
} from "lucide-react"

type Employee = {
  id: string
  full_name: string
  department: string | null
  employment_status?: string | null
}

type KssRosterEntry = {
  id: string
  meeting_week: number
  meeting_year: number
  department: string
  presenter_id: string | null
  presenter_name: string | null
  created_by: string | null
  notes: string | null
  created_at: string
  meeting_date?: string | null
  is_locked?: boolean
  is_outside_grace_window?: boolean
}

type KssDocument = {
  id: string
  meeting_week: number
  meeting_year: number
  meeting_date?: string | null
  document_type: "knowledge_sharing_session"
  department: string | null
  presenter_id: string | null
  presenter_name: string | null
  file_name: string
  mime_type?: string | null
  signed_url: string | null
  is_locked?: boolean
}

type KssResult = {
  id: string
  roster_id: string
  presenter_id: string
  evaluator_id: string
  score: number
  feedback: string | null
  meeting_week: number
  meeting_year: number
  created_at: string
  updated_at: string
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
type UploadPhase = "idle" | "saving" | "converting" | "uploading"
type PresenterType = "employee" | "visitor"

interface Props {
  employees: Employee[]
  backHref: string
  backLabel: string
  title?: string
  readOnly?: boolean
  currentUserId?: string
  currentUserRole?: string | null
  enableScoring?: boolean
}

function compareWeekYear(aWeek: number, aYear: number, bWeek: number, bYear: number): number {
  if (aYear !== bYear) return aYear - bYear
  return aWeek - bWeek
}

function getFileExtension(fileName: string, mimeType?: string | null): string {
  const lower = (fileName || "").toLowerCase()
  if (lower.endsWith(".pdf")) return "pdf"
  if (lower.endsWith(".pptx")) return "pptx"
  if (lower.endsWith(".ppt")) return "ppt"
  if (mimeType === "application/pdf") return "pdf"
  if (mimeType === "application/vnd.ms-powerpoint") return "ppt"
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx"
  return "pdf"
}

function formatMeetingDate(value?: string | null): string {
  if (!value) return "-"
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function KssRosterTable({
  employees,
  backHref,
  backLabel,
  title = "Knowledge Sharing Session",
  readOnly = false,
  currentUserId,
  currentUserRole,
  enableScoring = false,
}: Props) {
  const supabase = createClient()
  const currentOfficeWeek = getCurrentOfficeWeek()
  const defaultWeek = currentOfficeWeek.week
  const defaultYear = currentOfficeWeek.year

  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteRow, setPendingDeleteRow] = useState<KssRosterEntry | null>(null)
  const [scoringRow, setScoringRow] = useState<KssRosterEntry | null>(null)
  const [weekNumber, setWeekNumber] = useState(defaultWeek)
  const [yearNumber, setYearNumber] = useState(defaultYear)
  const [department, setDepartment] = useState("none")
  const [presenterType, setPresenterType] = useState<PresenterType>("employee")
  const [presenterId, setPresenterId] = useState("none")
  const [visitorPresenterName, setVisitorPresenterName] = useState("")
  const [notes, setNotes] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingScore, setSavingScore] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")
  const [scoreValue, setScoreValue] = useState("")
  const [scoreFeedback, setScoreFeedback] = useState("")

  const hasGraceOverride = currentUserRole === "developer" || currentUserRole === "super_admin"

  const weekOptions = useMemo(() => Array.from({ length: 53 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(
    () => [currentOfficeWeek.year - 1, currentOfficeWeek.year, currentOfficeWeek.year + 1, currentOfficeWeek.year + 2],
    [currentOfficeWeek.year]
  )

  const departments = useMemo(() => {
    return Array.from(new Set(employees.map((e) => e.department).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b)
    )
  }, [employees])

  const employeeNameById = useMemo(() => {
    return new Map(employees.map((e) => [e.id, e.full_name]))
  }, [employees])

  const {
    data: roster = [],
    refetch: refetchRoster,
    isLoading: isRosterLoading,
    error: rosterError,
  } = useQuery({
    queryKey: ["kss-roster-table"],
    queryFn: async (): Promise<KssRosterEntry[]> => {
      const res = await fetch("/api/reports/kss-roster")
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch KSS roster")
      return payload.data || []
    },
  })

  const {
    data: docs = [],
    refetch: refetchDocs,
    isLoading: isDocsLoading,
    error: docsError,
  } = useQuery({
    queryKey: ["kss-documents-table"],
    queryFn: async (): Promise<KssDocument[]> => {
      const res = await fetch(
        "/api/reports/meeting-week-documents?documentType=knowledge_sharing_session&currentOnly=true"
      )
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch KSS documents")
      return payload.data || []
    },
  })

  const { data: kssResults = [], refetch: refetchKssResults } = useQuery({
    queryKey: ["kss-results-table"],
    enabled: enableScoring && Boolean(currentUserId),
    queryFn: async (): Promise<KssResult[]> => {
      const res = await fetch("/api/reports/kss-results")
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch KSS scores")
      return payload.data || []
    },
  })

  const { data: selectedWeekLockState } = useQuery({
    queryKey: ["kss-selected-week-lock", weekNumber, yearNumber],
    enabled: !readOnly,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("weekly_report_lock_state", {
        p_week: weekNumber,
        p_year: yearNumber,
      })
      if (error) throw new Error(error.message)
      return Array.isArray(data) && data[0] ? Boolean(data[0].is_locked) : false
    },
  })

  const isSelectedWeekLocked = Boolean(selectedWeekLockState)
  const isHistoricalSelection =
    compareWeekYear(weekNumber, yearNumber, currentOfficeWeek.week, currentOfficeWeek.year) < 0
  const allowInactivePresentersForSelection = isHistoricalSelection || isSelectedWeekLocked
  const presenterOptions = useMemo(() => {
    if (department === "none") return []
    return employees
      .filter((e) => e.department === department)
      .filter(
        (e) =>
          allowInactivePresentersForSelection ||
          isAssignableEmploymentStatus(e.employment_status, { allowLegacyNullStatus: false })
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [allowInactivePresentersForSelection, department, employees])

  const getPresenterName = useCallback(
    (row: Pick<KssRosterEntry, "presenter_id" | "presenter_name">): string => {
      if (row.presenter_id) {
        return employeeNameById.get(row.presenter_id) || row.presenter_name || "Unknown"
      }
      return row.presenter_name || "-"
    },
    [employeeNameById]
  )

  const selectedWeekExistingRow = useMemo(
    () => roster.find((row) => row.meeting_week === weekNumber && row.meeting_year === yearNumber) || null,
    [roster, weekNumber, yearNumber]
  )

  const docByWeekYear = useMemo(() => {
    const map = new Map<string, KssDocument>()
    docs.forEach((d) => map.set(`${d.meeting_year}-${d.meeting_week}`, d))
    return map
  }, [docs])
  const selectedWeekDoc = docByWeekYear.get(`${yearNumber}-${weekNumber}`) || null
  const canUploadMissingForLockedWeek =
    isSelectedWeekLocked && Boolean(selectedWeekExistingRow) && !selectedWeekDoc && !readOnly
  const isFormLocked = Boolean(editingId)
    ? isSelectedWeekLocked && Boolean(selectedWeekDoc)
    : isSelectedWeekLocked && Boolean(selectedWeekExistingRow) && Boolean(selectedWeekDoc)

  useEffect(() => {
    if (!canUploadMissingForLockedWeek || !selectedWeekExistingRow || editingId) return
    setDepartment(selectedWeekExistingRow.department || "none")
    setPresenterType(selectedWeekExistingRow.presenter_id ? "employee" : "visitor")
    setPresenterId(selectedWeekExistingRow.presenter_id || "none")
    setVisitorPresenterName(selectedWeekExistingRow.presenter_name || "")
    setNotes(selectedWeekExistingRow.notes || "")
  }, [canUploadMissingForLockedWeek, selectedWeekExistingRow, editingId])

  const rows = useMemo(
    () => roster.sort((a, b) => compareWeekYear(b.meeting_week, b.meeting_year, a.meeting_week, a.meeting_year)),
    [roster]
  )

  const myScoresByRosterId = useMemo(() => {
    const map = new Map<string, KssResult>()
    if (!currentUserId) return map
    kssResults
      .filter((result) => result.evaluator_id === currentUserId)
      .forEach((result) => map.set(result.roster_id, result))
    return map
  }, [currentUserId, kssResults])

  const resetForm = () => {
    setWeekNumber(defaultWeek)
    setYearNumber(defaultYear)
    setDepartment("none")
    setPresenterType("employee")
    setPresenterId("none")
    setVisitorPresenterName("")
    setNotes("")
    setFile(null)
    setEditingId(null)
    setUploadPhase("idle")
  }

  const resetScoreForm = () => {
    setScoringRow(null)
    setScoreValue("")
    setScoreFeedback("")
  }

  const openScoreDialog = useCallback(
    (row: KssRosterEntry) => {
      const existingScore = myScoresByRosterId.get(row.id)
      setScoringRow(row)
      setScoreValue(existingScore ? String(existingScore.score) : "")
      setScoreFeedback(existingScore?.feedback || "")
    },
    [myScoresByRosterId]
  )

  const openEdit = useCallback(
    (row: KssRosterEntry) => {
      const doc = docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)
      if (row.is_locked && doc) {
        toast.error(`Week ${row.meeting_week}, ${row.meeting_year} is locked and can no longer be edited`)
        return
      }
      if (row.is_locked && !doc) {
        toast.info("This week is locked. You can only upload the missing KSS file.")
      }
      if (hasGraceOverride && row.is_outside_grace_window) {
        toast.info(
          `Override active: you are editing Week ${row.meeting_week}, ${row.meeting_year} outside the grace period.`
        )
      }
      setShowCreate(true)
      setEditingId(row.id)
      setWeekNumber(row.meeting_week)
      setYearNumber(row.meeting_year)
      setDepartment(row.department)
      setPresenterType(row.presenter_id ? "employee" : "visitor")
      setPresenterId(row.presenter_id || "none")
      setVisitorPresenterName(row.presenter_name || "")
      setNotes(row.notes || "")
      setFile(null)
    },
    [docByWeekYear, hasGraceOverride]
  )

  const handleSave = async () => {
    if (readOnly) {
      toast.error("You can only add or edit from Admin Reports.")
      return
    }
    if (isFormLocked) {
      toast.error(`Week ${weekNumber}, ${yearNumber} is locked and can no longer be changed`)
      return
    }
    if (file && file.size > REPORT_DOC_MAX_SIZE_BYTES) {
      toast.error(`File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}`)
      return
    }
    if (department === "none") {
      toast.error("Please select department")
      return
    }
    const normalizedVisitorName = visitorPresenterName.trim()
    const resolvedPresenterId = presenterType === "employee" ? presenterId : "none"
    const resolvedPresenterName = presenterType === "visitor" ? normalizedVisitorName : ""
    if (presenterType === "employee" && resolvedPresenterId === "none") {
      toast.error("Please select presenter")
      return
    }
    if (presenterType === "visitor" && !resolvedPresenterName) {
      toast.error("Please enter visitor presenter name")
      return
    }

    setSaving(true)
    setUploadPhase("saving")
    try {
      let savedRoster: {
        meeting_week: number
        meeting_year: number
        department?: string | null
        presenter_id?: string | null
        presenter_name?: string | null
      } | null = null

      const skipRosterWrite =
        isSelectedWeekLocked && !selectedWeekDoc && (Boolean(editingId) || canUploadMissingForLockedWeek)

      if (skipRosterWrite) {
        if (!selectedWeekExistingRow) {
          throw new Error("Unable to resolve existing roster row for locked week")
        }
        savedRoster = selectedWeekExistingRow
      } else {
        const rosterRes = await fetch("/api/reports/kss-roster", {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingId
              ? {
                  id: editingId,
                  department,
                  presenterId: resolvedPresenterId === "none" ? null : resolvedPresenterId,
                  presenterName: resolvedPresenterName || null,
                  notes: notes || null,
                }
              : {
                  meetingWeek: weekNumber,
                  meetingYear: yearNumber,
                  department,
                  presenterId: resolvedPresenterId === "none" ? null : resolvedPresenterId,
                  presenterName: resolvedPresenterName || null,
                  notes: notes || null,
                }
          ),
        })
        const rosterPayload = await rosterRes.json()
        if (!rosterRes.ok) throw new Error(rosterPayload.error || "Failed to save roster")
        savedRoster = rosterPayload.data
      }

      if (file) {
        const requiresConversion = [DOCX_MIME, PPTX_MIME].includes(file.type)
        const fd = new FormData()
        fd.append("file", file)
        fd.append("meetingWeek", String(savedRoster?.meeting_week || weekNumber))
        fd.append("meetingYear", String(savedRoster?.meeting_year || yearNumber))
        fd.append("documentType", "knowledge_sharing_session")
        fd.append("department", String(savedRoster?.department || department))
        const uploadPresenterId =
          savedRoster?.presenter_id || (resolvedPresenterId === "none" ? null : resolvedPresenterId)
        const uploadPresenterName = savedRoster?.presenter_name || resolvedPresenterName || null
        if (uploadPresenterId) fd.append("presenterId", String(uploadPresenterId))
        if (uploadPresenterName) fd.append("presenterName", String(uploadPresenterName))
        if (notes.trim()) fd.append("notes", notes.trim())

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

        const uploadRes = await fetch("/api/reports/meeting-week-documents", {
          method: "POST",
          body: fd,
        })
        if (phaseTimer) clearTimeout(phaseTimer)
        setUploadPhase("uploading")
        const uploadPayload = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadPayload.error || "Failed to upload KSS file")
        if (uploadPayload?.converted) {
          toast.success("KSS file uploaded and converted to PDF")
        }
      }

      if (!file || !["docx", "pptx"].includes(getFileExtension(file.name, file.type))) {
        toast.success(editingId ? "KSS updated" : "KSS created")
      }
      resetForm()
      setShowCreate(false)
      await Promise.all([refetchRoster(), refetchDocs()])
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save KSS")
    } finally {
      setSaving(false)
      setUploadPhase("idle")
    }
  }

  const handleDelete = async (row: KssRosterEntry) => {
    if (readOnly) {
      toast.error("You can only delete from Admin Reports.")
      return
    }
    if (row.is_locked) {
      toast.error(`Week ${row.meeting_week}, ${row.meeting_year} is locked and can no longer be changed`)
      return
    }
    try {
      const doc = docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)
      if (doc) {
        const docRes = await fetch(`/api/reports/meeting-week-documents?id=${doc.id}`, { method: "DELETE" })
        const docPayload = await docRes.json()
        if (!docRes.ok) throw new Error(docPayload.error || "Failed to delete KSS file")
      }

      const res = await fetch(`/api/reports/kss-roster?id=${row.id}`, { method: "DELETE" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to delete KSS roster")
      toast.success("KSS deleted")
      setPendingDeleteRow(null)
      await Promise.all([refetchRoster(), refetchDocs()])
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Delete failed")
    }
  }

  const handleSaveScore = async () => {
    if (!scoringRow) return

    const numericScore = Number(scoreValue)
    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
      toast.error("Score must be a number between 0 and 100")
      return
    }

    setSavingScore(true)
    try {
      const res = await fetch("/api/reports/kss-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roster_id: scoringRow.id,
          score: numericScore,
          feedback: scoreFeedback.trim() || null,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save KSS score")

      toast.success("KSS score submitted")
      resetScoreForm()
      await refetchKssResults()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save KSS score")
    } finally {
      setSavingScore(false)
    }
  }

  const buildDownloadName = (doc: KssDocument, row: KssRosterEntry, presenterName: string): string => {
    const ext = getFileExtension(doc.file_name, doc.mime_type)
    return buildMeetingDocumentFileName({
      documentType: "knowledge_sharing_session",
      meetingDate: doc.meeting_date || `${row.meeting_year}-01-01`,
      meetingWeek: row.meeting_week,
      extension: ext,
      department: row.department,
      presenterName: presenterName === "-" ? "Unknown Presenter" : presenterName,
    })
  }

  const handleDownload = useCallback(async (doc: KssDocument, row: KssRosterEntry, presenterName: string) => {
    if (!doc.signed_url) return
    const toastId = toast.loading("Preparing download...")
    try {
      const anchor = document.createElement("a")
      anchor.href = doc.signed_url
      anchor.download = buildDownloadName(doc, row, presenterName)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => {
        toast.dismiss(toastId)
      }, 6000)
    } catch (error: unknown) {
      toast.dismiss(toastId)
      toast.error(error instanceof Error ? error.message : "Failed to download file")
    }
  }, [])

  const saveLabel =
    uploadPhase === "converting"
      ? "Converting..."
      : uploadPhase === "uploading"
        ? "Uploading..."
        : uploadPhase === "saving"
          ? "Saving..."
          : editingId
            ? "Save Changes"
            : "Add KSS"

  const getTimeType = useCallback(
    (row: KssRosterEntry) => {
      const compare = compareWeekYear(
        row.meeting_week,
        row.meeting_year,
        currentOfficeWeek.week,
        currentOfficeWeek.year
      )
      if (compare === 0) return "current"
      if (compare < 0) return "past"
      return "upcoming"
    },
    [currentOfficeWeek.week, currentOfficeWeek.year]
  )

  const stats = useMemo(() => {
    const total = rows.length
    const current = rows.filter((row) => getTimeType(row) === "current").length
    const past = rows.filter((row) => getTimeType(row) === "past").length
    const upcoming = rows.filter((row) => getTimeType(row) === "upcoming").length

    return { total, current, past, upcoming }
  }, [getTimeType, rows])

  const departmentOptions = useMemo(
    () =>
      departments.map((dept) => ({
        value: dept,
        label: dept,
      })),
    [departments]
  )

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

  const timeTypeOptions = useMemo(
    () => [
      { value: "current", label: "Current" },
      { value: "past", label: "Past" },
      { value: "upcoming", label: "Upcoming" },
    ],
    []
  )

  const columns = useMemo<DataTableColumn<KssRosterEntry>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department,
        resizable: true,
        initialWidth: 200,
      },
      {
        key: "presenter",
        label: "Presenter",
        sortable: true,
        accessor: (row) => getPresenterName(row),
        render: (row) => getPresenterName(row),
      },
      {
        key: "meeting_date",
        label: "Meeting Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) =>
          row.meeting_date || docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)?.meeting_date || "",
        render: (row) =>
          formatMeetingDate(
            row.meeting_date || docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)?.meeting_date
          ),
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
        accessor: (row) => (row.created_by ? employeeNameById.get(row.created_by) || "Unknown" : "-"),
        render: (row) => (row.created_by ? employeeNameById.get(row.created_by) || "Unknown" : "-"),
      },
      {
        key: "created_at",
        label: "Submitted Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => row.created_at,
        resizable: true,
        initialWidth: 220,
        render: (row) =>
          new Date(row.created_at).toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
      },
    ],
    [docByWeekYear, employeeNameById, getPresenterName]
  )

  const filters = useMemo<DataTableFilter<KssRosterEntry>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
      },
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
        key: "time_type",
        label: "Time Type",
        mode: "custom",
        options: timeTypeOptions,
        multi: true,
        filterFn: (row, value) => {
          const timeType = getTimeType(row)
          if (Array.isArray(value)) {
            return value.includes(timeType)
          }
          return timeType === value
        },
      },
    ],
    [departmentOptions, getTimeType, timeTypeOptions, weekFilterOptions, yearFilterOptions]
  )

  const rowActions = useMemo(() => {
    const actions = []
    if (enableScoring && currentUserId) {
      actions.push({
        label: "Score",
        onClick: (row: KssRosterEntry) => {
          if (!row.presenter_id) {
            toast.error("Only employee presenters can be scored")
            return
          }
          if (row.presenter_id === currentUserId) {
            toast.error("You can only score another presenter")
            return
          }
          openScoreDialog(row)
        },
      })
    }
    if (!readOnly) {
      actions.push({
        label: "Edit",
        icon: Pencil,
        onClick: (row: KssRosterEntry) => {
          const doc = docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)
          if (row.is_locked && doc) {
            toast.error(`Week ${row.meeting_week}, ${row.meeting_year} is locked and can no longer be edited`)
            return
          }
          openEdit(row)
        },
      })
      actions.push({
        label: "Delete",
        icon: Trash2,
        variant: "destructive" as const,
        onClick: (row: KssRosterEntry) => {
          if (row.is_locked) {
            toast.error(`Week ${row.meeting_week}, ${row.meeting_year} is locked and can no longer be changed`)
            return
          }
          setPendingDeleteRow(row)
        },
      })
    }
    actions.push({
      label: "Download",
      icon: Download,
      onClick: (row: KssRosterEntry) => {
        const doc = docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)
        const presenterName = getPresenterName(row)
        if (!doc?.signed_url) {
          toast.error("No uploaded KSS file is available for this week")
          return
        }
        void handleDownload(doc, row, presenterName)
      },
    })
    return actions
  }, [
    currentUserId,
    docByWeekYear,
    enableScoring,
    getPresenterName,
    handleDownload,
    openEdit,
    openScoreDialog,
    readOnly,
  ])

  return (
    <DataTablePage
      title={title}
      description="Manage KSS roster and uploaded files by week."
      icon={Presentation}
      backLink={{ href: backHref, label: backLabel }}
      actions={
        readOnly ? null : (
          <Button
            onClick={() => {
              setEditingId(null)
              resetForm()
              setShowCreate(true)
            }}
            disabled={false}
          >
            <Plus className="mr-2 h-4 w-4" /> Add KSS
          </Button>
        )
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="KSS Rows"
            value={stats.total}
            icon={Presentation}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Current"
            value={stats.current}
            icon={CalendarDays}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Past"
            value={stats.past}
            icon={FileText}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Upcoming"
            value={stats.upcoming}
            icon={ShieldAlert}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <div className="space-y-4">
        <AlertDialog open={pendingDeleteRow !== null} onOpenChange={(open) => !open && setPendingDeleteRow(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete KSS entry?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDeleteRow
                  ? `This will delete the KSS entry for Week ${pendingDeleteRow.meeting_week}, ${pendingDeleteRow.meeting_year} and its linked document (if uploaded). This action cannot be undone.`
                  : "This action cannot be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingDeleteRow) handleDelete(pendingDeleteRow)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={showCreate}
          onOpenChange={(open) => {
            setShowCreate(open)
            if (!open) resetForm()
          }}
        >
          <DialogContent className="max-h-[90vh] w-[95vw] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit KSS" : "Add KSS"}</DialogTitle>
              <DialogDescription>
                Create upcoming KSS rows to auto-populate meeting reminder mail. Upload file now or later.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Week</Label>
                <Select
                  value={String(weekNumber)}
                  onValueChange={(v) => setWeekNumber(Number(v))}
                  disabled={Boolean(editingId) || isFormLocked}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weekOptions.map((w) => (
                      <SelectItem key={w} value={String(w)}>
                        Week {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Year</Label>
                <Select
                  value={String(yearNumber)}
                  onValueChange={(v) => setYearNumber(Number(v))}
                  disabled={Boolean(editingId) || isFormLocked}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={department}
                  onValueChange={(value) => {
                    setDepartment(value)
                    setPresenterId("none")
                  }}
                  disabled={isFormLocked || canUploadMissingForLockedWeek}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select department</SelectItem>
                    {departments.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Presenter Type</Label>
                <Select
                  value={presenterType}
                  onValueChange={(value: PresenterType) => {
                    setPresenterType(value)
                    setPresenterId("none")
                    setVisitorPresenterName("")
                  }}
                  disabled={isFormLocked || canUploadMissingForLockedWeek}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="visitor">Visitor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Presenter</Label>
                {presenterType === "employee" ? (
                  <Select
                    value={presenterId}
                    onValueChange={setPresenterId}
                    disabled={isFormLocked || canUploadMissingForLockedWeek || department === "none"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select presenter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select presenter</SelectItem>
                      {presenterOptions.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.full_name}
                          {!isAssignableEmploymentStatus(emp.employment_status, { allowLegacyNullStatus: false })
                            ? " (exited)"
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={visitorPresenterName}
                    onChange={(e) => setVisitorPresenterName(e.target.value)}
                    placeholder="Enter visitor full name"
                    disabled={isFormLocked || canUploadMissingForLockedWeek}
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  disabled={isFormLocked || canUploadMissingForLockedWeek}
                />
              </div>

              <div className="space-y-2">
                <Label>Upload PDF, PPTX, or DOCX</Label>
                <Input
                  type="file"
                  accept=".pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null
                    if (selected && selected.size > REPORT_DOC_MAX_SIZE_BYTES) {
                      toast.error(`File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}`)
                      e.currentTarget.value = ""
                      setFile(null)
                      return
                    }
                    if (selected?.type === PPTX_MIME || selected?.type === DOCX_MIME) {
                      toast.info("This file will be converted to PDF before it is stored.")
                    }
                    setFile(selected)
                  }}
                  disabled={isFormLocked}
                />
                <p className="text-muted-foreground text-xs">
                  Accepted: PDF, PPTX, DOCX. PPTX and DOCX uploads are converted to PDF before storage. Max file size:{" "}
                  {formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}
                </p>
                {isFormLocked ? (
                  <p className="text-muted-foreground text-xs">
                    This week is locked after the meeting grace window, so past KSS records are read-only.
                  </p>
                ) : null}
                {hasGraceOverride && editingId && isSelectedWeekLocked ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Override active: you are editing this KSS entry outside the normal grace period.
                  </p>
                ) : null}
                {canUploadMissingForLockedWeek ? (
                  <p className="text-muted-foreground text-xs">
                    This week is locked. You can only upload the missing KSS file for the existing roster entry.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button onClick={handleSave} disabled={saving || isFormLocked}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {saveLabel}
                  </>
                ) : (
                  saveLabel
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm()
                  setShowCreate(false)
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              {readOnly ? (
                <Button variant="secondary" asChild>
                  <Link href="/admin/reports/general-meeting/kss">Open Admin KSS</Link>
                </Button>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={scoringRow !== null}
          onOpenChange={(open) => {
            if (!open) resetScoreForm()
          }}
        >
          <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Score Presenter</DialogTitle>
              <DialogDescription>
                Submit your KSS evaluation for{" "}
                {scoringRow?.presenter_id
                  ? getPresenterName(scoringRow)
                  : scoringRow?.presenter_name || "this presenter"}
                .
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Week</Label>
                  <Input
                    value={scoringRow ? `Week ${scoringRow.meeting_week}, ${scoringRow.meeting_year}` : ""}
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Input value={scoringRow?.department || ""} disabled />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kss-score">Score (0 - 100)</Label>
                <Input
                  id="kss-score"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={scoreValue}
                  onChange={(e) => setScoreValue(e.target.value)}
                  placeholder="Enter score"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kss-feedback">Feedback</Label>
                <Textarea
                  id="kss-feedback"
                  value={scoreFeedback}
                  onChange={(e) => setScoreFeedback(e.target.value)}
                  placeholder="Optional feedback for the presenter"
                  maxLength={5000}
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveScore} disabled={savingScore}>
                  {savingScore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Submit Score"
                  )}
                </Button>
                <Button variant="outline" onClick={resetScoreForm} disabled={savingScore}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <DataTable<KssRosterEntry>
          data={rows}
          columns={columns}
          filters={filters}
          getRowId={(row) => row.id}
          searchPlaceholder="Search department, presenter, week, or year..."
          searchFn={(row, query) => {
            const normalizedQuery = query.toLowerCase()
            const presenterName = getPresenterName(row).toLowerCase()
            return (
              row.department.toLowerCase().includes(normalizedQuery) ||
              presenterName.includes(normalizedQuery) ||
              String(row.meeting_week).includes(normalizedQuery) ||
              String(row.meeting_year).includes(normalizedQuery)
            )
          }}
          isLoading={isRosterLoading || isDocsLoading}
          error={
            rosterError instanceof Error ? rosterError.message : docsError instanceof Error ? docsError.message : null
          }
          onRetry={() => {
            void Promise.all([refetchRoster(), refetchDocs()])
          }}
          rowActions={rowActions}
          expandable={{
            render: (row) => {
              const doc = docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)
              const presenterName = getPresenterName(row)
              const submittedBy = row.created_by ? employeeNameById.get(row.created_by) || "Unknown" : "-"
              return (
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">Presenter</p>
                    <p className="mt-2 text-sm">{presenterName}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">Submitted By</p>
                    <p className="mt-2 text-sm">{submittedBy}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">Notes</p>
                    <p className="mt-2 text-sm">{row.notes || "No notes added"}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">Document</p>
                    <p className="mt-2 text-sm">
                      {doc?.file_name || "No file uploaded"}
                      {hasGraceOverride && row.is_outside_grace_window ? " • Override used" : ""}
                    </p>
                    {enableScoring && myScoresByRosterId.has(row.id) ? (
                      <p className="mt-2 text-xs">{`My score: ${myScoresByRosterId.get(row.id)?.score ?? 0}`}</p>
                    ) : null}
                  </div>
                </div>
              )
            },
          }}
          viewToggle
          cardRenderer={(row) => {
            const presenterName = getPresenterName(row)
            const doc = docByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`)
            return (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.department}</p>
                    <p className="text-muted-foreground text-sm">{presenterName}</p>
                  </div>
                  <Badge variant="outline">{getTimeType(row)}</Badge>
                </div>
                <div className="grid gap-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Week</span>
                    <span>{`W${row.meeting_week} ${row.meeting_year}`}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">File</span>
                    <span>{doc ? "Uploaded" : "Pending"}</span>
                  </div>
                </div>
              </div>
            )
          }}
          emptyTitle="No KSS rows found"
          emptyDescription="No KSS rows matched the current filters."
          emptyIcon={Presentation}
          skeletonRows={5}
          urlSync
        />
      </div>
    </DataTablePage>
  )
}
