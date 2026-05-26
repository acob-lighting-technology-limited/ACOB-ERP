"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { toast } from "sonner"
import { PageWrapper, PageHeader } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Mail,
  Send,
  Clock,
  Users,
  UserPlus,
  FileText,
  ClipboardList,
  X,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  CalendarDays,
  Repeat,
  Trash2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { toLocalISODate, formatWATDateTime } from "@/lib/utils/date"

type Employee = {
  id: string
  full_name: string
  company_email: string | null
  additional_email: string | null
  department: string | null
  employment_status: string | null
}

type RecipientMode = "all" | "select" | "manual" | "all_plus"
type ContentChoice = "both" | "weekly_report" | "action_tracker" | "manual_upload"
type SendTiming = "now" | "scheduled" | "recurring"
const MAX_PDF_BYTES = 1 * 1024 * 1024

type ManualAttachmentKind = "weekly_report" | "action_tracker"
type ManualAttachmentState = {
  file: File | null
  base64: string
}

type DigestSchedule = {
  id: string
  schedule_type: "one_time" | "recurring"
  meeting_week: number | null
  next_run_at: string
  send_day: string | null
  send_time: string | null
  recipients: string[] | null
}

type DigestDeliveryResult = {
  to: string
  success: boolean
  error?: string
}

type DigestSendResponse = {
  results?: DigestDeliveryResult[]
}

interface Props {
  employees: Employee[]
  currentUser?: {
    id: string
    full_name: string | null
    department: string | null
  }
}

