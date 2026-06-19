"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { DailyRosterView } from "./_components/daily-roster-view"
import { CalendarView } from "./_components/calendar-view"
import type { EmployeeOption } from "./_components/calendar-view"
import { ExceptionsView } from "./_components/exceptions-view"
import { AttendanceManagerDialog } from "./_components/attendance-manager-dialog"
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
import { BarChart3, Download, FileText, Users, Clock, AlertCircle, Pencil, Info, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { getWorkdaysInMonth, monthBounds, toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  MANUAL_ATTENDANCE_STATUS_OPTIONS,
} from "@/lib/hr/attendance-status"
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
  lateness_with_permission_days?: number
  absent_with_permission_days?: number
  out_of_station_days?: number
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
  manual_comment?: string | null
  updated_at?: string | null
}

type DayStatus =
  | "present"
  | "late"
  | "lateness_with_permission"
  | "absent"
  | "absent_with_permission"
  | "out_of_station"
  | "incomplete"
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
  if (!t) return "â€”"
  return t.substring(0, 5)
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function formatHours(hours: number | null) {
  if (hours === null) return "â€”"
  return `${hours.toFixed(1)}h`
}

function getHourBreakdown(record: DayRecord | null, status?: string) {
  const covered =
    status === "waiver" ||
    status === "on_leave" ||
    status === "holiday" ||
    status === "exempted" ||
    status === "out_of_station" ||
    status === "absent_with_permission" ||
    status === "lateness_with_permission"
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
    status: "auto",
    waived: false,
    waiver_reason: "",
    manual_comment: "",
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
      status:
        record?.status && !["holiday", "on_leave", "exempted", "weekend"].includes(record.status)
          ? record.status
          : "auto",
      waived: record?.waived ?? false,
      waiver_reason: record?.waiver_reason ?? "",
      manual_comment: record?.manual_comment ?? "",
    })
  }

  async function saveEdit() {
    if (!editTarget) return
    setSaving(true)
    try {
      let res: Response
      if (editTarget.record) {
        // Update existing record â€” status is auto-derived by the API from clock times
        const body: Record<string, unknown> = {
          waived: editForm.waived,
          waiver_reason: editForm.waiver_reason || null,
          clock_in: editForm.clock_in || null,
          clock_out: editForm.clock_out || null,
          manual_comment: editForm.manual_comment,
        }
        if (editForm.status !== "auto") body.status = editForm.status
        res = await fetch(`/api/admin/hr/attendance/records/${editTarget.record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        // Create new record for a day with no existing record â€” status auto-derived by API
        const body: Record<string, unknown> = {
          user_id: report.user_id,
          date: editTarget.date,
          waived: editForm.waived,
          waiver_reason: editForm.waiver_reason || null,
          clock_in: editForm.clock_in || null,
          clock_out: editForm.clock_out || null,
          manual_comment: editForm.manual_comment,
        }
        if (editForm.status !== "auto") body.status = editForm.status
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
    return <div className="text-muted-foreground py-4 text-center text-sm">Loading daysâ€¦</div>
  }

  const today = toLocalISODate()
  const visibleDays = days.filter((d) => d.date <= today)
  const isCreating = editTarget !== null && editTarget.record === null
  const hasClockIn = Boolean(editForm.clock_in)
  const hasClockOut = Boolean(editForm.clock_out)
  const hasAnyTime = hasClockIn || hasClockOut
  const hasPartialTime = hasClockIn !== hasClockOut
  const invalidTimeRange = Boolean(editForm.clock_in && editForm.clock_out && editForm.clock_out < editForm.clock_in)
  const isNoTimePermission =
    editForm.waived ||
    editForm.status === "waiver" ||
    editForm.status === "absent_with_permission" ||
    editForm.status === "out_of_station"
  const missingRequiredTimes = !isNoTimePermission && (!hasAnyTime || hasPartialTime)
  const hasManualComment = editForm.manual_comment.trim().length >= 3
  const cannotSave =
    saving ||
    invalidTimeRange ||
    missingRequiredTimes ||
    !hasManualComment ||
    (editForm.waived && !editForm.waiver_reason.trim())

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
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {day.record?.clock_in ? (
                  <>
                    <Clock className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    <span>{formatTime(day.record.clock_in)}</span>
                  </>
                ) : (
                  "â€”"
                )}
              </span>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {day.record?.clock_out ? (
                  <>
                    <Clock className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    <span>{formatTime(day.record.clock_out)}</span>
                  </>
                ) : (
                  "â€”"
                )}
              </span>
              <span className="text-xs">{formatHours(hours.total ?? day.record?.total_hours ?? null)}</span>
              <span className="text-xs">{formatHours(hours.work)}</span>
              <span
                className={`text-xs ${hours.missed !== null && hours.missed > 0 ? "text-orange-500" : "text-muted-foreground"}`}
              >
                {hours.missed !== null ? formatHours(hours.missed) : "â€”"}
              </span>
              <span className="text-xs">
                {hours.overtime != null && hours.overtime >= 0.05 ? formatHours(hours.overtime) : "â€”"}
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
              {editTarget && `${report.user_name} â€” ${formatDayShort(editTarget.date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm((f) => ({ ...f, status: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_ATTENDANCE_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            {missingRequiredTimes && (
              <p className="text-muted-foreground text-xs">Provide both times, or choose AWP/OOS for a no-punch day.</p>
            )}
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
            <div className="space-y-2">
              <Label>
                Comment (required) <span className="text-destructive">*</span>
              </Label>
              <Input
                required
                placeholder="Reason for this manual attendance change"
                value={editForm.manual_comment}
                onChange={(e) => setEditForm((f) => ({ ...f, manual_comment: e.target.value }))}
              />
              {!hasManualComment && (
                <p className="text-[11px] font-medium text-red-500">
                  A comment is required for all manual attendance alterations.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={cannotSave}>
              {saving ? "Savingâ€¦" : isCreating ? "Create" : "Save"}
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
              <p className="text-muted-foreground text-sm">Loadingâ€¦</p>
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
                            <span className="text-muted-foreground">{String(value ?? "â€”")}</span>
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
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name?: string | null }>>([])
  // Unified Attendance Manager dialog
  const [managerOpen, setManagerOpen] = useState(false)

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
    "LWP",
    "Incomplete",
    "Exempted",
    "OOS",
    "AWP",
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
      r.lateness_with_permission_days ?? 0,
      r.incomplete_days || 0,
      r.exempted_days || 0,
      r.out_of_station_days ?? 0,
      r.absent_with_permission_days ?? 0,
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
    doc.text(`Attendance Report â€” ${periodMode === "quarter" ? `Q${quarter} ${quarterYear}` : yearMonth}`, 40, 40)
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
      attendanceRate: totalWorkDays > 0 ? `${((totalCredits / totalWorkDays) * 100).toFixed(2)}%` : "â€”",
      absentRate: totalWorkDays > 0 ? `${((totalAbsent / totalWorkDays) * 100).toFixed(2)}%` : "â€”",
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
      key: "lateness_with_permission_days",
      label: "LWP",
      sortable: true,
      accessor: (r) => r.lateness_with_permission_days ?? 0,
      render: (r) => <span className="text-amber-600">{r.lateness_with_permission_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "out_of_station_days",
      label: "OOS",
      sortable: true,
      accessor: (r) => r.out_of_station_days ?? 0,
      render: (r) => <span className="text-indigo-600">{r.out_of_station_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "absent_with_permission_days",
      label: "AWP",
      sortable: true,
      accessor: (r) => r.absent_with_permission_days ?? 0,
      render: (r) => <span className="text-teal-600">{r.absent_with_permission_days ?? 0}</span>,
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
      render: (_r) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setManagerOpen(true)}
          title="Open Attendance Manager"
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
        { value: "watch", label: "60â€“79%" },
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
              : "Records needing attention â€” late arrivals, missing clock-outs, absences."
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
            <Settings2 className="mr-2 h-4 w-4" />
            Attendance Manager
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
          searchPlaceholder="Search employee or departmentâ€¦"
          searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
          isLoading={loading}
          expandable={{
            render: (r) => (
              <EmployeeExpandPanel report={r} yearMonth={yearMonth} onRecordChanged={refreshSingleEmployeeSummary} />
            ),
          }}
          emptyTitle={loading ? "Loading attendance reportâ€¦" : "No attendance report"}
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

      <AttendanceManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        reports={reports}
        yearMonth={yearMonth}
        holidays={holidays}
        onHolidaysChanged={() => {
          void loadHolidays()
          void generateReport()
        }}
        onReportChanged={() => void generateReport()}
        lockedDepartment={lockedDepartment}
      />
    </DataTablePage>
  )
}
