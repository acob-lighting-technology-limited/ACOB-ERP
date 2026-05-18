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

const log = logger("portal-weekly-report-dialog")

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
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s+|[-*]\s+)/, "").trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return ""
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
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
    const fetchLockState = async () => {
      const state = await fetchWeeklyReportLockState(supabase, formData.week_number, formData.year)
      setLockState(state)
    }
    fetchLockState()
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
      const { data: nextActions } = await supabase
        .from("action_items")
        .select("*")
        .eq("department", dept)
        .eq("week_number", week)
        .eq("year", year)
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
      const { data: savedReport, error: reportError } = await supabase
        .from("weekly_reports")
        .upsert(formData, { onConflict: "department,week_number,year" })
        .select("id")
        .single()
      if (reportError) throw reportError
      void savedReport
      toast.success("Success")
      onSuccess()
      onClose()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to submit report")
    } finally {
      setSaving(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent, field: ReportTextField) => {
    if (e.key === "Enter") {
      const val = formData[field] as string
      const last = val.split("\n").pop() || ""
      const match = last.match(/^(\d+)[\.\)]\s/)
      if (match) {
        e.preventDefault()
        setFormData((p) => ({ ...p, [field]: val + "\n" + (parseInt(match[1]) + 1) + ". " }))
      }
    }
  }

  const handleTextChange = (field: ReportTextField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: autoNumberReportText(value) }))
  }

  const handleTextPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, field: ReportTextField) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text")
    const current = (formData[field] as string) || ""
    const start = e.currentTarget.selectionStart ?? current.length
    const end = e.currentTarget.selectionEnd ?? current.length
    const merged = `${current.slice(0, start)}${pasted}${current.slice(end)}`
    setFormData((prev) => ({ ...prev, [field]: autoNumberReportText(merged) }))
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
              Locked after meeting date {lockState.meetingDate}. Editing is now closed for this week.
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
                  disabled={f === "tasks_new_week" && isNextWeekActive}
                />
                {f === "tasks_new_week" && isNextWeekActive && (
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
          <Button onClick={handleSubmit} disabled={saving || loading || !!lockState?.isLocked}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {id ? "Update Report" : "Submit Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