export function MailDigestContent({ employees, currentUser }: Props) {
  const supabase = createClient()
  const currentOfficeWeek = getCurrentOfficeWeek()

  // ── State ──────────────────────────────────────────────────────────────────
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("select")
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())
  const [manualEmails, setManualEmails] = useState<string[]>([])
  const [manualInput, setManualInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const [contentChoice, setContentChoice] = useState<ContentChoice>("both")
  const [manualWeeklyReport, setManualWeeklyReport] = useState<ManualAttachmentState>({ file: null, base64: "" })
  const [manualActionTracker, setManualActionTracker] = useState<ManualAttachmentState>({ file: null, base64: "" })
  const [selectedPreparedBy, setSelectedPreparedBy] = useState("ACOB Team")

  const currentYear = currentOfficeWeek.year
  const currentWeekNumber = currentOfficeWeek.week
  // Default = CURRENT week (the meeting week)
  const [weekNumber, setWeekNumber] = useState(currentWeekNumber)
  const [yearNumber, setYearNumber] = useState(currentYear)

  const [sendTiming, setSendTiming] = useState<SendTiming>("now")
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("09:00")
  const [recurringDay, setRecurringDay] = useState("monday")
  const [recurringTime, setRecurringTime] = useState("09:00")

  const [isSending, setIsSending] = useState(false)
  const [sendResult, setSendResult] = useState<DigestSendResponse | null>(null)

  // Active schedules from DB
  const [activeSchedules, setActiveSchedules] = useState<DigestSchedule[]>([])

  // ── Fetch active schedules ──────────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("digest_schedules")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
      if (!error && data) setActiveSchedules(data as DigestSchedule[])
    } catch {
      /* ignore */
    }
  }, [supabase])

  useEffect(() => {
    fetchSchedules()
  }, [fetchSchedules])

  // ── Computed ────────────────────────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees
    const q = searchQuery.toLowerCase()
    return employees.filter(
      (e) =>
        e.full_name?.toLowerCase().includes(q) ||
        e.company_email?.toLowerCase().includes(q) ||
        e.additional_email?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q)
    )
  }, [employees, searchQuery])

  const resolvedRecipients = useMemo(() => {
    const emailSet = new Set<string>()
    if (recipientMode === "all" || recipientMode === "all_plus") {
      employees.forEach((e) => {
        if (e.company_email) emailSet.add(e.company_email.toLowerCase())
        if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
      })
    } else if (recipientMode === "select") {
      employees.forEach((e) => {
        if (selectedEmployeeIds.has(e.id)) {
          if (e.company_email) emailSet.add(e.company_email.toLowerCase())
          if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
        }
      })
    }
    if (recipientMode === "manual" || recipientMode === "all_plus") {
      manualEmails.forEach((m) => {
        emailSet.add(m.toLowerCase())
      })
    }
    return Array.from(emailSet)
  }, [recipientMode, employees, selectedEmployeeIds, manualEmails])

  const preparedByOptions = useMemo(() => {
    return employees
      .map((e) => e.full_name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  }, [employees])

  useEffect(() => {
    if (preparedByOptions.length === 0) {
      setSelectedPreparedBy("ACOB Team")
      return
    }

    const currentName = (currentUser?.full_name || "").trim()
    const preferredName = currentName && preparedByOptions.includes(currentName) ? currentName : preparedByOptions[0]

    if (!selectedPreparedBy || !preparedByOptions.includes(selectedPreparedBy)) {
      setSelectedPreparedBy(preferredName)
    }
  }, [preparedByOptions, currentUser?.full_name, selectedPreparedBy])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleEmployee = useCallback((id: string) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedEmployeeIds(new Set(employees.map((e) => e.id)))
  }, [employees])

  const deselectAll = useCallback(() => {
    setSelectedEmployeeIds(new Set())
  }, [])

  const addManualEmail = useCallback(() => {
    const email = manualInput.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Invalid email address")
      return
    }
    if (manualEmails.includes(email)) {
      toast.error("Email already added")
      return
    }
    setManualEmails((prev) => [...prev, email])
    setManualInput("")
  }, [manualInput, manualEmails])

  const removeManualEmail = useCallback((email: string) => {
    setManualEmails((prev) => prev.filter((e) => e !== email))
  }, [])

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result || "")
        const base64 = result.includes(",") ? result.split(",")[1] : result
        resolve(base64)
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })

  const handleManualPdfUpload = useCallback(async (kind: ManualAttachmentKind, file: File | null) => {
    if (!file) {
      if (kind === "weekly_report") setManualWeeklyReport({ file: null, base64: "" })
      else setManualActionTracker({ file: null, base64: "" })
      return
    }

    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are allowed")
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("PDF must be 1MB or less")
      return
    }

    try {
      const base64 = await fileToBase64(file)
      if (kind === "weekly_report") setManualWeeklyReport({ file, base64 })
      else setManualActionTracker({ file, base64 })
      toast.success(`${kind === "weekly_report" ? "Weekly report" : "Action tracker"} PDF ready`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not process file"
      toast.error(message)
    }
  }, [])

  const handleSend = async () => {
    if (resolvedRecipients.length === 0) {
      toast.error("No recipients selected")
      return
    }

    if (contentChoice === "manual_upload") {
      if (!manualWeeklyReport.base64 || !manualActionTracker.base64) {
        toast.error("Please upload both weekly report and action tracker PDFs")
        return
      }
      if (sendTiming !== "now") {
        toast.error("Manual PDF uploads can only be sent immediately")
        return
      }
    }

    // ── Scheduled: save to DB ────────────────────────────────────────────
    if (sendTiming === "scheduled") {
      if (!scheduledDate) {
        toast.error("Please set a scheduled date")
        return
      }
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`)
      if (scheduledDateTime <= new Date()) {
        toast.error("Scheduled time must be in the future")
        return
      }

      const { error } = await supabase.from("digest_schedules").insert({
        schedule_type: "one_time",
        meeting_week: weekNumber,
        meeting_year: yearNumber,
        recipients: resolvedRecipients,
        content_choice: contentChoice,
        next_run_at: scheduledDateTime.toISOString(),
      })

      if (error) {
        toast.error("Failed to save schedule: " + error.message)
        return
      }

      toast.success(
        `Email scheduled for ${formatWATDateTime(scheduledDateTime, { weekday: "short", day: "numeric", month: "short" })}`
      )
      fetchSchedules()
      return
    }

    // ── Recurring: save to DB ────────────────────────────────────────────
    if (sendTiming === "recurring") {
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
      const targetDay = days.indexOf(recurringDay)
      const now = new Date()
      const currentDay = now.getDay()
      let daysUntil = targetDay - currentDay
      const [h, m] = recurringTime.split(":")
      const targetMinutes = parseInt(h, 10) * 60 + parseInt(m, 10)
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      // If day already passed, or same day and time has passed, schedule next week.
      if (daysUntil < 0 || (daysUntil === 0 && nowMinutes >= targetMinutes)) daysUntil += 7
      const nextRun = new Date(now)
      nextRun.setDate(now.getDate() + daysUntil)
      nextRun.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0)

      const { error } = await supabase.from("digest_schedules").insert({
        schedule_type: "recurring",
        recipients: resolvedRecipients,
        content_choice: "both", // Recurring always sends both reports
        send_day: recurringDay,
        send_time: recurringTime,
        next_run_at: nextRun.toISOString(),
      })

      if (error) {
        toast.error("Failed to save recurring schedule: " + error.message)
        return
      }

      toast.success(`Recurring weekly email set for every ${capitalize(recurringDay)} at ${recurringTime}`)
      fetchSchedules()
      return
    }

    // ── Immediate ────────────────────────────────────────────────────────
    await doSend()
  }

  const doSend = async () => {
    setIsSending(true)
    setSendResult(null)
    const toastId = toast.loading(`Sending digest to ${resolvedRecipients.length} recipient(s)...`)

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const payload: Record<string, unknown> = {
        recipients: resolvedRecipients,
        meetingWeek: weekNumber,
        meetingYear: yearNumber,
        preparedByName: selectedPreparedBy,
      }

      if (contentChoice === "weekly_report") {
        payload.skipActionTracker = true
      } else if (contentChoice === "action_tracker") {
        payload.skipWeeklyReport = true
      } else if (contentChoice === "manual_upload") {
        payload.weeklyReportBase64 = manualWeeklyReport.base64
        payload.actionTrackerBase64 = manualActionTracker.base64
        payload.weeklyReportFilename = manualWeeklyReport.file?.name || undefined
        payload.actionTrackerFilename = manualActionTracker.file?.name || undefined
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/send-weekly-digest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(payload),
      })

      const result = (await res.json()) as DigestSendResponse & { error?: string }
      if (!res.ok) throw new Error(result.error || "Failed to send digest")

      setSendResult(result)
      const successCount = result.results?.filter((r) => r.success).length || 0
      const failCount = result.results?.filter((r) => !r.success).length || 0

      if (failCount === 0) {
        toast.success(`✅ Digest sent to ${successCount} recipient(s)`, { id: toastId })
      } else {
        toast.warning(`Sent to ${successCount}, failed for ${failCount}`, { id: toastId })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send digest"
      console.error("[Mail Digest Error]", err)
      toast.error(message, { id: toastId })
    } finally {
      setIsSending(false)
    }
  }

  const deactivateSchedule = async (id: string) => {
    const { error } = await supabase.from("digest_schedules").update({ is_active: false }).eq("id", id)
    if (error) {
      toast.error("Failed to deactivate schedule")
    } else {
      toast.success("Schedule deactivated")
      fetchSchedules()
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const weekOptions = Array.from({ length: 52 }, (_, i) => i + 1)
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Meeting Mailings"
        description="Send meeting packs (weekly reports + action tracker) to selected recipients."
        icon={Mail}
        backLink={{ href: "/admin/communications/meetings", label: "Back to Meetings" }}
      />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* ── LEFT: Settings ────────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Week Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="h-5 w-5 text-green-600" />
                Meeting Week
              </CardTitle>
              <CardDescription>Choose which general meeting week to send</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="week-select">Meeting Week</Label>
                  <Select value={String(weekNumber)} onValueChange={(v) => setWeekNumber(Number(v))}>
                    <SelectTrigger id="week-select" className="w-[140px]">
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
                  <Label htmlFor="year-select">Year</Label>
                  <Select value={String(yearNumber)} onValueChange={(v) => setYearNumber(Number(v))}>
                    <SelectTrigger id="year-select" className="w-[120px]">
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
                <div className="text-muted-foreground space-y-1 text-sm">
                  <p>
                    All Content: <Badge variant="outline">Week {weekNumber}</Badge>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Content Choice */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-blue-600" />
                Content to Send
              </CardTitle>
              <CardDescription>Choose which attachments to include</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {[
                  { value: "both", label: "Both Reports", icon: FileText, desc: "Weekly Report + Action Tracker" },
                  {
                    value: "weekly_report",
                    label: "Weekly Report Only",
                    icon: FileText,
                    desc: "Departmental work done, tasks & challenges",
                  },
                  {
                    value: "action_tracker",
                    label: "Action Tracker Only",
                    icon: ClipboardList,
                    desc: "Upcoming action items & completion status",
                  },
                  {
                    value: "manual_upload",
                    label: "Upload Your PDFs",
                    icon: FileText,
                    desc: "Manually upload weekly report + action tracker (max 1MB each)",
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setContentChoice(opt.value as ContentChoice)}
                    className={`flex min-w-[180px] flex-1 items-start gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                      contentChoice === opt.value
                        ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                        : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
                    }`}
                  >
                    <opt.icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${contentChoice === opt.value ? "text-green-600" : "text-muted-foreground"}`}
                    />
                    <div>
                      <div
                        className={`font-semibold ${contentChoice === opt.value ? "text-green-700 dark:text-green-400" : ""}`}
                      >
                        {opt.label}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {contentChoice === "manual_upload" && (
                <div className="mt-4 grid gap-4 rounded-lg border border-green-200 bg-green-50/40 p-4 md:grid-cols-2 dark:border-green-900 dark:bg-green-950/20">
                  <div className="space-y-2">
                    <Label htmlFor="manual-weekly-report">Weekly Report PDF (max 1MB)</Label>
                    <Input
                      id="manual-weekly-report"
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => handleManualPdfUpload("weekly_report", e.target.files?.[0] || null)}
                    />
                    {manualWeeklyReport.file && (
                      <p className="text-muted-foreground text-xs">
                        {manualWeeklyReport.file.name} ({(manualWeeklyReport.file.size / 1024).toFixed(0)}KB)
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-action-tracker">Action Tracker PDF (max 1MB)</Label>
                    <Input
                      id="manual-action-tracker"
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => handleManualPdfUpload("action_tracker", e.target.files?.[0] || null)}
                    />
                    {manualActionTracker.file && (
                      <p className="text-muted-foreground text-xs">
                        {manualActionTracker.file.name} ({(manualActionTracker.file.size / 1024).toFixed(0)}KB)
                      </p>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs md:col-span-2">
                    Uploaded files are sent as attachments exactly as provided. Manual upload mode currently supports
                    only immediate send.
                  </p>
                </div>
              )}

              <div className="mt-4 rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label htmlFor="prepared-by">Prepared by</Label>
                  <Badge variant="outline">Choose sender</Badge>
                </div>
                <Select value={selectedPreparedBy} onValueChange={setSelectedPreparedBy}>
                  <SelectTrigger id="prepared-by" className="w-full">
                    <SelectValue placeholder="Select a name" />
                  </SelectTrigger>
                  <SelectContent>
                    {preparedByOptions.length > 0 ? (
                      preparedByOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="ACOB Team">ACOB Team</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Recipient Mode */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-purple-600" />
                Recipients
              </CardTitle>
              <CardDescription>Choose who receives the email</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Pills */}
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "all", label: "All Employees", icon: Users },
                  { value: "select", label: "Select Specific", icon: UserPlus },
                  { value: "manual", label: "Enter Manually", icon: Mail },
                  { value: "all_plus", label: "All + Add More", icon: Plus },
                ].map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setRecipientMode(mode.value as RecipientMode)}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                      recipientMode === mode.value
                        ? "bg-green-600 text-white shadow-md"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <mode.icon className="h-4 w-4" />
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Employee Selection (for "select" mode) */}
              {recipientMode === "select" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                      <Input
                        placeholder="Search by name, email, or department..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={selectAll}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={deselectAll}>
                      Clear
                    </Button>
                  </div>
                  <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-lg border p-2">
                    {filteredEmployees.map((emp) => (
                      <label
                        key={emp.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                          selectedEmployeeIds.has(emp.id) ? "bg-green-50 dark:bg-green-950/20" : "hover:bg-muted/50"
                        }`}
                      >
                        <Checkbox
                          checked={selectedEmployeeIds.has(emp.id)}
                          onCheckedChange={() => toggleEmployee(emp.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{emp.full_name}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {[emp.company_email, emp.additional_email].filter(Boolean).join(" | ")}
                          </div>
                        </div>
                        {emp.department && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {emp.department}
                          </Badge>
                        )}
                      </label>
                    ))}
                    {filteredEmployees.length === 0 && (
                      <div className="text-muted-foreground py-8 text-center text-sm">No employees found</div>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {selectedEmployeeIds.size} of {employees.length} selected
                  </p>
                </div>
              )}

              {/* Manual Email Input (for "manual" and "all_plus" modes) */}
              {(recipientMode === "manual" || recipientMode === "all_plus") && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter email address..."
                      type="email"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addManualEmail()
                        }
                      }}
                      className="flex-1"
                    />
                    <Button variant="outline" onClick={addManualEmail}>
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                  </div>
                  {manualEmails.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {manualEmails.map((email) => (
                        <Badge key={email} variant="secondary" className="gap-1.5 py-1.5 pr-1.5 pl-3">
                          {email}
                          <button
                            type="button"
                            onClick={() => removeManualEmail(email)}
                            className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  {recipientMode === "all_plus" && (
                    <p className="text-muted-foreground text-xs">
                      All {employees.length} employee emails will be included, plus any emails you add above.
                    </p>
                  )}
                </div>
              )}

              {recipientMode === "all" && (
                <p className="text-muted-foreground text-sm">
                  The digest will be sent to all <strong>{employees.length}</strong> active employees.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Send Timing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-orange-600" />
                Delivery Timing
              </CardTitle>
              <CardDescription>Send now, schedule once, or set up recurring weekly delivery</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setSendTiming("now")}
                  className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                    sendTiming === "now"
                      ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                      : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
                  }`}
                >
                  <Send className={`h-5 w-5 ${sendTiming === "now" ? "text-green-600" : "text-muted-foreground"}`} />
                  <div className="text-left">
                    <div
                      className={`font-semibold ${sendTiming === "now" ? "text-green-700 dark:text-green-400" : ""}`}
                    >
                      Send Immediately
                    </div>
                    <div className="text-muted-foreground text-xs">Email will be sent right away</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSendTiming("scheduled")}
                  className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                    sendTiming === "scheduled"
                      ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                      : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
                  }`}
                >
                  <Clock
                    className={`h-5 w-5 ${sendTiming === "scheduled" ? "text-green-600" : "text-muted-foreground"}`}
                  />
                  <div className="text-left">
                    <div
                      className={`font-semibold ${sendTiming === "scheduled" ? "text-green-700 dark:text-green-400" : ""}`}
                    >
                      Schedule
                    </div>
                    <div className="text-muted-foreground text-xs">One-time, pick a date & time</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSendTiming("recurring")}
                  className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                    sendTiming === "recurring"
                      ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                      : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
                  }`}
                >
                  <Repeat
                    className={`h-5 w-5 ${sendTiming === "recurring" ? "text-green-600" : "text-muted-foreground"}`}
                  />
                  <div className="text-left">
                    <div
                      className={`font-semibold ${sendTiming === "recurring" ? "text-green-700 dark:text-green-400" : ""}`}
                    >
                      Recurring
                    </div>
                    <div className="text-muted-foreground text-xs">Automatic every week (server-side)</div>
                  </div>
                </button>
              </div>

              {sendTiming === "scheduled" && (
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sched-date">Date</Label>
                    <Input
                      id="sched-date"
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={toLocalISODate()}
                      className="w-[180px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sched-time">Time</Label>
                    <Input
                      id="sched-time"
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-[140px]"
                    />
                  </div>
                </div>
              )}

              {sendTiming === "recurring" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="recurring-day">Day of Week</Label>
                      <Select value={recurringDay} onValueChange={setRecurringDay}>
                        <SelectTrigger id="recurring-day" className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => (
                            <SelectItem key={d} value={d}>
                              {capitalize(d)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recurring-time">Time</Label>
                      <Input
                        id="recurring-time"
                        type="time"
                        value={recurringTime}
                        onChange={(e) => setRecurringTime(e.target.value)}
                        className="w-[140px]"
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Repeat className="h-3.5 w-3.5" />
                    Runs server-side — no need to keep your computer on. The meeting week is auto-calculated each time.
                  </p>
                </div>
              )}

              {/* Active Schedules */}
              {activeSchedules.length > 0 && (
                <div className="space-y-2 border-t pt-2">
                  <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Active Schedules
                  </div>
                  {activeSchedules.map((s) => (
                    <div
                      key={s.id}
                      className="bg-muted/40 flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        {s.schedule_type === "recurring" ? (
                          <Repeat className="h-4 w-4 text-green-600" />
                        ) : (
                          <Clock className="h-4 w-4 text-orange-600" />
                        )}
                        <span>
                          {s.schedule_type === "recurring"
                            ? `Every ${capitalize(s.send_day || "monday")} at ${s.send_time || "09:00"}`
                            : `One-time: W${s.meeting_week} — ${formatWATDateTime(s.next_run_at, { weekday: "short", day: "numeric", month: "short" })}`}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {(s.recipients as string[])?.length || 0} recipients
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-7 w-7 p-0"
                        onClick={() => deactivateSchedule(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: Summary & Send ─────────────────────────────────────── */}
        <aside className="space-y-6 self-start">
          <Card className="border-green-200 lg:sticky lg:top-24 dark:border-green-900">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Week info */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Week</span>
                  <Badge>
                    W{weekNumber}, {yearNumber}
                  </Badge>
                </div>
              </div>

              <div className="border-t" />

              {/* Content */}
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Attachments</div>
                <div className="flex flex-wrap gap-1.5">
                  {contentChoice === "manual_upload" && manualWeeklyReport.file && (
                    <Badge variant="secondary" className="gap-1">
                      <FileText className="h-3 w-3" /> {manualWeeklyReport.file.name}
                    </Badge>
                  )}
                  {contentChoice === "manual_upload" && manualActionTracker.file && (
                    <Badge variant="secondary" className="gap-1">
                      <ClipboardList className="h-3 w-3" /> {manualActionTracker.file.name}
                    </Badge>
                  )}
                  {(contentChoice === "both" || contentChoice === "weekly_report") && (
                    <Badge variant="secondary" className="gap-1">
                      <FileText className="h-3 w-3" /> Weekly Report
                    </Badge>
                  )}
                  {(contentChoice === "both" || contentChoice === "action_tracker") && (
                    <Badge variant="secondary" className="gap-1">
                      <ClipboardList className="h-3 w-3" /> Action Tracker
                    </Badge>
                  )}
                </div>
              </div>

              <div className="border-t" />

              {/* Recipients */}
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Recipients</div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-green-600" />
                  <span className="text-2xl font-bold">{resolvedRecipients.length}</span>
                  <span className="text-muted-foreground text-sm">email(s)</span>
                </div>
                {resolvedRecipients.length > 0 && (
                  <div className="mt-2 max-h-[160px] space-y-0.5 overflow-y-auto rounded-md border p-2 text-xs">
                    {resolvedRecipients.map((email) => (
                      <div key={email} className="truncate">
                        {email}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t" />

              {/* Timing */}
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Delivery</div>
                <div className="flex items-center gap-2 text-sm">
                  {sendTiming === "now" ? (
                    <>
                      <Send className="h-4 w-4 text-green-600" />
                      <span>Immediately</span>
                    </>
                  ) : sendTiming === "recurring" ? (
                    <>
                      <Repeat className="h-4 w-4 text-green-600" />
                      <span>
                        Every {capitalize(recurringDay)} at {recurringTime}
                      </span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4 text-orange-600" />
                      <span>
                        {scheduledDate
                          ? formatWATDateTime(`${scheduledDate}T${scheduledTime}`, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })
                          : "Not set"}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <Button
                className="mt-4 w-full bg-green-600 text-white hover:bg-green-700"
                size="lg"
                disabled={
                  isSending ||
                  resolvedRecipients.length === 0 ||
                  (contentChoice === "manual_upload" && (!manualWeeklyReport.base64 || !manualActionTracker.base64))
                }
                onClick={handleSend}
              >
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : sendTiming === "scheduled" ? (
                  <>
                    <Clock className="mr-2 h-4 w-4" />
                    Schedule Send
                  </>
                ) : sendTiming === "recurring" ? (
                  <>
                    <Repeat className="mr-2 h-4 w-4" />
                    Save Recurring
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send Now
                  </>
                )}
              </Button>

              {resolvedRecipients.length === 0 && (
                <p className="text-destructive text-center text-xs">
                  <AlertCircle className="mr-1 inline h-3 w-3" />
                  No recipients selected
                </p>
              )}
            </CardContent>
          </Card>

          {/* Send Results */}
          {sendResult?.results && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Send Results
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[300px] space-y-1 overflow-y-auto">
                  {sendResult.results.map((r, i: number) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                        r.success ? "bg-green-50 dark:bg-green-950/20" : "bg-red-50 dark:bg-red-950/20"
                      }`}
                    >
                      <span className="truncate">{r.to}</span>
                      {r.success ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </PageWrapper>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
