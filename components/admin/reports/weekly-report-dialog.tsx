"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { fetchWeeklyReportLockState, type WeeklyReportLockState } from "@/lib/weekly-report-lock"
import { sanitizeReportText } from "@/lib/export-utils"
import { useAdminScopeOptional } from "@/components/admin-scope-context"
import { apiFetch } from "@/lib/api-client"

interface WeeklyReport {
  id: string
  department: string
  week_number: number
  year: number
  work_done: string
  tasks_new_week: string
  challenges: string
  status: string
  user_id: string
}

interface WeeklyReportAdminDialogProps {
  isOpen: boolean
  onClose: () => void
  report?: WeeklyReport | null
  onSuccess: () => void
  currentUser: {
    id: string
    role: string
    department: string | null
    is_department_lead: boolean
  }
}

const REPORT_TEXT_FIELDS = ["work_done", "tasks_new_week", "challenges"] as const
type ReportTextField = (typeof REPORT_TEXT_FIELDS)[number]

const autoNumberReportText = (text: string): string => {
  const lines = sanitizeReportText(String(text || ""))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^(?:\s*(?:\d+[.)]\s*|[-*]\s+))+/, "").trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return ""
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
}

const sanitizeReportTextForEditing = (text: string): string => {
  return sanitizeReportText(String(text || ""))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
}

function replaceSelectedText(
  current: string,
  insert: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
) {
  const start = selectionStart ?? current.length
  const end = selectionEnd ?? current.length
  return `${current.slice(0, start)}${insert}${current.slice(end)}`
}

