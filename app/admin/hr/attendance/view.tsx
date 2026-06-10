"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { DailyRosterView } from "./_components/daily-roster-view"
import { CalendarView } from "./_components/calendar-view"
import type { EmployeeOption } from "./_components/calendar-view"
import { ExceptionsView } from "./_components/exceptions-view"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  BarChart3,
  Download,
  FileText,
  Users,
  Clock,
  AlertCircle,
  Pencil,
  Info,
  CalendarDays,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { getWorkdaysInMonth, monthBounds, toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import { StatusBadge, labelSource } from "./_components/status-badge"

const log = logger("hr-attendance-reports")

interface AttendanceReport {
  user_id: string
  employee_no?: string
  user_name: string
  department: string
  total_days: number
  present_days: number
  late_days: number
  incomplete_days?: number
  half_day_days?: number
  exempted_days?: number
  waived_days: number
  absent_days: number
  leave_days?: number
  holiday_days?: number
  attendance_credits?: number
  total_hours: number
  total_missed_hours?: number
  attendance_rate: number
  attendance_exempt?: boolean
  attendance_exempt_until?: string | null
  period_label?: string
  cycle_label?: string
}

interface DayRecord {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
  clock_in_source?: string | null
  clock_out_source?: string | null
  waived: boolean
  waiver_reason: string | null
  updated_at?: string | null
}

type DayStatus =
  | "present"
  | "late"
  | "absent"
  | "incomplete"
  | "half_day"
  | "waiver"
  | "exempted"
  | "on_leave"
  | "holiday"
  | "weekend"

interface CalendarDay {
  date: string
  dayName: string
  record: DayRecord | null
  isOnLeave: boolean
  status: DayStatus
}

type EditHistoryItem = {
  id: string
  created_at: string
  user_id: string | null
  action?: string | null
  operation?: string | null
  old_values?: Record<string, unknown> | null
  new_values?: Record<string, unknown> | null
  changed_fields?: unknown
  editor_name?: string
}

type ExemptionsPayload = {
  data?: {
    attendance_exempt?: boolean
    periods?: Array<{ start_date: string; end_date: string }>
  }
}

type UnifiedDayPayload = {
  data?: Array<{
    date: string
    record: DayRecord | null
    status: DayStatus
  }>
}

function quarterBounds(year: number, quarter: "Q1" | "Q2" | "Q3" | "Q4") {
  const monthStart = quarter === "Q1" ? 1 : quarter === "Q2" ? 4 : quarter === "Q3" ? 7 : 10
  const start = `${year}-${String(monthStart).padStart(2, "0")}-01`
  const monthEnd = monthStart + 2
  const endDate = toLocalISODate(new Date(Date.UTC(year, monthEnd, 0)))
  return { start, end: endDate }
}

function currentYearMonth() {
  return toLocalYearMonth()
}

function formatDayShort(dateString: string) {
  return formatWATDate(dateString, { weekday: "long", month: "short", day: "numeric" })
}

function formatTime(t: string | null) {
  if (!t) return "—"
  return t.substring(0, 5)
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function formatHours(hours: number | null) {
  if (hours === null) return "—"
  return `${hours.toFixed(1)}h`
}

function getHourBreakdown(record: DayRecord | null, status?: string) {
  const covered = status === "waiver" || status === "on_leave" || status === "holiday" || status === "exempted"
  if (covered) {
    const inMin = parseTimeToMinutes(record?.clock_in)
    const outMin = parseTimeToMinutes(record?.clock_out)
    const total = inMin !== null && outMin !== null && outMin > inMin ? (outMin - inMin) / 60 : null
    return { total, work: null, overtime: null, missed: null }
  }
  if (!record || (!record.clock_in && !record.clock_out)) {
    if (status === "absent") return { total: null, work: null, overtime: null, missed: 9 }
    return { total: null, work: null, overtime: null, missed: null }
  }
  if (record.clock_in && !record.clock_out) {
    if (status === "half_day") return { total: null, work: 4.5, overtime: null, missed: 4.5 }
    return { total: null, work: null, overtime: null, missed: null }
  }
  const inMin = parseTimeToMinutes(record.clock_in)
  const outMin = parseTimeToMinutes(record.clock_out)
  if (inMin === null || outMin === null || outMin <= inMin) {
    return { total: null, work: null, overtime: null, missed: null }
  }
  const total = (outMin - inMin) / 60
  const workStart = 8 * 60
  const workEnd = 17 * 60
  const workMinutes = Math.max(0, Math.min(outMin, workEnd) - Math.max(inMin, workStart))
  const work = workMinutes / 60
  const overtime = Math.max(0, total - work)
  const missed = Math.max(0, 9 - work)
  return { total, work, overtime, missed }
}

interface EmployeeExpandProps {
  report: AttendanceReport
  yearMonth: string
  onRecordChanged?: (userId: string) => void
}

function EmployeeExpandPanel({ report, yearMonth, onRecordChanged }: EmployeeExpandProps) {
  const [days, setDays] = useState<CalendarDay[] | null>(null)
  const [editTarget, setEditTarget] = useState<{ date: string; record: DayRecord | null } | null>(null)
  const [editForm, setEditForm] = useState({
    clock_in: "",
    clock_out: "",
    waived: false,
    waiver_reason: "",
  })
  const [saving, setSaving] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<EditHistoryItem[]>([])
  const [historyTarget, setHistoryTarget] = useState<{ date: string; id: string | null } | null>(null)

  function loadDays() {
    void (async () => {
      try {
        const qs = new URLSearchParams({
          user_id: report.user_id,
          year_month: yearMonth,
          exempt_hint: report.attendance_exempt ? "1" : "0",
        })
        const res = await fetch(`/api/admin/hr/attendance/employee-days?${qs.toString()}`, { cache: "no-store" })
        const payload = res.ok ? ((await res.json()) as UnifiedDayPayload) : null
        const calDays: CalendarDay[] = (payload?.data || []).map((row) => ({
          date: row.date,
          dayName: formatDayShort(row.date),
          record: row.record,
          isOnLeave: row.status === "on_leave",
          status: row.status,
        }))

        setDays(calDays)
      } catch (err) {
        log.error("Failed to load employee day records", err)
        setDays([])
      }
    })()
  }

  useEffect(() => {
    loadDays()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.user_id, yearMonth])

  function openEdit(date: string, record: DayRecord | null) {
    setEditTarget({ date, record })
    setEditForm({
      clock_in: record?.clock_in?.substring(0, 5) ?? "",
      clock_out: record?.clock_out?.substring(0, 5) ?? "",
      waived: record?.waived ?? false,
      waiver_reason: record?.waiver_reason ?? "",
    })
  }

  async function saveEdit() {
    if (!editTarget) return
    setSaving(true)
    try {
      let res: Response
      if (editTarget.record) {
        // Update existing record — status is auto-derived by the API from clock times
        const body: Record<string, unknown> = {
          waived: editForm.waived,
          waiver_reason: editForm.waiver_reason || null,
        }
        if (editForm.clock_in) body.clock_in = editForm.clock_in
        if (editForm.clock_out) body.clock_out = editForm.clock_out
        res = await fetch(`/api/admin/hr/attendance/records/${editTarget.record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        // Create new record for a day with no existing record — status auto-derived by API
        const body: Record<string, unknown> = {
          user_id: report.user_id,
          date: editTarget.date,
          waived: editForm.waived,
          waiver_reason: editForm.waiver_reason || null,
        }
        if (editForm.clock_in) body.clock_in = editForm.clock_in
        if (editForm.clock_out) body.clock_out = editForm.clock_out
        res = await fetch("/api/admin/hr/attendance/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save")
      toast.success(editTarget.record ? "Record updated" : "Record created")
      setEditTarget(null)
      setDays(null)
      loadDays()
      onRecordChanged?.(report.user_id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function openHistory(day: CalendarDay) {
    setHistoryTarget({ date: day.date, id: day.record?.id ?? null })
    setHistoryOpen(true)
    if (!day.record) {
      setHistoryItems([])
      return
    }
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/admin/hr/attendance/records/${day.record.id}/history`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: EditHistoryItem[] } | null
      if (!res.ok) throw new Error("Failed to load edit history")
      setHistoryItems(payload?.data || [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load edit history")
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }

  if (!days) {
    return <div className="text-muted-foreground py-4 text-center text-sm">Loading days…</div>
  }

  const today = toLocalISODate()
  const visibleDays = days.filter((d) => d.date <= today)
  const isCreating = editTarget !== null && editTarget.record === null
  const hasClockIn = Boolean(editForm.clock_in)
  const hasClockOut = Boolean(editForm.clock_out)
  const hasAnyTime = hasClockIn || hasClockOut
  const hasPartialTime = hasClockIn !== hasClockOut
  const invalidTimeRange = Boolean(editForm.clock_in && editForm.clock_out && editForm.clock_out < editForm.clock_in)
  const cannotSave =
    saving ||
    invalidTimeRange ||
    (editForm.waived && !editForm.waiver_reason.trim()) ||
    (!editForm.waived && (!hasAnyTime || hasPartialTime))

  return (
    <>
      <div className="space-y-1 py-2">
        <div className="text-muted-foreground grid grid-cols-[220px_90px_70px_70px_80px_80px_80px_90px_120px_60px] items-center gap-3 px-2 text-[11px] font-semibold uppercase">
          <span>Day</span>
          <span>Status</span>
          <span>In</span>
          <span>Out</span>
          <span>Total</span>
          <span>Work</span>
          <span>Missed</span>
          <span>Overtime</span>
          <span>Source</span>
          <span></span>
        </div>
        {visibleDays.map((day) => {
          const hours = getHourBreakdown(day.record, day.status)
          return (
            <div
              key={day.date}
              className="hover:bg-muted/30 grid grid-cols-[220px_90px_70px_70px_80px_80px_80px_90px_120px_60px] items-center gap-3 rounded px-2 py-1.5 text-sm"
            >
              <span className="text-xs font-medium">{day.dayName}</span>
              <div>
                <StatusBadge status={day.status} waived={day.record?.waived} />
              </div>
              <span className="text-muted-foreground text-xs">
                {day.record ? formatTime(day.record.clock_in) : "—"}
              </span>
              <span className="text-muted-foreground text-xs">
                {day.record ? formatTime(day.record.clock_out) : "—"}
              </span>
              <span className="text-xs">{formatHours(hours.total ?? day.record?.total_hours ?? null)}</span>
              <span className="text-xs">{formatHours(hours.work)}</span>
              <span
                className={`text-xs ${hours.missed !== null && hours.missed > 0 ? "text-orange-500" : "text-muted-foreground"}`}
              >
                {hours.missed !== null ? formatHours(hours.missed) : "—"}
              </span>
              <span className="text-xs">
                {hours.overtime != null && hours.overtime >= 0.05 ? formatHours(hours.overtime) : "—"}
              </span>
              <span className="text-xs">{labelSource(day.record)}</span>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => openHistory(day)}
                  title="View edit history"
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
                {!day.isOnLeave && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => openEdit(day.date, day.record)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isCreating ? "Add Attendance Record" : "Edit Attendance Record"}</DialogTitle>
            <DialogDescription>
              {editTarget && `${report.user_name} — ${formatDayShort(editTarget.date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-muted-foreground text-xs">Status is auto-derived from clock times.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Clock In</Label>
                <Input
                  type="time"
                  max="23:59"
                  value={editForm.clock_in}
                  onChange={(e) => setEditForm((f) => ({ ...f, clock_in: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Clock Out</Label>
                <Input
                  type="time"
                  max="23:59"
                  value={editForm.clock_out}
                  onChange={(e) => setEditForm((f) => ({ ...f, clock_out: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="waived"
                checked={editForm.waived}
                onCheckedChange={(checked: boolean) => setEditForm((f) => ({ ...f, waived: checked }))}
              />
              <Label htmlFor="waived">Waive deduction</Label>
            </div>
            {editForm.waived && (
              <div className="space-y-2">
                <Label>
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. Permit granted, client visit"
                  value={editForm.waiver_reason}
                  onChange={(e) => setEditForm((f) => ({ ...f, waiver_reason: e.target.value }))}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={cannotSave}>
              {saving ? "Saving…" : isCreating ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit History</DialogTitle>
            <DialogDescription>{historyTarget ? formatDayShort(historyTarget.date) : ""}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] space-y-3 overflow-y-auto">
            {historyLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : historyItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">No edits found.</p>
            ) : (
              historyItems.map((item) => {
                const isDevice = (item.new_values as Record<string, unknown> | null)?.source === "hikvision"
                const actionLabel =
                  item.action === "create"
                    ? "Created"
                    : item.action === "update"
                      ? "Updated"
                      : (item.action ?? "Changed")
                const displayFields = Object.entries((item.new_values || {}) as Record<string, unknown>).filter(
                  ([key]) => !["source", "status"].includes(key)
                )
                return (
                  <div key={item.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {isDevice ? "HiKVision Device" : item.editor_name || "Unknown"}
                      </p>
                      <Badge
                        className={isDevice ? "bg-blue-100 text-xs text-blue-800" : "bg-gray-100 text-xs text-gray-800"}
                      >
                        {isDevice ? "Automated" : actionLabel}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">{formatWATDateTime(item.created_at)}</p>
                    <div className="mt-2 space-y-1 text-xs">
                      {displayFields.length === 0 ? (
                        <p className="text-muted-foreground">No field details captured.</p>
                      ) : (
                        displayFields.map(([key, value]) => (
                          <p key={key}>
                            <span className="font-medium">{key.replaceAll("_", " ")}:</span>{" "}
                            <span className="text-muted-foreground">{String(value ?? "—")}</span>
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

type AttendanceTab = "summary" | "daily" | "calendar" | "exceptions"

const ATTENDANCE_TABS: DataTableTab[] = [
  { key: "daily", label: "Daily Roster" },
  { key: "summary", label: "Summary" },
  { key: "calendar", label: "Calendar" },
  { key: "exceptions", label: "Exceptions" },
]

export function AttendanceReportsPage({
  backLinkHref,
  lockedDepartment,
}: { backLinkHref?: string; lockedDepartment?: string } = {}) {
  const [activeTab, setActiveTab] = useState<AttendanceTab>("daily")
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<AttendanceReport[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [periodMode, setPeriodMode] = useState<"month" | "quarter">("month")
  const [quarter, setQuarter] = useState<"Q1" | "Q2" | "Q3" | "Q4">("Q1")
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear())
  const reportDepartment = lockedDepartment || "all"
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [holidayOpen, setHolidayOpen] = useState(false)
  const [holidayDate, setHolidayDate] = useState("")
  const [holidayEndDate, setHolidayEndDate] = useState("")
  const [holidayRange, setHolidayRange] = useState(false)
  const [holidayName, setHolidayName] = useState("")
  const [holidaySaving, setHolidaySaving] = useState(false)
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name?: string | null }>>([])
  const [exemptDialog, setExemptDialog] = useState<{ open: boolean; userId: string; userName: string }>({
    open: false,
    userId: "",
    userName: "",
  })
  const [exemptMode, setExemptMode] = useState<"off" | "infinite" | "weekly" | "monthly">("off")
  const [exemptMonth, setExemptMonth] = useState(currentYearMonth())
  const [exemptWeeks, setExemptWeeks] = useState<number[]>([])
  const [exemptMonths, setExemptMonths] = useState<string[]>([])
  const [exemptReason, setExemptReason] = useState("")
  const [exemptSaving, setExemptSaving] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [managerSearch, setManagerSearch] = useState("")
  const [managerMode, setManagerMode] = useState<"off" | "infinite" | "weekly" | "monthly" | "period">("off")
  const [managerMonth, setManagerMonth] = useState(currentYearMonth())
  const [managerWeeks, setManagerWeeks] = useState<number[]>([])
  const [managerMonths, setManagerMonths] = useState<string[]>([])
  const [managerStartDate, setManagerStartDate] = useState("")
  const [managerEndDate, setManagerEndDate] = useState("")
  const [managerReason, setManagerReason] = useState("")
  const [managerSaving, setManagerSaving] = useState(false)
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])

  const refreshSingleEmployeeSummary = useCallback(
    async (userId: string) => {
      try {
        const { start, end } = periodMode === "month" ? monthBounds(yearMonth) : quarterBounds(quarterYear, quarter)
        const params = new URLSearchParams({
          start_date: start,
          end_date: end,
          department: reportDepartment,
          user_id: userId,
        })
        const response = await fetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
        const payload = (await response.json().catch(() => null)) as {
          data?: AttendanceReport[]
          error?: string
        } | null
        if (!response.ok) throw new Error(payload?.error ?? "Failed to refresh employee summary")
        const row = payload?.data?.[0]
        if (!row) return

        const activePeriodLabel = periodMode === "month" ? yearMonth : `${quarter} ${quarterYear}`
        const activeCycleLabel = periodMode === "month" ? "Monthly" : "Quarterly"
        setReports((prev) =>
          prev.map((r) =>
            r.user_id === userId
              ? {
                  ...row,
                  period_label: activePeriodLabel,
                  cycle_label: activeCycleLabel,
                }
              : r
          )
        )
      } catch (error) {
        log.error("Failed to refresh single employee summary:", error)
      }
    },
    [periodMode, quarter, quarterYear, reportDepartment, yearMonth]
  )

  const generateReport = useCallback(async () => {
    setLoading(true)
    try {
      const { start, end } = periodMode === "month" ? monthBounds(yearMonth) : quarterBounds(quarterYear, quarter)
      const params = new URLSearchParams({ start_date: start, end_date: end, department: reportDepartment })
      const response = await fetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as {
        data?: AttendanceReport[]
        departments?: string[]
        error?: string
      } | null
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load attendance report")
      const activePeriodLabel = periodMode === "month" ? yearMonth : `${quarter} ${quarterYear}`
      const activeCycleLabel = periodMode === "month" ? "Monthly" : "Quarterly"
      setReports(
        (payload?.data ?? []).map((row) => ({
          ...row,
          period_label: activePeriodLabel,
          cycle_label: activeCycleLabel,
        }))
      )
      setDepartments(lockedDepartment ? [lockedDepartment] : (payload?.departments ?? []))
    } catch (error) {
      log.error("Error generating report:", error)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [yearMonth, reportDepartment, periodMode, quarter, quarterYear, lockedDepartment])

  const loadHolidays = useCallback(async () => {
    const response = await fetch(`/api/admin/hr/attendance/holidays?month=${yearMonth}`, { cache: "no-store" })
    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ holiday_date: string; name?: string | null }>
    } | null
    if (response.ok) setHolidays(payload?.data ?? [])
  }, [yearMonth])

  useEffect(() => {
    void generateReport()
  }, [generateReport])

  useEffect(() => {
    void loadHolidays()
  }, [loadHolidays])

  const EXPORT_HEADERS = [
    "Name",
    "Department",
    "Total Days",
    "Present",
    "Late",
    "Incomplete",
    "Exempted",
    "Half Day",
    "Leave",
    "Holiday",
    "Waiver",
    "Absent",
    "Total Hours",
    "Hrs Missed",
    "Credit",
    "Attendance Rate",
  ]

  function buildExportRows(): (string | number)[][] {
    return reports.map((r) => [
      r.user_name,
      r.department,
      r.total_days,
      r.present_days,
      r.late_days,
      r.incomplete_days || 0,
      r.exempted_days || 0,
      r.half_day_days ?? 0,
      r.leave_days ?? 0,
      r.holiday_days ?? 0,
      r.waived_days,
      r.absent_days,
      r.total_hours.toFixed(1),
      (r.total_missed_hours ?? 0).toFixed(1),
      `${(r.attendance_credits ?? 0).toFixed(2)} / ${r.total_days}`,
      `${r.attendance_rate}%`,
    ])
  }

  function exportCSV() {
    const escapeCell = (value: string | number) => {
      const str = String(value ?? "")
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }
    const rows = buildExportRows()
    const csv = [EXPORT_HEADERS, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `attendance_${yearMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportXLSX() {
    const XLSX = await import("@e965/xlsx")
    const { saveAs } = await import("file-saver")
    const rows = buildExportRows()
    const sheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "Attendance")
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `attendance_${yearMonth}.xlsx`
    )
  }

  async function exportPDF() {
    const { jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const rows = buildExportRows()
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
    doc.setFontSize(14)
    doc.text(`Attendance Report — ${periodMode === "quarter" ? `Q${quarter} ${quarterYear}` : yearMonth}`, 40, 40)
    autoTable(doc, {
      head: [EXPORT_HEADERS],
      body: rows.map((row) => row.map((cell) => String(cell))),
      startY: 56,
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
    })
    doc.save(`attendance_${yearMonth}.pdf`)
  }

  const departmentOptions = useMemo(() => departments.map((d) => ({ value: d, label: d })), [departments])

  const stats = useMemo(() => {
    const totalCredits = reports.reduce((a, r) => a + (r.attendance_credits ?? r.present_days), 0)
    const totalWorkDays = reports.reduce((a, r) => a + r.total_days, 0)
    const totalAbsent = reports.reduce((a, r) => a + r.absent_days, 0)
    return {
      employees: reports.length,
      attendanceRate: totalWorkDays > 0 ? `${((totalCredits / totalWorkDays) * 100).toFixed(2)}%` : "—",
      absentRate: totalWorkDays > 0 ? `${((totalAbsent / totalWorkDays) * 100).toFixed(2)}%` : "—",
    }
  }, [reports])

  const employeeOptions = useMemo<EmployeeOption[]>(
    () =>
      reports.map((r) => ({
        user_id: r.user_id,
        user_name: r.user_name,
        department: r.department,
        attendance_exempt: r.attendance_exempt,
      })),
    [reports]
  )

  const columns: DataTableColumn<AttendanceReport>[] = [
    {
      key: "user_name",
      label: "Employee",
      sortable: true,
      accessor: (r) => r.user_name,
      render: (r) => (
        <div>
          <div className="font-medium">{r.user_name}</div>
          <div className="text-muted-foreground text-xs">{r.department}</div>
        </div>
      ),
      resizable: true,
      initialWidth: 200,
    },
    {
      key: "present_days",
      label: "Present",
      sortable: true,
      accessor: (r) => r.present_days,
      render: (r) => <span className="text-green-600">{r.present_days}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "late_days",
      label: "Late",
      sortable: true,
      accessor: (r) => r.late_days,
      render: (r) => <span className="text-yellow-600">{r.late_days}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "incomplete_days",
      label: "Incomplete",
      sortable: true,
      accessor: (r) => r.incomplete_days || 0,
      render: (r) => <span className="text-cyan-600">{r.incomplete_days || 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "exempted_days",
      label: "Exempted",
      sortable: true,
      accessor: (r) => r.exempted_days || 0,
      render: (r) => <span className="text-violet-600">{r.exempted_days || 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "half_day_days",
      label: "Half Day",
      sortable: true,
      accessor: (r) => r.half_day_days ?? 0,
      render: (r) => <span className="text-orange-600">{r.half_day_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "leave_days",
      label: "Leave",
      sortable: true,
      accessor: (r) => r.leave_days ?? 0,
      render: (r) => <span className="text-purple-600">{r.leave_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "holiday_days",
      label: "Holiday",
      sortable: true,
      accessor: (r) => r.holiday_days ?? 0,
      render: (r) => <span className="text-sky-600">{r.holiday_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "waived_days",
      label: "Waiver",
      sortable: true,
      accessor: (r) => r.waived_days,
      render: (r) => <span className="text-blue-600">{r.waived_days}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "absent_days",
      label: "Absent",
      sortable: true,
      accessor: (r) => r.absent_days,
      render: (r) => <span className="text-red-600">{r.absent_days}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "total_hours",
      label: "Hours",
      sortable: true,
      accessor: (r) => r.total_hours,
      render: (r) => r.total_hours.toFixed(1),
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "total_missed_hours",
      label: "Hrs Missed",
      sortable: true,
      accessor: (r) => r.total_missed_hours ?? 0,
      render: (r) =>
        (r.total_missed_hours ?? 0) > 0 ? (
          <span className="text-orange-500">{(r.total_missed_hours ?? 0).toFixed(1)}h</span>
        ) : (
          <span className="text-muted-foreground text-xs">0h</span>
        ),
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "attendance_credits",
      label: "Credit",
      sortable: true,
      accessor: (r) => r.attendance_credits ?? 0,
      hideOnMobile: true,
      render: (r) => {
        const credit = r.attendance_credits ?? 0
        const total = r.total_days
        return (
          <span className="text-xs">
            <span
              className={
                credit / total >= 0.8
                  ? "font-medium text-emerald-600"
                  : credit / total >= 0.6
                    ? "text-yellow-600"
                    : "font-medium text-red-600"
              }
            >
              {credit.toFixed(2)}
            </span>
            <span className="text-muted-foreground"> / {total}</span>
          </span>
        )
      },
      align: "center",
    },
    {
      key: "attendance_rate",
      label: "Rate",
      sortable: true,
      accessor: (r) => r.attendance_rate,
      render: (r) => (
        <Badge variant={r.attendance_rate >= 80 ? "default" : r.attendance_rate >= 60 ? "secondary" : "destructive"}>
          {r.attendance_rate.toFixed(2)}%
        </Badge>
      ),
    },
    {
      key: "exempt_toggle",
      label: "",
      render: (r) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setExemptMode(r.attendance_exempt ? "infinite" : "off")
            setExemptMonth(currentYearMonth())
            setExemptWeeks([])
            setExemptMonths([])
            setExemptReason("")
            setExemptDialog({ open: true, userId: r.user_id, userName: r.user_name })
          }}
          title="Set attendance exemption"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ]

  const reportFilters: DataTableFilter<AttendanceReport>[] = [
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: lockedDepartment || "All Departments",
    },
    {
      key: "cycle_label",
      label: "Cycle",
      options: [
        { value: "Monthly", label: "Monthly" },
        { value: "Quarterly", label: "Quarterly" },
      ],
      placeholder: "All Cycles",
    },
    {
      key: "rate_band",
      label: "Attendance Band",
      options: [
        { value: "excellent", label: "80%+" },
        { value: "watch", label: "60–79%" },
        { value: "risk", label: "Below 60%" },
      ],
      placeholder: "All Bands",
      mode: "custom",
      filterFn: (r, values) => {
        if (values.length === 0) return true
        return values.some((v) => {
          if (v === "excellent") return r.attendance_rate >= 80
          if (v === "watch") return r.attendance_rate >= 60 && r.attendance_rate < 80
          if (v === "risk") return r.attendance_rate < 60
          return false
        })
      },
    },
  ]

  return (
    <DataTablePage
      title="Attendance Reports"
      description={
        activeTab === "summary"
          ? "Monthly attendance performance by employee."
          : activeTab === "daily"
            ? "All check-in records for a selected date."
            : activeTab === "calendar"
              ? "Month-view calendar for an individual employee."
              : "Records needing attention — late arrivals, missing clock-outs, absences."
      }
      icon={BarChart3}
      backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
      tabs={ATTENDANCE_TABS}
      activeTab={activeTab}
      onTabChange={(t) => setActiveTab(t as AttendanceTab)}
      actions={
        <div className="flex items-center gap-2">
          {activeTab === "summary" && (
            <input
              type="month"
              value={yearMonth}
              max={currentYearMonth()}
              onChange={(e) => e.target.value && setYearMonth(e.target.value)}
              className="border-input bg-background h-9 rounded-md border px-3 py-1.5 text-sm"
              aria-label="Select report month"
            />
          )}
          <Button variant="outline" onClick={() => setManagerOpen(true)} size="sm">
            <Users className="mr-2 h-4 w-4" />
            Exemption Manager
          </Button>
          <Button variant="outline" onClick={() => setHolidayOpen(true)} size="sm">
            <CalendarDays className="mr-2 h-4 w-4" />
            Holidays
          </Button>
          <Button variant="outline" onClick={() => setIsExportOpen(true)} disabled={reports.length === 0} size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      }
      stats={
        activeTab === "summary" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              title="Employees"
              value={stats.employees}
              icon={Users}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="Attendance Rate"
              value={stats.attendanceRate}
              icon={BarChart3}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
            <StatCard
              title="Absent Rate"
              value={stats.absentRate}
              icon={AlertCircle}
              iconBgColor="bg-red-500/10"
              iconColor="text-red-500"
            />
          </div>
        ) : undefined
      }
    >
      {activeTab === "daily" && <DailyRosterView departments={departments} lockedDepartment={lockedDepartment} />}
      {activeTab === "calendar" && <CalendarView employees={employeeOptions} />}
      {activeTab === "exceptions" && <ExceptionsView departments={departments} lockedDepartment={lockedDepartment} />}
      {activeTab === "summary" && (
        <DataTable<AttendanceReport>
          data={reports}
          columns={columns}
          filters={reportFilters}
          getRowId={(r) => r.user_id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search employee or department…"
          searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
          isLoading={loading}
          expandable={{
            render: (r) => (
              <EmployeeExpandPanel report={r} yearMonth={yearMonth} onRecordChanged={refreshSingleEmployeeSummary} />
            ),
          }}
          emptyTitle={loading ? "Loading attendance report…" : "No attendance report"}
          emptyDescription="No attendance results available for this period."
          emptyIcon={FileText}
          skeletonRows={6}
        />
      )}
      <ExportOptionsDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        title="Export Attendance Report"
        options={[
          { id: "csv", label: "CSV (.csv)", icon: "excel" },
          { id: "xlsx", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF (.pdf)", icon: "pdf" },
        ]}
        onSelect={(id) => {
          if (id === "csv") exportCSV()
          else if (id === "xlsx") void exportXLSX()
          else if (id === "pdf") void exportPDF()
        }}
      />

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Exemption Manager</DialogTitle>
            <DialogDescription>Apply exemption to multiple employees at once.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Employees</Label>
              <Input
                placeholder="Search employee..."
                value={managerSearch}
                onChange={(e) => setManagerSearch(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelectedEmployeeIds(
                      reports
                        .filter((row) =>
                          `${row.user_name} ${row.department} ${row.employee_no || ""}`
                            .toLowerCase()
                            .includes(managerSearch.toLowerCase())
                        )
                        .map((row) => row.user_id)
                    )
                  }
                >
                  Select All
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedEmployeeIds([])}>
                  Clear
                </Button>
              </div>
              <div className="max-h-52 space-y-1 overflow-auto rounded border p-2">
                {reports
                  .filter((row) =>
                    `${row.user_name} ${row.department} ${row.employee_no || ""}`
                      .toLowerCase()
                      .includes(managerSearch.toLowerCase())
                  )
                  .map((row) => (
                    <label
                      key={row.user_id}
                      className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.includes(row.user_id)}
                        onChange={(e) =>
                          setSelectedEmployeeIds((prev) =>
                            e.target.checked ? [...prev, row.user_id] : prev.filter((id) => id !== row.user_id)
                          )
                        }
                      />
                      <span>{row.user_name}</span>
                      <span className="text-muted-foreground text-xs">({row.department})</span>
                      {(row.attendance_exempt || (row.exempted_days || 0) > 0) && (
                        <Badge variant="secondary" className="ml-auto">
                          Exempted
                        </Badge>
                      )}
                    </label>
                  ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={managerMode}
                onValueChange={(v: "off" | "infinite" | "weekly" | "monthly" | "period") => setManagerMode(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Disabled</SelectItem>
                  <SelectItem value="infinite">Infinite (until disabled)</SelectItem>
                  <SelectItem value="weekly">Specific Weeks</SelectItem>
                  <SelectItem value="monthly">Specific Months</SelectItem>
                  <SelectItem value="period">Custom Period</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {managerMode === "weekly" && (
              <div className="space-y-2">
                <Label>Month</Label>
                <input
                  type="month"
                  value={managerMonth}
                  onChange={(e) => setManagerMonth(e.target.value)}
                  className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
                />
                <Label>Weeks in month (multi-select)</Label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((wk) => (
                    <Button
                      key={wk}
                      type="button"
                      variant={managerWeeks.includes(wk) ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setManagerWeeks((prev) => (prev.includes(wk) ? prev.filter((x) => x !== wk) : [...prev, wk]))
                      }
                    >
                      Week {wk}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {managerMode === "monthly" && (
              <div className="space-y-2">
                <Label>Months (multi-select)</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={managerMonth}
                    onChange={(e) => setManagerMonth(e.target.value)}
                    className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setManagerMonths((prev) => (prev.includes(managerMonth) ? prev : [...prev, managerMonth].sort()))
                    }
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {managerMonths.map((month) => (
                    <Button
                      key={month}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setManagerMonths((prev) => prev.filter((x) => x !== month))}
                    >
                      {month} ×
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {managerMode === "period" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={managerStartDate} onChange={(e) => setManagerStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={managerEndDate} onChange={(e) => setManagerEndDate(e.target.value)} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Input value={managerReason} onChange={(e) => setManagerReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagerOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={managerSaving || selectedEmployeeIds.length === 0}
              onClick={async () => {
                if (managerMode === "weekly" && (managerWeeks.length === 0 || !managerMonth)) {
                  toast.error("Select a month and at least one week.")
                  return
                }
                if (managerMode === "monthly" && managerMonths.length === 0) {
                  toast.error("Select at least one month.")
                  return
                }
                if (managerMode === "period") {
                  if (!managerStartDate || !managerEndDate) {
                    toast.error("Select start and end date.")
                    return
                  }
                  if (managerStartDate > managerEndDate) {
                    toast.error("Start date cannot be after end date.")
                    return
                  }
                }
                setManagerSaving(true)
                const res = await fetch("/api/admin/hr/attendance/exemptions/bulk", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    user_ids: selectedEmployeeIds,
                    mode: managerMode,
                    month: managerMonth,
                    weeks: managerMode === "weekly" ? managerWeeks : undefined,
                    months: managerMode === "monthly" ? managerMonths : undefined,
                    start_date: managerMode === "period" ? managerStartDate : undefined,
                    end_date: managerMode === "period" ? managerEndDate : undefined,
                    reason: managerReason || null,
                  }),
                })
                const payload = (await res.json().catch(() => null)) as { error?: string } | null
                if (!res.ok) {
                  toast.error(payload?.error || "Failed to save bulk exemption")
                  setManagerSaving(false)
                  return
                }
                toast.success("Bulk exemption settings saved")
                setManagerOpen(false)
                setSelectedEmployeeIds([])
                setManagerWeeks([])
                setManagerMonths([])
                setManagerReason("")
                setManagerStartDate("")
                setManagerEndDate("")
                setManagerSaving(false)
                void generateReport()
              }}
            >
              {managerSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exemptDialog.open} onOpenChange={(open) => setExemptDialog((s) => ({ ...s, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attendance Exempted Status</DialogTitle>
            <DialogDescription>{exemptDialog.userName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Mode</Label>
            <Select
              value={exemptMode}
              onValueChange={(v: "off" | "infinite" | "weekly" | "monthly") => setExemptMode(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Disabled</SelectItem>
                <SelectItem value="infinite">Infinite (until disabled)</SelectItem>
                <SelectItem value="weekly">Specific Weeks</SelectItem>
                <SelectItem value="monthly">Specific Months</SelectItem>
              </SelectContent>
            </Select>
            {exemptMode === "weekly" && (
              <div className="space-y-2">
                <Label>Month</Label>
                <input
                  type="month"
                  value={exemptMonth}
                  onChange={(e) => setExemptMonth(e.target.value)}
                  className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
                />
                <Label>Weeks in month (multi-select)</Label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((wk) => (
                    <Button
                      key={wk}
                      type="button"
                      variant={exemptWeeks.includes(wk) ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setExemptWeeks((prev) => (prev.includes(wk) ? prev.filter((x) => x !== wk) : [...prev, wk]))
                      }
                    >
                      Week {wk}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {exemptMode === "monthly" && (
              <div className="space-y-2">
                <Label>Months (multi-select)</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={exemptMonth}
                    onChange={(e) => setExemptMonth(e.target.value)}
                    className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setExemptMonths((prev) => (prev.includes(exemptMonth) ? prev : [...prev, exemptMonth].sort()))
                    }
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {exemptMonths.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setExemptMonths((prev) => prev.filter((x) => x !== m))}
                    >
                      {m} ×
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              Exempted employees remain visible in reports with zero deduction.
            </p>
            <Label>Reason (optional)</Label>
            <Input value={exemptReason} onChange={(e) => setExemptReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExemptDialog((s) => ({ ...s, open: false }))}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setExemptSaving(true)
                const res = await fetch("/api/admin/hr/attendance/exemptions", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    user_id: exemptDialog.userId,
                    mode: exemptMode,
                    month: exemptMonth,
                    weeks: exemptMode === "weekly" ? exemptWeeks : undefined,
                    months: exemptMode === "monthly" ? exemptMonths : undefined,
                    reason: exemptReason || null,
                  }),
                })
                if (!res.ok) {
                  const payload = (await res.json().catch(() => null)) as { error?: string } | null
                  toast.error(payload?.error || "Failed to update exemption")
                  setExemptSaving(false)
                  return
                }
                toast.success("Exemption settings saved")
                setExemptDialog((s) => ({ ...s, open: false }))
                setExemptReason("")
                setExemptWeeks([])
                setExemptMonths([])
                setExemptSaving(false)
                void generateReport()
              }}
              disabled={exemptSaving}
            >
              {exemptSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={holidayOpen} onOpenChange={setHolidayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Holidays</DialogTitle>
            <DialogDescription>Add or remove organization holiday dates.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                id="holiday-range"
                checked={holidayRange}
                onCheckedChange={(checked: boolean) => {
                  setHolidayRange(checked)
                  if (!checked) setHolidayEndDate("")
                }}
              />
              <Label htmlFor="holiday-range">Date range (multiple days)</Label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{holidayRange ? "Start Date" : "Date"}</Label>
                <Input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
              </div>
              {holidayRange ? (
                <div className="space-y-2">
                  <Label>
                    End Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="date"
                    min={holidayDate || undefined}
                    value={holidayEndDate}
                    onChange={(e) => setHolidayEndDate(e.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={holidayName}
                    onChange={(e) => setHolidayName(e.target.value)}
                    placeholder="e.g. Workers Day"
                    required
                  />
                </div>
              )}
            </div>
            {holidayRange && (
              <div className="space-y-2">
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                  placeholder="e.g. Christmas Break"
                  required
                />
              </div>
            )}
            <Button
              type="button"
              disabled={
                !holidayDate ||
                !holidayName.trim() ||
                holidaySaving ||
                (holidayRange && (!holidayEndDate || holidayEndDate < holidayDate))
              }
              onClick={async () => {
                setHolidaySaving(true)
                const response = await fetch("/api/admin/hr/attendance/holidays", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    holiday_date: holidayDate,
                    holiday_date_end: holidayRange && holidayEndDate ? holidayEndDate : undefined,
                    name: holidayName || undefined,
                  }),
                })
                const payload = (await response.json().catch(() => null)) as {
                  error?: string
                  message?: string
                } | null
                if (!response.ok) {
                  toast.error(payload?.error || "Failed to add holiday")
                } else {
                  toast.success(payload?.message || "Holiday added")
                  setHolidayDate("")
                  setHolidayEndDate("")
                  setHolidayName("")
                  await loadHolidays()
                  await generateReport()
                }
                setHolidaySaving(false)
              }}
            >
              {holidaySaving ? "Saving..." : holidayRange ? "Add Holidays" : "Add Holiday"}
            </Button>
            <div className="max-h-64 space-y-2 overflow-auto rounded border p-2">
              {holidays.length === 0 ? (
                <p className="text-muted-foreground text-sm">No holidays for this month.</p>
              ) : (
                holidays.map((holiday) => (
                  <div
                    key={holiday.holiday_date}
                    className="flex items-center justify-between rounded border px-2 py-1.5 text-sm"
                  >
                    <span>
                      {holiday.holiday_date}
                      {holiday.name ? ` • ${holiday.name}` : ""}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={async () => {
                        const response = await fetch(
                          `/api/admin/hr/attendance/holidays?holiday_date=${encodeURIComponent(holiday.holiday_date)}`,
                          { method: "DELETE" }
                        )
                        const payload = (await response.json().catch(() => null)) as { error?: string } | null
                        if (!response.ok) {
                          toast.error(payload?.error || "Failed to remove holiday")
                          return
                        }
                        toast.success("Holiday removed")
                        await loadHolidays()
                        await generateReport()
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
