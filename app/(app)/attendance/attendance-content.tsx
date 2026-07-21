"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { formatWATDate } from "@/lib/utils/date"
import { Clock, Download, FileQuestion, UserCheck, MapPin, BarChart3, AlertCircle, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { EmployeeCalendarView } from "./calendar-view"
import { AppealDialog } from "./_components/appeal-dialog"
import { StatCard } from "@/components/ui/stat-card"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { AttendanceRecord } from "./page"
import { logger } from "@/lib/logger"
import { RemoteCheckinModal } from "@/components/attendance/remote-checkin-modal"
import { dayCredit, toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  deriveUnifiedAttendanceStatus,
} from "@/lib/hr/attendance-status"
import type { UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { apiFetch } from "@/lib/api-client"

const log = logger("dashboard-attendance-attendance-content")

interface AttendanceContentProps {
  initialTodayRecord: AttendanceRecord | null
  initialRecentRecords: AttendanceRecord[]
  remoteCheckinEnabled?: boolean
}

type AttendanceRow = AttendanceRecord & {
  dayLabel: string
  dateLabel: string
  periodLabel: string
  monthLabel: string
  calculatedTotalHours: number | null
  workHours: number | null
  overtimeHours: number | null
  missedHoursValue: number | null
  normalizedStatus: UnifiedAttendanceStatus
}

type AppealRecord = {
  id: string
  appeal_date: string
  status: string
  requested_status: string
  appeal_reason: string
  resolution_note: string | null
  created_at: string
}
type UnifiedDay = {
  date: string
  record: AttendanceRecord | null
  status: AttendanceRow["normalizedStatus"]
  deduction?: number
}

function parseClockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function minutesToHours(minutes: number): number {
  return minutes / 60
}

function calculateHourBreakdown(
  clockIn: string | null | undefined,
  clockOut: string | null | undefined,
  lateResumptionTime?: string | null,
  earlyClosureTime?: string | null
) {
  const inMinutes = parseClockToMinutes(clockIn)
  const outMinutes = parseClockToMinutes(clockOut)
  if (inMinutes === null || outMinutes === null || outMinutes <= inMinutes) {
    return { total: null, work: null, overtime: null, missed: null }
  }

  const totalMinutes = outMinutes - inMinutes
  const totalHours = minutesToHours(totalMinutes)

  const workStart = 8 * 60
  const workEnd = 17 * 60
  const overlapStart = Math.max(inMinutes, workStart)
  const overlapEnd = Math.min(outMinutes, workEnd)

  const rawWorkMinutes = Math.max(0, overlapEnd - overlapStart)
  // Subtract 1 hour (60 minutes) only if total time in office >= 5 hours
  const breakMinutes = totalHours >= 5 ? 60 : 0
  const workMinutes = Math.max(0, rawWorkMinutes - breakMinutes)
  const overtimeMinutes = Math.max(0, totalMinutes - rawWorkMinutes)

  // 1. Calculate Lateness Hours
  let lateness = 0
  const graceMin = 8 * 60 + 20 // 08:20 AM
  const nineMin = 9 * 60 // 09:00 AM

  // If clock-in is after 4:00 PM (16:00), they are considered absent (8.5 hrs missed)
  if (inMinutes > 16 * 60) {
    return {
      total: totalHours,
      work: minutesToHours(workMinutes),
      overtime: minutesToHours(overtimeMinutes),
      missed: 8.5,
    }
  }

  if (lateResumptionTime) {
    const [rh, rm] = lateResumptionTime.split(":").map(Number)
    if (!isNaN(rh) && !isNaN(rm)) {
      const resumptionMin = rh * 60 + rm
      if (inMinutes > resumptionMin) {
        lateness = Math.ceil((inMinutes - resumptionMin) / 60)
      }
    }
  } else {
    if (inMinutes > graceMin) {
      if (inMinutes <= nineMin) {
        lateness = 0.5
      } else {
        lateness = Math.ceil((inMinutes - nineMin) / 60)
      }
    }
  }

  // 2. Calculate Early Departure Hours (capped at 5:00 PM or early closure close time)
  let earlyDeparture = 0
  const effectiveEnd = earlyClosureTime ? (parseClockToMinutes(earlyClosureTime) ?? workEnd) : workEnd
  if (outMinutes < effectiveEnd) {
    earlyDeparture = Math.ceil((effectiveEnd - outMinutes) / 60)
  }

  return {
    total: totalHours,
    work: minutesToHours(workMinutes),
    overtime: minutesToHours(overtimeMinutes),
    missed: lateness + earlyDeparture,
  }
}

function getPrevMonth(yearMonth: string, n: number): string {
  const [year, month] = yearMonth.split("-").map(Number)
  const d = new Date(year, month - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function getClockOutLabel(row: Pick<AttendanceRow, "clock_in" | "clock_out" | "date">): string {
  if (row.clock_out) return row.clock_out
  if (row.clock_in && row.date === toLocalISODate()) return "In Progress"
  return "-"
}

function isCoveredStatus(status: AttendanceRow["normalizedStatus"]) {
  return (
    status === "waiver" ||
    status === "exempted" ||
    status === "on_leave" ||
    status === "holiday" ||
    status === "absent_with_permission"
  )
}

const ATTENDANCE_TABS: DataTableTab[] = [
  { key: "log", label: "Log" },
  { key: "calendar", label: "Calendar" },
]

export function AttendanceContent({
  initialTodayRecord,
  initialRecentRecords,
  remoteCheckinEnabled = false,
}: AttendanceContentProps) {
  const [activeTab, setActiveTab] = useState<"log" | "calendar">("log")
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(initialTodayRecord)
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>(initialRecentRecords)
  const [unifiedDays, setUnifiedDays] = useState<UnifiedDay[] | null>(null)
  const [filteredRows, setFilteredRows] = useState<AttendanceRow[]>([])
  const [remoteModalOpen, setRemoteModalOpen] = useState(false)
  const [remoteMode, setRemoteMode] = useState<"clock-in" | "clock-out">("clock-in")
  const [appeals, setAppeals] = useState<AppealRecord[]>([])
  const [appealDialogRow, setAppealDialogRow] = useState<AttendanceRow | null>(null)
  const [editAppeal, setEditAppeal] = useState<AppealRecord | null>(null)
  const [cancelAppealId, setCancelAppealId] = useState<string | null>(null)
  const [isCancellingAppeal, setIsCancellingAppeal] = useState(false)
  const currentMonthLabel = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "Africa/Lagos",
    })
  }, [])

  const fetchAttendanceData = useCallback(async () => {
    try {
      const ym = toLocalYearMonth()
      const today = toLocalISODate()
      // Fetch current month + 2 previous months so the log and filter show history
      const months = [getPrevMonth(ym, 2), getPrevMonth(ym, 1), ym]
      const results = await Promise.all(
        months.map((m) =>
          apiFetch(`/api/hr/attendance/my-days?year_month=${m}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => (d?.data as UnifiedDay[]) ?? [])
            .catch(() => [] as UnifiedDay[])
        )
      )
      const allDays = results.flat()
      setUnifiedDays(allDays)
      const todayRec = allDays.find((row) => row.date === today)?.record ?? null
      setTodayRecord(todayRec)
      setRecentRecords(allDays.map((row) => row.record).filter(Boolean) as AttendanceRecord[])
    } catch (error) {
      log.error("Error fetching attendance:", error)
    }
  }, [])

  const fetchAppeals = useCallback(async () => {
    try {
      const res = await apiFetch("/api/hr/attendance/appeals", { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (res.ok) {
        setAppeals((payload?.data as AppealRecord[]) ?? [])
      }
    } catch (err) {
      log.error("Error fetching appeals:", err)
    }
  }, [])

  const handleCancelAppeal = useCallback(
    async (appealId: string) => {
      try {
        const res = await apiFetch(`/api/hr/attendance/appeals?id=${appealId}`, {
          method: "DELETE",
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error ?? "Failed to cancel appeal")
        toast.success("Appeal cancelled successfully")
        void fetchAppeals()
        void fetchAttendanceData()
      } catch (err) {
        log.error("Error cancelling appeal:", err)
        toast.error(err instanceof Error ? err.message : "Failed to cancel appeal")
      }
    },
    [fetchAppeals, fetchAttendanceData]
  )

  useEffect(() => {
    void fetchAttendanceData()
    void fetchAppeals()
  }, [fetchAttendanceData, fetchAppeals])

  const rows = useMemo<AttendanceRow[]>(() => {
    if (unifiedDays === null) return []

    return unifiedDays
      .map((unified) => {
        const workday = unified.date
        const existing = unified.record
        // Use noon UTC so timezone conversion (WAT +1) never shifts the calendar date
        const dateObj = new Date(`${workday}T12:00:00Z`)
        // Month label: "June 2026" — use en-US without day to avoid "1 June 2026" from en-GB defaults
        const monthLabel = dateObj.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "Africa/Lagos",
        })

        if (!existing) {
          const normalizedStatus = (unified.status as AttendanceRow["normalizedStatus"]) || "absent"
          return {
            id: `missing-${workday}`,
            date: workday,
            clock_in: null,
            clock_out: null,
            total_hours: null,
            status: "no_record",
            dayLabel: formatWATDate(dateObj, { weekday: "short" }),
            dateLabel: formatWATDate(dateObj, { day: "2-digit", month: "long", year: "numeric" }),
            periodLabel: "-",
            monthLabel,
            calculatedTotalHours: null,
            workHours: null,
            overtimeHours: null,
            missedHoursValue: null,
            normalizedStatus,
          } as AttendanceRow
        }

        const normalizedStatus =
          (unified.status as AttendanceRow["normalizedStatus"]) || normalizeStatus(existing, workday)
        const breakdown = isCoveredStatus(normalizedStatus)
          ? { total: null, work: null, overtime: null, missed: null }
          : calculateHourBreakdown(
              existing.clock_in,
              existing.clock_out,
              (unified as any).late_resumption_time,
              (unified as any).early_closure_time
            )

        return {
          ...existing,
          total_hours: breakdown.total ?? existing.total_hours,
          dayLabel: formatWATDate(dateObj, { weekday: "short" }),
          dateLabel: formatWATDate(dateObj, { day: "2-digit", month: "long", year: "numeric" }),
          periodLabel: `${existing.clock_in || "-"} - ${getClockOutLabel({ ...existing, date: workday })}`,
          monthLabel,
          calculatedTotalHours: breakdown.total,
          workHours: breakdown.work,
          overtimeHours: breakdown.overtime,
          missedHoursValue: breakdown.missed,
          normalizedStatus,
        } as AttendanceRow
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [unifiedDays])

  // Seed filteredRows with current month's rows on first load so stat cards align with default filter
  useEffect(() => {
    if (rows.length > 0) {
      setFilteredRows(rows.filter((r) => r.monthLabel === currentMonthLabel))
    }
  }, [rows, currentMonthLabel])

  const columns = useMemo<DataTableColumn<AttendanceRow>[]>(
    () => [
      {
        key: "day",
        label: "Day",
        sortable: true,
        accessor: (row) => row.dayLabel,
        render: (row) => <span className="font-medium">{row.dayLabel}</span>,
        hideOnMobile: true,
      },
      {
        key: "clock_in",
        label: "Clock In",
        sortable: true,
        accessor: (row) => row.clock_in ?? "",
        render: (row) => (
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-green-600" />
            <span>{row.clock_in || "-"}</span>
          </span>
        ),
      },
      {
        key: "clock_out",
        label: "Clock Out",
        sortable: true,
        accessor: (row) => row.clock_out ?? "",
        render: (row) => (
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-red-500" />
            <span>{getClockOutLabel(row)}</span>
          </span>
        ),
      },
      {
        key: "total_hours",
        label: "Total Hours",
        sortable: true,
        accessor: (row) => row.calculatedTotalHours || row.total_hours || 0,
        render: (row) => (row.calculatedTotalHours != null ? `${row.calculatedTotalHours.toFixed(2)} hrs` : "-"),
      },
      {
        key: "work_hours",
        label: "Work Hour",
        sortable: true,
        accessor: (row) => row.workHours || 0,
        render: (row) => (row.workHours != null ? `${row.workHours.toFixed(2)} hrs` : "-"),
        hideOnMobile: true,
      },
      {
        key: "missed_hours",
        label: "Missed",
        sortable: true,
        accessor: (row) => row.missedHoursValue || 0,
        render: (row) =>
          row.missedHoursValue != null && row.missedHoursValue > 0 ? (
            <span className="text-orange-500">{row.missedHoursValue.toFixed(2)} hrs</span>
          ) : row.missedHoursValue != null ? (
            "0.00 hrs"
          ) : (
            "-"
          ),
        hideOnMobile: true,
      },
      {
        key: "overtime_hours",
        label: "Overtime",
        sortable: true,
        accessor: (row) => row.overtimeHours || 0,
        render: (row) =>
          row.overtimeHours != null && row.overtimeHours >= 0.05 ? `${row.overtimeHours.toFixed(2)} hrs` : "-",
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.normalizedStatus,
        render: (row) => <StatusBadge status={row.normalizedStatus} />,
      },
      {
        key: "actions",
        label: "Action",
        render: (row) => {
          const rowAppeals = appeals.filter((a) => a.appeal_date === row.date)
          const pendingAppeal = rowAppeals.find((a) => a.status === "pending")
          const approvedAppeal = rowAppeals.find((a) => a.status === "approved")
          const hasRejected = rowAppeals.some((a) => a.status === "rejected")
          const isEligible = (["absent", "late", "incomplete"] as string[]).includes(row.normalizedStatus)

          if (!isEligible && rowAppeals.length === 0) {
            return null
          }

          let content = null

          if (pendingAppeal) {
            content = (
              <Badge variant="outline" className="border-amber-500 bg-amber-500/5 text-amber-500 hover:bg-amber-500/5">
                Pending
              </Badge>
            )
          } else if (approvedAppeal) {
            return null
          } else if (hasRejected) {
            content = (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/20"
                onClick={() => {
                  setEditAppeal(null)
                  setAppealDialogRow(row)
                }}
              >
                <FileQuestion className="h-3.5 w-3.5" />
                Re-appeal
              </Button>
            )
          } else if (isEligible) {
            content = (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => {
                  setEditAppeal(null)
                  setAppealDialogRow(row)
                }}
              >
                <FileQuestion className="h-3.5 w-3.5" />
                Appeal
              </Button>
            )
          }

          if (!content) return null

          return <div className="flex items-center gap-1.5">{content}</div>
        },
      },
    ],
    [appeals]
  )

  const filters = useMemo<DataTableFilter<AttendanceRow>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        mode: "custom",
        options: (Object.keys(ATTENDANCE_STATUS_LABELS) as Array<keyof typeof ATTENDANCE_STATUS_LABELS>).map((s) => ({
          value: s,
          label: ATTENDANCE_STATUS_LABELS[s],
        })),
        filterFn: (row, selected) => selected.includes(row.normalizedStatus),
      },
      {
        key: "month",
        label: "Month",
        mode: "custom",
        options: Array.from(new Set(rows.map((row) => row.monthLabel))).map((month) => ({
          value: month,
          label: month,
        })),
        defaultValues: [currentMonthLabel],
        filterFn: (row, selected) => selected.includes(row.monthLabel),
      },
    ],
    [rows, currentMonthLabel]
  )

  const todayIso = toLocalISODate()
  const todayHours = todayRecord?.total_hours ? `${todayRecord.total_hours.toFixed(2)} hrs` : "-"
  const todayStatus = todayRecord ? normalizeStatus(todayRecord, todayIso) : "absent"

  // Rates are computed from whatever rows survive the active filter — "all time" when no filter is set
  const { attendanceRate, absentRate, attendedDays, totalWorkdays } = useMemo(() => {
    const scorable = filteredRows.filter((row) => {
      if (isCoveredStatus(row.normalizedStatus)) return false
      // Exclude a day still in progress (clocked in today, not yet clocked out)
      if (row.date === todayIso && row.clock_in && !row.clock_out) return false
      return true
    })
    if (scorable.length === 0) return { attendanceRate: 0, absentRate: 0, attendedDays: 0, totalWorkdays: 0 }
    let credits = 0
    for (const row of scorable) credits += dayCredit(row.normalizedStatus, row.clock_in, row.clock_out)
    const attendanceRate = Math.round((credits / scorable.length) * 100)
    const absentDays = scorable.filter((r) => r.normalizedStatus === "absent").length
    const absentRate = Math.round((absentDays / scorable.length) * 100)
    const attended = scorable.filter(
      (row) => row.normalizedStatus !== "absent" && row.normalizedStatus !== "absent_with_permission"
    ).length
    return { attendanceRate, absentRate, attendedDays: attended, totalWorkdays: scorable.length }
  }, [filteredRows, todayIso])

  function exportCSV() {
    const headers = ["Date", "Day", "Clock In", "Clock Out", "Total Hours", "Work Hour", "Overtime", "Status"]
    const csvRows = rows.map((row) => [
      row.dateLabel,
      row.dayLabel,
      row.clock_in || "-",
      row.clock_out || "-",
      row.calculatedTotalHours != null ? row.calculatedTotalHours.toFixed(2) : "-",
      row.workHours != null ? row.workHours.toFixed(2) : "-",
      row.overtimeHours != null ? row.overtimeHours.toFixed(2) : "-",
      row.normalizedStatus,
    ])
    const csv = [headers, ...csvRows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `my_attendance_${toLocalYearMonth()}.csv`
    a.click()
  }

  return (
    <>
      <DataTablePage
        title="Attendance"
        description="Track your work hours and attendance records."
        icon={Clock}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
        tabs={ATTENDANCE_TABS}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as "log" | "calendar")}
        actions={
          <div className="flex items-center gap-2">
            {remoteCheckinEnabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Determine mode: if clocked in today but no clock-out → clock-out; else → clock-in
                  const mode = todayRecord?.clock_in && !todayRecord?.clock_out ? "clock-out" : "clock-in"
                  setRemoteMode(mode)
                  setRemoteModalOpen(true)
                }}
              >
                <MapPin className="mr-2 h-4 w-4" />
                Remote {todayRecord?.clock_in && !todayRecord?.clock_out ? "Clock Out" : "Clock In"}
              </Button>
            )}
            <Button variant="outline" onClick={exportCSV} size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        }
        stats={
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                title="Today Status"
                value={ATTENDANCE_STATUS_LABELS[todayStatus] ?? todayStatus}
                icon={UserCheck}
                iconBgColor="bg-blue-500/10"
                iconColor="text-blue-500"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <StatCard
                      title="Total Days"
                      value={`${attendedDays} / ${totalWorkdays} days`}
                      icon={Calendar}
                      iconBgColor="bg-emerald-500/10"
                      iconColor="text-emerald-500"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">
                    Expected workdays in the period. Excludes holidays, leaves, exemptions, waivers, and AWP.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <StatCard
                      title="Attendance Rate"
                      value={`${attendanceRate}%`}
                      icon={BarChart3}
                      iconBgColor={
                        attendanceRate >= 80
                          ? "bg-emerald-500/10"
                          : attendanceRate >= 60
                            ? "bg-yellow-500/10"
                            : "bg-red-500/10"
                      }
                      iconColor={
                        attendanceRate >= 80
                          ? "text-emerald-500"
                          : attendanceRate >= 60
                            ? "text-yellow-500"
                            : "text-red-500"
                      }
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">
                    Calculated as (attendance credits / total workdays). Excused days do not count against you.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <StatCard
                      title="Absent Rate"
                      value={`${absentRate}%`}
                      icon={AlertCircle}
                      iconBgColor={
                        absentRate <= 10 ? "bg-emerald-500/10" : absentRate <= 25 ? "bg-yellow-500/10" : "bg-red-500/10"
                      }
                      iconColor={
                        absentRate <= 10 ? "text-emerald-500" : absentRate <= 25 ? "text-yellow-500" : "text-red-500"
                      }
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">
                    Percentage of unexcused absences over total workdays. Excused days (holidays, leaves, etc.) are
                    excluded.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        }
      >
        {activeTab === "calendar" ? (
          <EmployeeCalendarView />
        ) : (
          <DataTable<AttendanceRow>
            data={rows}
            columns={columns}
            filters={filters}
            getRowId={(row) => row.id}
            searchPlaceholder="Search day, clock in/out, or status..."
            searchFn={(row, query) =>
              `${row.dayLabel} ${row.dateLabel} ${row.periodLabel} ${row.status}`.toLowerCase().includes(query)
            }
            pagination={{ pageSize: 20 }}
            onProcessedDataChange={(processed) =>
              setFilteredRows((prev) => {
                const next = processed as AttendanceRow[]
                // Bail out when the processed set is unchanged so we never set a
                // new array reference on every render — that loop is what threw
                // React #185 ("maximum update depth exceeded") when filtering.
                if (prev.length === next.length && prev.every((row, i) => row.id === next[i]?.id)) {
                  return prev
                }
                return next
              })
            }
            isLoading={unifiedDays === null}
            emptyTitle={unifiedDays === null ? "Loading attendance..." : "No attendance records"}
            emptyDescription={
              unifiedDays === null ? "Fetching your attendance status..." : "No records are available yet."
            }
            emptyIcon={Clock}
            skeletonRows={6}
            expandable={{
              render: (row) => {
                const rowAppeals = appeals
                  .filter((a) => a.appeal_date === row.date)
                  .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))

                return (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-muted-foreground text-xs uppercase">Day</p>
                        <p className="font-medium">{row.dayLabel}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase">Date</p>
                        <p className="font-medium">{row.dateLabel}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase">Clock In</p>
                        <p className="mt-0.5 flex items-center gap-1.5 font-medium">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-green-600" />
                          <span>{row.clock_in || "-"}</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase">Clock Out</p>
                        <p className="mt-0.5 flex items-center gap-1.5 font-medium">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-red-500" />
                          <span>{row.clock_out || "-"}</span>
                        </p>
                      </div>
                    </div>
                    {rowAppeals.map((appeal, index) => (
                      <div key={appeal.id} className="bg-muted/50 max-w-2xl space-y-2 rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs font-semibold uppercase">
                              Appeal {rowAppeals.length > 1 ? `#${rowAppeals.length - index}` : ""} ({appeal.status})
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                appeal.status === "pending"
                                  ? "border-amber-500 bg-amber-500/5 text-amber-500 hover:bg-amber-500/5"
                                  : appeal.status === "approved"
                                    ? "border-emerald-500 bg-emerald-500/5 text-emerald-500 hover:bg-emerald-500/5"
                                    : "border-rose-500 bg-rose-500/5 text-rose-500 hover:bg-rose-500/5"
                              }
                            >
                              {appeal.status === "pending" && "Pending Approval"}
                              {appeal.status === "approved" && "Approved"}
                              {appeal.status === "rejected" && "Rejected"}
                            </Badge>
                          </div>
                          {appeal.status === "pending" && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setEditAppeal(appeal)
                                  setAppealDialogRow(row)
                                }}
                              >
                                Edit Appeal
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 px-2 text-xs"
                                onClick={() => setCancelAppealId(appeal.id)}
                              >
                                Cancel Appeal
                              </Button>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs font-semibold uppercase">Your Reason</p>
                          <p className="mt-0.5 text-sm font-medium whitespace-pre-wrap">{appeal.appeal_reason}</p>
                        </div>
                        {appeal.resolution_note && (
                          <div className="mt-2 border-t pt-2">
                            <p className="text-muted-foreground text-xs font-semibold uppercase">
                              Admin Comment / Note
                            </p>
                            <p
                              className={`mt-0.5 text-sm font-medium whitespace-pre-wrap ${
                                appeal.status === "approved"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              }`}
                            >
                              {appeal.resolution_note}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              },
            }}
            urlSync
          />
        )}
      </DataTablePage>

      {remoteCheckinEnabled && (
        <RemoteCheckinModal
          open={remoteModalOpen}
          mode={remoteMode}
          onClose={() => setRemoteModalOpen(false)}
          onSuccess={() => {
            setRemoteModalOpen(false)
            void fetchAttendanceData()
          }}
        />
      )}

      {appealDialogRow && (
        <AppealDialog
          row={appealDialogRow}
          open={appealDialogRow !== null}
          onClose={() => {
            setAppealDialogRow(null)
            setEditAppeal(null)
          }}
          editAppeal={editAppeal}
          onSuccess={() => {
            setAppealDialogRow(null)
            setEditAppeal(null)
            void fetchAppeals()
            void fetchAttendanceData()
          }}
        />
      )}

      <AlertDialog
        open={cancelAppealId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelAppealId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Appeal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this appeal? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancellingAppeal}>Go Back</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isCancellingAppeal}
              onClick={async () => {
                if (cancelAppealId) {
                  setIsCancellingAppeal(true)
                  try {
                    await handleCancelAppeal(cancelAppealId)
                    setCancelAppealId(null)
                  } finally {
                    setIsCancellingAppeal(false)
                  }
                }
              }}
            >
              Yes, Cancel Appeal
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
function normalizeStatus(record: AttendanceRecord | null, recordDate?: string): AttendanceRow["normalizedStatus"] {
  return deriveUnifiedAttendanceStatus({
    record: record ?? undefined,
    recordDate: recordDate ?? (record as { date?: string } | null)?.date,
  }) as AttendanceRow["normalizedStatus"]
}

function StatusBadge({ status }: { status: AttendanceRow["normalizedStatus"] }) {
  return (
    <Badge className={ATTENDANCE_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800"}>
      {ATTENDANCE_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
