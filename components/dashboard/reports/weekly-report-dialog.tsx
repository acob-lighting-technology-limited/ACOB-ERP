"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { fetchWeeklyReportLockState, type WeeklyReportLockState } from "@/lib/weekly-report-lock"
import { sanitizeReportText } from "@/lib/export-utils"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("dashboard-weekly-report-dialog")

interface WeeklyReportDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    week?: number
    year?: number
    dept?: string
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
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s+)/, "").trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return ""
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
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

export function WeeklyReportDialog({ isOpen, onClose, onSuccess, initialData }: WeeklyReportDialogProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isNextWeekActive, setIsNextWeekActive] = useState(false)
  const [lockState, setLockState] = useState<WeeklyReportLockState | null>(null)

  const [id, setId] = useState<string | null>(null)
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

  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    // Clear first so the form falls back to its locked-by-default state while the
    // new week resolves — otherwise the previous week's lock verdict stays applied
    // and briefly leaves a locked week editable.
    setLockState(null)
    const fetchLockState = async () => {
      const state = await fetchWeeklyReportLockState(supabase, formData.week_number, formData.year)
      if (!cancelled) setLockState(state)
    }
    void fetchLockState()
    return () => {
      cancelled = true
    }
  }, [formData.week_number, formData.year, supabase])

  const setupDialog = useCallback(async () => {
    setLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single()

      const week = initialData?.week || currentOfficeWeek.week
      const year = initialData?.year || currentOfficeWeek.year
      const dept = initialData?.dept || p?.department || ""

      // Fetch existing report
      const { data: existing } = await supabase
        .from("weekly_reports")
        .select("*")
        .eq("week_number", week)
        .eq("year", year)
        .eq("department", dept)
        .maybeSingle()

      setId(existing?.id || null)
      setFormData({
        user_id: user.id || "",
        department: dept,
        week_number: week,
        year: year,
        work_done: autoNumberReportText(existing?.work_done || ""),
        tasks_new_week: autoNumberReportText(existing?.tasks_new_week || ""),
        challenges: autoNumberReportText(existing?.challenges || ""),
        status: "submitted",
      })

      // Meta checks
      // Report-derived items only: a management directive must never be folded
      // back into the department's "Tasks for New Week" text, nor decide whether
      // the next week is already active.
      const { data: nextActions } = await supabase
        .from("action_items")
        .select("*")
        .eq("department", dept)
        .eq("week_number", week)
        .eq("year", year)
        .eq("origin", "weekly_report")
      if (nextActions) {
        setIsNextWeekActive(nextActions.some((a) => a.status !== "pending"))
        if (nextActions.length > 0 && !existing) {
          const syncedText = nextActions.map((a, i) => `${i + 1}. ${a.title}`).join("\n")
          setFormData((prev) => ({ ...prev, tasks_new_week: autoNumberReportText(syncedText) }))
        }
      }
    } catch (error) {
      log.error("Failed to load actions:", error)
    } finally {
      setLoading(false)
    }
  }, [currentOfficeWeek.week, currentOfficeWeek.year, initialData, supabase])

  useEffect(() => {
    if (isOpen) {
      void setupDialog()
    }
  }, [isOpen, setupDialog])

  const handleSubmit = async () => {
    const state = await fetchWeeklyReportLockState(supabase, formData.week_number, formData.year)
    setLockState(state)
    if (state.isLocked) {
      toast.error("This report week is locked. Contact admin for a temporary unlock.")
      return
    }

    if (!formData.work_done.trim()) {
      toast.error("Please describe work done")
      return
    }
    setSaving(true)
    try {
      const response = await apiFetch("/api/reports/weekly-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id || undefined,
          department: formData.department,
          week_number: formData.week_number,
          year: formData.year,
          work_done: autoNumberReportText(formData.work_done),
          tasks_new_week: autoNumberReportText(formData.tasks_new_week),
          challenges: autoNumberReportText(formData.challenges),
          status: formData.status,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || `Failed to submit report (${response.status})`)
      }
      toast.success("Success")
      onSuccess()
      onClose()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to submit report")
    } finally {
      setSaving(false)
    }
  }

  // Once the grace window has closed the week is read-only — block typing outright
  // instead of letting the user fill the form and fail at submit. Also treat the
  // pre-resolved state as locked so there is no editable gap while the RPC is in flight.
  const isWeekLocked = lockState === null || lockState.isLocked

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
      const match = currentLine.match(/^\s*(\d+)[.)]\s/)
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
            {id ? "Edit Weekly Report" : "Submit Weekly Report"}
            <Sparkles className="text-primary h-4 w-4" />
          </DialogTitle>
          <DialogDescription>
            Progress update for <span className="text-primary font-semibold">{formData.department}</span> — Week{" "}
            {formData.week_number}, {formData.year}
          </DialogDescription>
          {lockState?.isLocked && (
            <p className="text-destructive text-xs">
              Locked after meeting date {lockState.meetingDate}. This week is read-only — contact an admin for a
              temporary unlock.
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex h-[300px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="grid gap-6 py-4">
            {REPORT_TEXT_FIELDS.map((f) => (
              <div key={f} className="space-y-2">
                <Label className="capitalize">{f.replace(/_/g, " ")}</Label>
                <Textarea
                  value={formData[f]}
                  onChange={(e) => handleTextChange(f, e.target.value)}
                  onPaste={(e) => handleTextPaste(e, f)}
                  onKeyDown={(e) => handleKey(e, f)}
                  placeholder={`1. ...`}
                  rows={4}
                  readOnly={isWeekLocked}
                  disabled={isWeekLocked || (f === "tasks_new_week" && isNextWeekActive)}
                />
                {f === "tasks_new_week" && isNextWeekActive && !isWeekLocked && (
                  <p className="text-muted-foreground text-[10px] italic">
                    Locked: Next week&apos;s tracker is already active.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || loading || isWeekLocked}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {id ? "Update Report" : "Submit Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