export function WeeklyReportAdminDialog({
  isOpen,
  onClose,
  report,
  onSuccess,
  currentUser,
}: WeeklyReportAdminDialogProps) {
  const [loading, setLoading] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])
  const [isNextWeekActive, setIsNextWeekActive] = useState(false)
  const [lockState, setLockState] = useState<WeeklyReportLockState | null>(null)
  const [selectedExistingReportId, setSelectedExistingReportId] = useState<string | null>(report?.id || null)
  const currentOfficeWeek = getCurrentOfficeWeek()
  const [formData, setFormData] = useState({
    user_id: "",
    department: "",
    week_number: currentOfficeWeek.week,
    year: currentOfficeWeek.year,
    work_done: "",
    tasks_new_week: "",
    challenges: "",
    status: "submitted",
  })

  const [supabase] = useState(() => createClient())
  const adminScope = useAdminScopeOptional()
  const normalizedRole = (currentUser.role || "").trim().toLowerCase()
  const isAdminLikeRole =
    normalizedRole === "developer" || normalizedRole === "super_admin" || normalizedRole === "admin"
  const managedDepartments = useMemo(() => {
    if (adminScope) return adminScope.managedDepartments
    return !isAdminLikeRole && currentUser.department ? [currentUser.department] : []
  }, [adminScope, currentUser.department, isAdminLikeRole])

  // Restrict to managed departments only when the current admin view is truly lead-scoped.
  const isLeadScopedView = Boolean(
    adminScope
      ? adminScope.scopeMode === "lead" || (!adminScope.isAdminLike && adminScope.isDepartmentLead)
      : managedDepartments.length > 0
  )

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        if (isLeadScopedView) {
          setDepartments(managedDepartments)
          return
        }
        const response = await apiFetch("/api/departments", { cache: "no-store" })
        const payload = (await response.json().catch(() => null)) as {
          data?: Array<{ name?: string | null }>
          error?: string
        } | null
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load departments")
        }
        const uniqueDepts = Array.from(
          new Set((payload?.data || []).map((department) => department.name).filter(Boolean))
        ).sort()
        setDepartments(uniqueDepts as string[])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load departments")
      }
    }
    void fetchMetadata()
  }, [isLeadScopedView, managedDepartments])

  useEffect(() => {
    const fetchLockState = async () => {
      const state = await fetchWeeklyReportLockState(supabase, formData.week_number, formData.year)
      setLockState(state)
    }
    fetchLockState()
  }, [formData.week_number, formData.year, supabase])

  useEffect(() => {
    const fetchStatus = async () => {
      if (!formData.department) return

      // For "Add Report", prefer existing weekly report content for this dept/week/year.
      // If none exists, fall back to syncing tasks from action items.
      let hasExistingWeeklyReport = false
      if (!report) {
        const { data: existingReport } = await supabase
          .from("weekly_reports")
          .select("id, user_id, work_done, tasks_new_week, challenges, status")
          .eq("department", formData.department)
          .eq("week_number", formData.week_number)
          .eq("year", formData.year)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existingReport) {
          hasExistingWeeklyReport = true
          setSelectedExistingReportId(existingReport.id || null)
          setFormData((prev) => ({
            ...prev,
            user_id: existingReport.user_id || prev.user_id || currentUser.id || "",
            work_done: autoNumberReportText(existingReport.work_done || ""),
            tasks_new_week: autoNumberReportText(existingReport.tasks_new_week || ""),
            challenges: autoNumberReportText(existingReport.challenges || ""),
            status: existingReport.status || prev.status,
          }))
        } else {
          setSelectedExistingReportId(null)
          // Critical reset: moving to a week with no report should not keep stale text
          setFormData((prev) => ({
            ...prev,
            user_id: currentUser.id || prev.user_id || "",
            work_done: "",
            tasks_new_week: "",
            challenges: "",
            status: "submitted",
          }))
        }
      }

      // Report-derived items only: a management directive must never be folded
      // back into the department's "Tasks for New Week" text, nor decide whether
      // the next week is already active.
      const { data } = await supabase
        .from("action_items")
        .select("title, status")
        .eq("department", formData.department)
        .eq("week_number", formData.week_number)
        .eq("year", formData.year)
        .eq("origin", "weekly_report")

      if (data) {
        setIsNextWeekActive(data.some((a) => a.status !== "pending"))
        if (data.length > 0 && !report && !hasExistingWeeklyReport) {
          // Only auto-sync tasks from action items when there is no existing weekly report to mirror.
          const syncedText = data.map((a, i) => `${i + 1}. ${a.title}`).join("\n")
          setFormData((prev) => ({ ...prev, tasks_new_week: autoNumberReportText(syncedText) }))
        }
      }
    }
    fetchStatus()
  }, [currentUser.id, formData.department, formData.week_number, formData.year, report, supabase])

  useEffect(() => {
    if (report) {
      setSelectedExistingReportId(report.id)
      setFormData({
        user_id: report.user_id,
        department: isLeadScopedView ? currentUser.department || report.department : report.department,
        week_number: report.week_number,
        year: report.year,
        work_done: autoNumberReportText(report.work_done || ""),
        tasks_new_week: autoNumberReportText(report.tasks_new_week || ""),
        challenges: autoNumberReportText(report.challenges || ""),
        status: report.status || "submitted",
      })
    } else {
      setSelectedExistingReportId(null)
      setFormData((prev) => ({
        ...prev,
        user_id: currentUser.id || "",
        department: isLeadScopedView ? currentUser.department || "" : "",
        week_number: currentOfficeWeek.week,
        year: currentOfficeWeek.year,
        work_done: "",
        tasks_new_week: "",
        challenges: "",
      }))
    }
  }, [
    currentUser.department,
    currentUser.id,
    currentOfficeWeek.week,
    currentOfficeWeek.year,
    isLeadScopedView,
    report,
    isOpen,
  ])

  const isLockedForExistingReport = Boolean(lockState?.isLocked && selectedExistingReportId)

  const handleSubmit = async () => {
    const state = await fetchWeeklyReportLockState(supabase, formData.week_number, formData.year)
    setLockState(state)
    if (state.isLocked && selectedExistingReportId) {
      toast.error(
        "This report already exists and the grace window has closed. Only missing reports can still be created."
      )
      return
    }

    if (!formData.department || !formData.work_done) {
      toast.error("Required: Department and Work Done")
      return
    }
    setLoading(true)
    try {
      if (isLeadScopedView && report && report.user_id !== currentUser.id) {
        throw new Error("You can only edit reports you created")
      }

      const safeFormData = {
        id: report?.id || selectedExistingReportId || undefined,
        ...formData,
        user_id: isLeadScopedView ? currentUser.id : formData.user_id,
        department: isLeadScopedView ? currentUser.department || formData.department : formData.department,
        work_done: autoNumberReportText(formData.work_done),
        tasks_new_week: autoNumberReportText(formData.tasks_new_week),
        challenges: autoNumberReportText(formData.challenges),
      }

      const response = await apiFetch("/api/reports/weekly-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(safeFormData),
      })
      const raw = await response.text()
      let payload: { error?: string } = {}
      try {
        payload = raw ? (JSON.parse(raw) as { error?: string }) : {}
      } catch {
        payload = {}
      }
      if (!response.ok) throw new Error(payload.error || `Failed to save report (${response.status})`)

      toast.success(report ? "Updated" : "Saved")
      onSuccess()
      onClose()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save report")
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, field: ReportTextField) => {
    if (e.key === "Backspace") {
      const textarea = e.currentTarget
      const current = formData[field] as string
      if (textarea.selectionStart !== textarea.selectionEnd) return

      const caret = textarea.selectionStart ?? 0
      const lineStart = current.lastIndexOf("\n", Math.max(0, caret - 1)) + 1
      const beforeCaret = current.slice(lineStart, caret)

      if (/^\d+[.)]\s*$/.test(beforeCaret)) {
        e.preventDefault()
        const nextValue = `${current.slice(0, lineStart)}${current.slice(caret)}`
        setFormData((prev) => ({ ...prev, [field]: nextValue }))
        requestAnimationFrame(() => {
          textarea.selectionStart = lineStart
          textarea.selectionEnd = lineStart
        })
      }
      return
    }

    if (e.key === "Enter") {
      const textarea = e.currentTarget
      const val = formData[field] as string
      const caret = textarea.selectionStart ?? val.length
      const lineStart = val.lastIndexOf("\n", Math.max(0, caret - 1)) + 1
      const lineEndIndex = val.indexOf("\n", caret)
      const lineEnd = lineEndIndex === -1 ? val.length : lineEndIndex
      const currentLine = val.slice(lineStart, lineEnd)
      const match = currentLine.match(/^\s*(\d+)[\.\)]\s/)
      if (match) {
        e.preventDefault()
        const prefix = `\n${parseInt(match[1], 10) + 1}. `
        const nextValue = replaceSelectedText(val, prefix, textarea.selectionStart, textarea.selectionEnd)
        const nextCaret = caret + prefix.length
        setFormData((prev) => ({ ...prev, [field]: nextValue }))
        requestAnimationFrame(() => {
          textarea.selectionStart = nextCaret
          textarea.selectionEnd = nextCaret
        })
      }
    }
  }

  const handleTextChange = (field: ReportTextField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: sanitizeReportText(value) }))
  }

  const handleTextPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, field: ReportTextField) => {
    e.preventDefault()
    const pasted = sanitizeReportText(e.clipboardData.getData("text"))
    const current = (formData[field] as string) || ""
    const textarea = e.currentTarget
    const merged = replaceSelectedText(current, pasted, textarea.selectionStart, textarea.selectionEnd)
    const caret = (textarea.selectionStart ?? current.length) + pasted.length
    setFormData((prev) => ({ ...prev, [field]: merged }))
    requestAnimationFrame(() => {
      textarea.selectionStart = caret
      textarea.selectionEnd = caret
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {report ? "Edit Weekly Report" : "Create Weekly Report"}
            <Sparkles className="h-4 w-4 text-blue-500" />
          </DialogTitle>
          <DialogDescription>
            {report ? "Update this weekly report's details" : "Add a new departmental weekly report"}
          </DialogDescription>
          {isLockedForExistingReport && (
            <p className="text-destructive text-xs">
              Locked after meeting date {lockState?.meetingDate}. Editing is now closed for existing reports this week.
            </p>
          )}
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Department</Label>
              <SearchableSelect
                value={formData.department}
                onValueChange={(val) => setFormData((p) => ({ ...p, department: val }))}
                options={departments.map((d) => ({ value: d, label: d }))}
                placeholder="Select department"
                disabled={isLeadScopedView}
              />
            </div>
            <div className="space-y-2">
              <Label>Week / Year</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={formData.week_number}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, week_number: parseInt(e.target.value) || p.week_number }))
                  }
                  className="w-1/2"
                />
                <Input
                  type="number"
                  value={formData.year}
                  onChange={(e) => setFormData((p) => ({ ...p, year: parseInt(e.target.value) || p.year }))}
                  className="w-1/2"
                />
              </div>
            </div>
          </div>

          {REPORT_TEXT_FIELDS.map((f) => (
            <div key={f} className="space-y-2">
              <Label className="capitalize">
                {f.replace(/_/g, " ")}
                {f === "challenges" && (
                  <span className="text-muted-foreground ml-1 font-normal normal-case">(leave blank if none)</span>
                )}
              </Label>
              <Textarea
                value={formData[f]}
                onChange={(e) => handleTextChange(f, e.target.value)}
                onPaste={(e) => handleTextPaste(e, f)}
                onKeyDown={(e) => handleKey(e, f)}
                placeholder={f === "challenges" ? "Leave blank if there are no challenges" : `1. ...`}
                rows={4}
                disabled={f === "tasks_new_week" && isNextWeekActive}
              />
              {f === "tasks_new_week" && isNextWeekActive && (
                <p className="text-muted-foreground text-[10px] italic">
                  Locked: Next week&apos;s tracker already has activity.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || isLockedForExistingReport}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {report ? "Update Report" : "Create Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
