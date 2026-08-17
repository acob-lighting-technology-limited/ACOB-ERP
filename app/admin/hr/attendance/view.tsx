"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { DailyRosterView } from "./_components/daily-roster-view"
import { CalendarView } from "./_components/calendar-view"
import type { EmployeeOption } from "./_components/calendar-view"
import { AppealsView } from "./_components/appeals-view"
import { LeaderboardView } from "./_components/leaderboard-view"
import { AttendanceManagerDialog } from "./_components/attendance-manager-dialog"
import { AttendanceReportDialog } from "./_components/attendance-report-dialog"
import { AttendanceExportDialog } from "./_components/attendance-export-dialog"
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
import { BarChart3, Download, FileText, Users, Clock, AlertCircle, Pencil, Info, Settings2, Mail } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import {
  ATTENDANCE_TRACKING_START,
  getWorkdaysInMonth,
  monthBounds,
  quarterBounds,
  toLocalISODate,
  toLocalYearMonth,
} from "@/lib/hr/attendance-utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  MANUAL_ATTENDANCE_STATUS_OPTIONS,
  getManualStatusEditOptions,
} from "@/lib/hr/attendance-status"
import { computeAttendanceDay, netDayHoursFor } from "@/lib/hr/attendance-ssot"
import { type AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { StatusBadge, labelSource } from "./_components/status-badge"
import { apiFetch } from "@/lib/api-client"

const log = logger("hr-attendance-reports")

interface AttendanceReport {
  user_id: string
  employee_no?: string
  user_name: string
  department: string
  total_days: number
  early_days?: number
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
  overtime_hours?: number
  avg_clock_in_minutes?: number | null
  avg_clock_out_minutes?: number | null
  appeal_count?: number
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
  manual_comment?: string | null
  updated_at?: string | null
  editor_first_name?: string | null
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
  | "early_closure"
  | "late_resumption"

interface CalendarDay {
  date: string
  dayName: string
  record: DayRecord | null
  isOnLeave: boolean
  status: DayStatus
  manualBy: string | null
  earlyClosureTime?: string | null
  lateResumptionTime?: string | null
}

/**
 * Source label for a day row. Real punch records use the device/manual/mixed label;
 * any manually-set day (holiday/leave/exemption, or a manual override) shows the
 * responsible person as "Manual (Name)"; a plain absence shows "—".
 */
function daySourceLabel(day: CalendarDay): string {
  if (day.status === "absent") return "—"
  const editor = day.manualBy || day.record?.editor_first_name
  if (day.record) {
    const s = labelSource(day.record)
    // A manually-set record (e.g. on_leave/OOS/waiver/AWP/LWP) reports as "Manual" or "Mixed" —
    // attach who set/approved it when known.
    if ((s === "Manual" || s === "Mixed" || s.startsWith("Manual")) && editor) {
      return `Manual (${editor})`
    }
    if (s && s !== "—") return s
  }
  // Derived manual status (holiday/leave/exempt/manual override)
  if (editor) return `Manual (${editor})`
  switch (day.status) {
    case "holiday":
    case "on_leave":
    case "exempted":
      return "Manual"
    default:
      return "—"
  }
}

type TimelineEvent = {
  id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  source: string | null
  comment: string | null
  created_at: string
  actor_name: string | null
  metadata?: Record<string, unknown> | null
}

type TimelineContext = {
  holiday: string | null
  holiday_added_by: string | null
  on_leave: string | null
  exempt: boolean
  exempt_reason: string | null
}

const EVENT_LABELS: Record<string, string> = {
  device_punch_in: "Clocked in (device)",
  device_punch_out: "Clocked out (device)",
  self_clock_in: "Clocked in",
  self_clock_out: "Clocked out",
  remote_clock_in: "Remote clock-in",
  remote_clock_out: "Remote clock-out",
  manual_create: "Manual record created",
  manual_update: "Manual edit",
  manual_delete: "Record deleted",
  bulk_grant: "Bulk grant",
  bulk_delete: "Bulk removal",
  appeal_requested: "Appeal requested",
  appeal_rejected: "Appeal rejected",
  appeal_approved: "Appeal approved",
  appeal_auto_resolved: "Appeal auto-approved",
  leave_granted: "Leave granted",
  leave_revoked: "Leave revoked",
  exemption_added: "Exemption added",
  exemption_removed: "Exemption removed",
  marked_incomplete: "Auto-marked incomplete",
}

function eventBadgeClass(eventType: string): string {
  if (eventType.startsWith("appeal_")) {
    if (eventType === "appeal_rejected") return "bg-red-100 text-red-800"
    if (eventType.includes("approved") || eventType.includes("resolved")) return "bg-emerald-100 text-emerald-800"
    return "bg-amber-100 text-amber-800"
  }
  if (eventType.startsWith("device_")) return "bg-blue-100 text-blue-800"
  if (eventType.startsWith("manual_") || eventType.startsWith("bulk_")) return "bg-violet-100 text-violet-800"
  if (eventType === "marked_incomplete") return "bg-cyan-100 text-cyan-800"
  return "bg-gray-100 text-gray-800"
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
    manual_by?: string | null
  }>
}

function currentYearMonth() {
  return toLocalYearMonth()
}

function formatDayShort(dateString: string) {
  return formatWATDate(dateString, { weekday: "short", month: "short", day: "numeric" })
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

function getHourBreakdown(
  record: DayRecord | null,
  status?: string,
  lateResumptionTime?: string | null,
  earlyClosureTime?: string | null,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
) {
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
    // An absent day costs the net shift (8.5h), not the gross 9h — lunch is never worked.
    if (status === "absent") return { total: null, work: 0, overtime: null, missed: netDayHoursFor(policy) }
    return { total: null, work: null, overtime: null, missed: null }
  }
  // One punch only — surface what the day actually costs (the recorded side's
  // bracket plus the incomplete penalty) instead of a dash. Work stays blank
  // because the missing half of the day is unverifiable.
  if (Boolean(record.clock_in) !== Boolean(record.clock_out)) {
    const { hoursLost } = computeAttendanceDay({
      status: "incomplete",
      clockIn: record.clock_in,
      clockOut: record.clock_out,
      policy,
      earlyCloseTime: earlyClosureTime ?? null,
      lateResumptionTime: lateResumptionTime ?? null,
    })
    return { total: null, work: null, overtime: null, missed: hoursLost }
  }
  const inMin = parseTimeToMinutes(record.clock_in)
  const outMin = parseTimeToMinutes(record.clock_out)
  if (inMin === null || outMin === null || outMin <= inMin) {
    return { total: null, work: null, overtime: null, missed: null }
  }
  const total = (outMin - inMin) / 60

  // Work, missed and overtime all come from the SSOT. Work and missed sit on the
  // bracketed 8.5-hour scale and always add up to the net day; overtime is strictly
  // time past the configured shift end, so arriving early is not overtime.
  // Only "total" is raw clock time.
  const {
    hoursLost: missed,
    hoursWorked: work,
    overtimeHours: overtime,
  } = computeAttendanceDay({
    status: "present",
    clockIn: record.clock_in,
    clockOut: record.clock_out,
    policy,
    earlyCloseTime: earlyClosureTime ?? null,
    lateResumptionTime: lateResumptionTime ?? null,
  })

  return { total, work, overtime, missed }
}

interface EmployeeExpandProps {
  report: AttendanceReport
  yearMonth: string
  policy: AttendancePolicy
  onRecordChanged?: (userId: string) => void
}

function EmployeeExpandPanel({ report, yearMonth, policy, onRecordChanged }: EmployeeExpandProps) {
  const [days, setDays] = useState<CalendarDay[] | null>(null)
  const [editTarget, setEditTarget] = useState<{ date: string; record: DayRecord | null } | null>(null)
  const [editForm, setEditForm] = useState({
    status: "",
    manual_comment: "",
  })
  const [saving, setSaving] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<TimelineEvent[]>([])
  const [historyContext, setHistoryContext] = useState<TimelineContext | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ date: string } | null>(null)

  function loadDays() {
    void (async () => {
      try {
        const qs = new URLSearchParams({
          user_id: report.user_id,
          year_month: yearMonth,
          exempt_hint: report.attendance_exempt ? "1" : "0",
        })
        const res = await apiFetch(`/api/admin/hr/attendance/employee-days?${qs.toString()}`, { cache: "no-store" })
        const payload = res.ok ? ((await res.json()) as UnifiedDayPayload) : null
        const calDays: CalendarDay[] = (payload?.data || []).map((row) => ({
          date: row.date,
          dayName: formatDayShort(row.date),
          record: row.record,
          isOnLeave: row.status === "on_leave",
          status: row.status as DayStatus,
          manualBy: row.manual_by ?? row.record?.editor_first_name ?? null,
          earlyClosureTime: (row as any).early_closure_time ?? null,
          lateResumptionTime: (row as any).late_resumption_time ?? null,
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
    const { initialStatus } = getManualStatusEditOptions(record)
    setEditTarget({ date, record })
    setEditForm({
      status:
        record?.status && ["lateness_with_permission", "absent_with_permission"].includes(record.status)
          ? record.status
          : initialStatus,
      manual_comment: record?.manual_comment ?? "",
    })
  }

  async function saveEdit() {
    if (!editTarget) return
    setSaving(true)
    try {
      let res: Response
      if (editTarget.record) {
        // Update existing record
        const body: Record<string, unknown> = {
          waived: false,
          manual_comment: editForm.manual_comment,
          status: editForm.status,
        }
        res = await apiFetch(`/api/admin/hr/attendance/records/${editTarget.record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        // Create new record
        const body: Record<string, unknown> = {
          user_id: report.user_id,
          date: editTarget.date,
          waived: false,
          manual_comment: editForm.manual_comment,
          status: editForm.status,
          clock_in: null,
          clock_out: null,
        }
        res = await apiFetch("/api/admin/hr/attendance/records", {
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
    setHistoryTarget({ date: day.date })
    setHistoryOpen(true)
    setHistoryItems([])
    setHistoryContext(null)
    setHistoryLoading(true)
    try {
      const qs = new URLSearchParams({ user_id: report.user_id, date: day.date })
      const res = await apiFetch(`/api/admin/hr/attendance/timeline?${qs.toString()}`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as {
        data?: { events?: TimelineEvent[]; context?: TimelineContext }
      } | null
      if (!res.ok) throw new Error("Failed to load timeline")
      setHistoryItems(payload?.data?.events || [])
      setHistoryContext(payload?.data?.context || null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load timeline")
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
  const { isOnTimePresent, options: statusOptions } = getManualStatusEditOptions(editTarget?.record ?? null)

  const hasManualComment = editForm.manual_comment.trim().length >= 3
  const cannotSave = saving || !editForm.status || !hasManualComment || isOnTimePresent

  return (
    <>
      <div className="bg-muted/40 mb-4 grid max-w-4xl grid-cols-3 gap-2 rounded-lg border p-3 sm:grid-cols-5 lg:grid-cols-9">
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">Late</span>
          <span className="mt-1 text-sm font-semibold text-yellow-600">{report.late_days}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">Incomplete</span>
          <span className="mt-1 text-sm font-semibold text-cyan-600">{report.incomplete_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">Exempted</span>
          <span className="mt-1 text-sm font-semibold text-violet-600">{report.exempted_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">LWP</span>
          <span className="mt-1 text-sm font-semibold text-amber-600">{report.lateness_with_permission_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">OOS</span>
          <span className="mt-1 text-sm font-semibold text-indigo-600">{report.out_of_station_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">AWP</span>
          <span className="mt-1 text-sm font-semibold text-teal-600">{report.absent_with_permission_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">Leave</span>
          <span className="mt-1 text-sm font-semibold text-purple-600">{report.leave_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">Holiday</span>
          <span className="mt-1 text-sm font-semibold text-sky-600">{report.holiday_days || 0}</span>
        </div>
        <div className="bg-background flex flex-col items-center justify-center rounded border p-2 text-center">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">Waiver</span>
          <span className="mt-1 text-sm font-semibold text-blue-600">{report.waived_days || 0}</span>
        </div>
      </div>

      <div className="space-y-1 py-2">
        <div className="text-muted-foreground grid grid-cols-[130px_90px_70px_70px_80px_80px_80px_90px_120px_60px] items-center gap-3 px-2 text-[11px] font-semibold uppercase">
          <span>Day</span>
          <span>Status</span>
          <span>In</span>
          <span>Out</span>
          <span>Work</span>
          <span>Missed</span>
          <span>Total</span>
          <span>Overtime</span>
          <span>Source</span>
          <span></span>
        </div>
        {visibleDays.map((day) => {
          const hours = getHourBreakdown(day.record, day.status, day.lateResumptionTime, day.earlyClosureTime, policy)
          return (
            <div
              key={day.date}
              className="hover:bg-muted/30 grid grid-cols-[130px_90px_70px_70px_80px_80px_80px_90px_120px_60px] items-center gap-3 rounded px-2 py-1.5 text-sm"
            >
              <span className="text-xs font-medium">{day.dayName}</span>
              <div>
                <StatusBadge
                  status={day.status}
                  waived={day.record?.waived}
                  record={day.record}
                  earlyClosure={day.earlyClosureTime ? { closeTime: day.earlyClosureTime } : null}
                />
              </div>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {day.record?.clock_in ? (
                  <>
                    <Clock className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    <span>{formatTime(day.record.clock_in)}</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {day.record?.clock_out ? (
                  <>
                    <Clock className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    <span>{formatTime(day.record.clock_out)}</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
              <span className="text-xs">{formatHours(hours.work)}</span>
              <span
                className={`text-xs ${hours.missed !== null && hours.missed > 0 ? "text-orange-500" : "text-muted-foreground"}`}
              >
                {hours.missed !== null ? formatHours(hours.missed) : "—"}
              </span>
              <span className="text-xs">{formatHours(hours.total ?? day.record?.total_hours ?? null)}</span>
              <span className="text-xs">
                {hours.overtime != null && hours.overtime >= 0.05 ? formatHours(hours.overtime) : "—"}
              </span>
              <span className="text-xs">{daySourceLabel(day)}</span>
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
            {isOnTimePresent ? (
              <p className="text-muted-foreground text-sm">
                This record is fully present and on-time. No overrides (LWP/AWP) are applicable.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={editForm.status}
                    onValueChange={(value) => setEditForm((f) => ({ ...f, status: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status..." />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
              </>
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
            <DialogTitle>Day Timeline</DialogTitle>
            <DialogDescription>
              {historyTarget ? `${report.user_name} — ${formatDayShort(historyTarget.date)}` : ""}
            </DialogDescription>
          </DialogHeader>

          {historyContext && (historyContext.holiday || historyContext.on_leave || historyContext.exempt) && (
            <div className="flex flex-wrap gap-2">
              {historyContext.holiday && (
                <Badge className="bg-sky-100 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                  Holiday — {historyContext.holiday}
                  {historyContext.holiday_added_by ? ` · added by ${historyContext.holiday_added_by}` : ""}
                </Badge>
              )}
              {historyContext.on_leave && (
                <Badge className="bg-purple-100 text-xs text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                  On leave — {historyContext.on_leave}
                </Badge>
              )}
              {historyContext.exempt && (
                <Badge className="bg-violet-100 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                  Exempt{historyContext.exempt_reason ? ` — ${historyContext.exempt_reason}` : ""}
                </Badge>
              )}
            </div>
          )}

          <div className="max-h-[420px] space-y-3 overflow-y-auto">
            {historyLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : historyItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">No recorded events for this day.</p>
            ) : (
              historyItems.map((item) => {
                const label = EVENT_LABELS[item.event_type] ?? item.event_type.replaceAll("_", " ")
                const fromLabel = item.from_status
                  ? (ATTENDANCE_STATUS_LABELS[item.from_status as keyof typeof ATTENDANCE_STATUS_LABELS] ??
                    item.from_status)
                  : null
                const toLabel = item.to_status
                  ? (ATTENDANCE_STATUS_LABELS[item.to_status as keyof typeof ATTENDANCE_STATUS_LABELS] ??
                    item.to_status)
                  : null
                const isAutomated = item.actor_name === null
                return (
                  <div key={item.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`text-xs ${eventBadgeClass(item.event_type)}`}>{label}</Badge>
                      <p className="text-sm font-medium">{isAutomated ? "System / Device" : item.actor_name}</p>
                    </div>
                    <p className="text-muted-foreground text-xs">{formatWATDateTime(item.created_at)}</p>
                    {(fromLabel || toLabel) && (
                      <p className="mt-1 text-xs">
                        <span className="font-medium">Status:</span>{" "}
                        <span className="text-muted-foreground">
                          {fromLabel ? `${fromLabel} → ` : ""}
                          {toLabel ?? "—"}
                        </span>
                      </p>
                    )}
                    {item.comment && (
                      <p className="mt-1 text-xs">
                        <span className="font-medium">Comment:</span>{" "}
                        <span className="text-muted-foreground">{item.comment}</span>
                      </p>
                    )}
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

type AttendanceTab = "summary" | "daily" | "calendar" | "appeals" | "leaderboard"

const ATTENDANCE_TABS: DataTableTab[] = [
  { key: "daily", label: "Daily Roster" },
  { key: "summary", label: "Summary" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "calendar", label: "Calendar" },
  { key: "appeals", label: "Appeals" },
]

export function AttendanceReportsPage({
  backLinkHref,
  lockedDepartment,
}: { backLinkHref?: string; lockedDepartment?: string } = {}) {
  const searchParams = useSearchParams()
  // Notifications deep-link straight to a tab (e.g. appeal alerts → ?tab=appeals).
  const requestedTab = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState<AttendanceTab>(
    ATTENDANCE_TABS.some((t) => t.key === requestedTab) ? (requestedTab as AttendanceTab) : "daily"
  )
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<AttendanceReport[]>([])
  // Rows currently visible in the table (after search + filters + sort).
  const [processedReports, setProcessedReports] = useState<AttendanceReport[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  // Served by the reports API so day breakdowns here charge the same hours the
  // server did. Defaults only apply until the first response lands.
  const [policy, setPolicy] = useState<AttendancePolicy>(DEFAULT_ATTENDANCE_POLICY)
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [periodMode, setPeriodMode] = useState<"month" | "quarter">("month")
  const [quarter, setQuarter] = useState<"Q1" | "Q2" | "Q3" | "Q4">("Q1")
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear())
  const reportDepartment = lockedDepartment || "all"
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name?: string | null }>>([])
  // Unified Attendance Manager dialog
  const [managerOpen, setManagerOpen] = useState(false)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)

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
        const response = await apiFetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
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
      const response = await apiFetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as {
        data?: AttendanceReport[]
        departments?: string[]
        policy?: AttendancePolicy
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
      if (payload?.policy) setPolicy({ ...DEFAULT_ATTENDANCE_POLICY, ...payload.policy })
    } catch (error) {
      log.error("Error generating report:", error)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [yearMonth, reportDepartment, periodMode, quarter, quarterYear, lockedDepartment])

  const loadHolidays = useCallback(async () => {
    const response = await apiFetch(`/api/admin/hr/attendance/holidays?month=${yearMonth}`, { cache: "no-store" })
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

  const departmentOptions = useMemo(() => departments.map((d) => ({ value: d, label: d })), [departments])

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth()

    const [trackingStartYear, trackingStartMonth] = ATTENDANCE_TRACKING_START.split("-").map(Number)
    const startYear = trackingStartYear
    const startMonth = trackingStartMonth - 1

    let y = currentYear
    let m = currentMonth

    while (y > startYear || (y === startYear && m >= startMonth)) {
      const d = new Date(y, m, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      options.push({ value, label })
      m--
      if (m < 0) {
        m = 11
        y--
      }
    }
    return options
  }, [])

  const stats = useMemo(() => {
    const totalHours = reports.reduce((a, r) => a + (r.total_hours ?? 0), 0)
    const totalMissedHours = reports.reduce((a, r) => a + (r.total_missed_hours ?? 0), 0)
    return {
      employees: reports.length,
      totalHours: `${(Math.round(totalHours * 10) / 10).toLocaleString()} hrs`,
      totalMissedHours: `${(Math.round(totalMissedHours * 10) / 10).toLocaleString()} hrs`,
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
      key: "early_days",
      label: "Early",
      sortable: true,
      accessor: (r) => r.early_days ?? 0,
      render: (r) => <span className="text-green-600">{r.early_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "present_days",
      label: "Present",
      sortable: true,
      accessor: (r) => r.present_days,
      render: (r) => <span className="text-blue-600">{r.present_days}</span>,
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
      key: "incomplete_days",
      label: "Incomplete",
      sortable: true,
      accessor: (r) => r.incomplete_days ?? 0,
      render: (r) => <span className="text-cyan-600">{r.incomplete_days ?? 0}</span>,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "lwp_awp_days",
      label: "LWP/AWP",
      sortable: true,
      accessor: (r) => (r.lateness_with_permission_days ?? 0) + (r.absent_with_permission_days ?? 0),
      render: (r) => (
        <span className="text-amber-600">
          {(r.lateness_with_permission_days ?? 0) + (r.absent_with_permission_days ?? 0)}
        </span>
      ),
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
      key: "month",
      label: "Month",
      options: monthOptions,
      placeholder: "Select Month",
      multi: false,
      defaultValues: [yearMonth],
      mode: "custom",
      filterFn: () => true,
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
              : activeTab === "leaderboard"
                ? "Rankings across punctuality, hours, and reliability for the selected period."
                : "Records needing attention — late arrivals, missing clock-outs, absences."
      }
      icon={BarChart3}
      backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
      tabs={ATTENDANCE_TABS}
      activeTab={activeTab}
      onTabChange={(t) => setActiveTab(t as AttendanceTab)}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setReportDialogOpen(true)} size="sm">
            <Mail className="mr-1.5 h-4 w-4" />
            <span className="hidden sm:inline">Reports</span>
          </Button>
          {!lockedDepartment && (
            <Button variant="outline" onClick={() => setManagerOpen(true)} size="sm">
              <Settings2 className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Attendance Manager</span>
              <span className="sm:hidden">Manager</span>
            </Button>
          )}
          <Button variant="outline" onClick={() => setIsExportOpen(true)} disabled={reports.length === 0} size="sm">
            <Download className="mr-1.5 h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
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
              title="Total Work Hours"
              value={stats.totalHours}
              icon={Clock}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
            <StatCard
              title="Missed Hours"
              value={stats.totalMissedHours}
              icon={AlertCircle}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
          </div>
        ) : undefined
      }
    >
      {activeTab === "daily" && <DailyRosterView departments={departments} lockedDepartment={lockedDepartment} />}
      {activeTab === "leaderboard" && <LeaderboardView departments={departments} lockedDepartment={lockedDepartment} />}
      {activeTab === "calendar" && <CalendarView employees={employeeOptions} />}
      {activeTab === "appeals" && <AppealsView lockedDepartment={lockedDepartment} />}
      {activeTab === "summary" && (
        <DataTable<AttendanceReport>
          data={reports}
          columns={columns}
          onProcessedDataChange={setProcessedReports}
          filters={reportFilters}
          getRowId={(r) => r.user_id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search employee or department…"
          searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
          isLoading={loading}
          onFilterChange={(filters) => {
            const selectedMonth = filters.month?.[0]
            if (selectedMonth && selectedMonth !== yearMonth) {
              setYearMonth(selectedMonth)
            }
          }}
          expandable={{
            render: (r) => (
              <EmployeeExpandPanel
                report={r}
                yearMonth={yearMonth}
                policy={policy}
                onRecordChanged={refreshSingleEmployeeSummary}
              />
            ),
          }}
          viewToggle
          cardRenderer={(r) => (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold">{r.user_name}</h4>
                  <p className="text-muted-foreground text-xs">{r.department}</p>
                </div>
                {r.attendance_exempt && <Badge variant="outline">Exempt</Badge>}
              </div>
              <div className="border-border/40 grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Early / Present</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {r.early_days ?? 0} early / {r.present_days} present
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Absent</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">{r.absent_days} days</span>
                </div>
              </div>
            </div>
          )}
          emptyTitle={loading ? "Loading attendance report…" : "No attendance report"}
          emptyDescription="No attendance results available for this period."
          emptyIcon={FileText}
          skeletonRows={6}
        />
      )}
      <AttendanceExportDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        department={lockedDepartment}
        monthOptions={monthOptions}
      />

      {!lockedDepartment && (
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
        />
      )}

      <AttendanceReportDialog open={reportDialogOpen} onOpenChange={setReportDialogOpen} />
    </DataTablePage>
  )
}
