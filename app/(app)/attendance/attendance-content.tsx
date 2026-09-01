"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { formatWATDate } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import {
  Clock,
  Download,
  FileQuestion,
  UserCheck,
  MapPin,
  AlertCircle,
  Calendar,
  MessageSquare,
  Gavel,
  Trash2,
} from "lucide-react"
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
import { toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { computeAttendanceDay, attendanceRateFrom, NET_DAY_HOURS } from "@/lib/hr/attendance-ssot"
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  deriveUnifiedAttendanceStatus,
  normalizeStoredAttendanceStatus,
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
  earlyClosureTime?: string | null,
  status?: string | null,
  inProgress?: boolean
) {
  const inMinutes = parseClockToMinutes(clockIn)
  const outMinutes = parseClockToMinutes(clockOut)
  if (inMinutes === null || outMinutes === null || outMinutes <= inMinutes) {
    if (status === "lwop" || status === "leave_without_pay") {
      return { total: null, work: 0, missed: NET_DAY_HOURS }
    }
    // Day in progress — show only the late bracket cost (no penalty yet)
    if (inProgress && clockIn && !clockOut) {
      const { hoursLost, hoursWorked } = computeAttendanceDay({
        status: status || "late",
        clockIn,
        clockOut,
        earlyCloseTime: earlyClosureTime ?? null,
        lateResumptionTime: lateResumptionTime ?? null,
        inProgress: true,
      })
      return { total: null, work: hoursWorked, missed: hoursLost }
    }
    return { total: null, work: null, missed: null }
  }

  // Work and missed hours both come from the SSOT, on the same bracketed 8.5-hour
  // scale, so they always add up to the net day. Only "total" reflects raw clock
  // minutes — it is time in the office, not hours credited.
  const { hoursLost, hoursWorked } = computeAttendanceDay({
    status: status || "present",
    clockIn,
    clockOut,
    earlyCloseTime: earlyClosureTime ?? null,
    lateResumptionTime: lateResumptionTime ?? null,
  })

  return {
    total: minutesToHours(outMinutes - inMinutes),
    work: hoursWorked,
    missed: hoursLost,
  }
}

function getPrevMonth(yearMonth: string, n: number): string {
  const [year, month] = yearMonth.split("-").map(Number)
  const d = new Date(year, month - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function formatClockTime(value: string | null | undefined): string {
  if (!value || value === "-") return "-"
  const parts = value.split(":")
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`
  }
  return value
}

function getClockOutLabel(row: Pick<AttendanceRow, "clock_in" | "clock_out" | "date">): string {
  if (row.clock_out) return formatClockTime(row.clock_out)
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
  const currentMonthLwpAwpCount = useMemo(() => {
    const currentYM = toLocalYearMonth()
    let count = 0
    for (const day of unifiedDays ?? []) {
      if (day.date.startsWith(currentYM)) {
        if (
          day.status === "lateness_with_permission" ||
          day.status === "incomplete_with_permission" ||
          day.status === "absent_with_permission"
        ) {
          count++
        }
      }
    }
    return count
  }, [unifiedDays])

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
          const isLwop = normalizedStatus === "lwop" || (normalizedStatus as string) === "leave_without_pay"
          return {
            id: `missing-${workday}`,
            date: workday,
            clock_in: null,
            clock_out: null,
            total_hours: null,
            status: "no_record",
            dayLabel: dateObj.toLocaleDateString("en-US", { weekday: "long", timeZone: "Africa/Lagos" }),
            dateLabel: formatWATDate(dateObj, { day: "2-digit", month: "long", year: "numeric" }),
            periodLabel: "-",
            monthLabel,
            calculatedTotalHours: null,
            workHours: isLwop ? 0 : null,
            missedHoursValue: isLwop ? NET_DAY_HOURS : null,
            normalizedStatus,
          } as AttendanceRow
        }

        const normalizedStatus =
          (unified.status as AttendanceRow["normalizedStatus"]) || normalizeStatus(existing, workday)
        const isInProgress = workday === toLocalISODate() && Boolean(existing.clock_in) && !existing.clock_out
        const breakdown = isCoveredStatus(normalizedStatus)
          ? { total: null, work: null, missed: null }
          : calculateHourBreakdown(
              existing.clock_in,
              existing.clock_out,
              (unified as any).late_resumption_time,
              (unified as any).early_closure_time,
              normalizedStatus,
              isInProgress
            )

        return {
          ...existing,
          total_hours: breakdown.total ?? existing.total_hours,
          dayLabel: dateObj.toLocaleDateString("en-US", { weekday: "long", timeZone: "Africa/Lagos" }),
          dateLabel: formatWATDate(dateObj, { day: "2-digit", month: "long", year: "numeric" }),
          periodLabel: `${existing.clock_in || "-"} - ${getClockOutLabel({ ...existing, date: workday })}`,
          monthLabel,
          calculatedTotalHours: breakdown.total,
          workHours: breakdown.work,
          missedHoursValue: breakdown.missed,
          normalizedStatus,
        } as AttendanceRow
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [unifiedDays])

  // No month is pre-selected, so seed filteredRows with everything fetched and let
  // the stat cards reflect the full range until the user picks a month.
  useEffect(() => {
    if (rows.length > 0) {
      setFilteredRows(rows)
    }
  }, [rows])

  const columns = useMemo<DataTableColumn<AttendanceRow>[]>(
    () => [
      {
        key: "date",
        label: "Date",
        sortable: true,
        accessor: (row) => row.date,
        render: (row) => (
          <div className="whitespace-nowrap">
            <span className="text-foreground block text-xs font-semibold sm:text-sm">{row.dayLabel}</span>
            <span className="text-muted-foreground block text-[11px]">
              {formatWATDate(row.date, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
        ),
      },
      {
        key: "clock_in",
        label: "Clock In",
        sortable: true,
        accessor: (row) => row.clock_in ?? "",
        render: (row) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Clock className="hidden h-3.5 w-3.5 shrink-0 text-green-600 sm:inline-block" />
            <span>{formatClockTime(row.clock_in)}</span>
          </span>
        ),
      },
      {
        key: "clock_out",
        label: "Clock Out",
        sortable: true,
        accessor: (row) => row.clock_out ?? "",
        render: (row) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Clock className="hidden h-3.5 w-3.5 shrink-0 text-red-500 sm:inline-block" />
            <span>{getClockOutLabel(row)}</span>
          </span>
        ),
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
        key: "total_hours",
        label: "Total Hours",
        sortable: true,
        accessor: (row) => row.calculatedTotalHours || row.total_hours || 0,
        render: (row) => (row.calculatedTotalHours != null ? `${row.calculatedTotalHours.toFixed(2)} hrs` : "-"),
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
        filterFn: (row, selected) => selected.includes(row.monthLabel),
      },
    ],
    [rows]
  )

  const todayIso = toLocalISODate()
  const todayHours = todayRecord?.total_hours ? `${todayRecord.total_hours.toFixed(2)} hrs` : "-"
  const todayStatus = todayRecord ? normalizeStatus(todayRecord, todayIso) : "absent"

  // Computed stats from whatever rows survive the active filter
  const { totalWorkedHours, totalMissedHours, attendedDays, totalWorkdays } = useMemo(() => {
    const scorable = filteredRows.filter((row) => {
      if (isCoveredStatus(row.normalizedStatus)) return false
      // Exclude a day still in progress (clocked in today, not yet clocked out)
      if (row.date === todayIso && row.clock_in && !row.clock_out) return false
      return true
    })
    if (scorable.length === 0) return { totalWorkedHours: 0, totalMissedHours: 0, attendedDays: 0, totalWorkdays: 0 }
    let worked = 0
    let missed = 0
    for (const row of scorable) {
      const dayRes = computeAttendanceDay({
        status: row.normalizedStatus,
        clockIn: row.clock_in,
        clockOut: row.clock_out,
      })
      worked += dayRes.hoursWorked
      missed += dayRes.hoursLost
    }
    const attended = scorable.filter(
      (row) => row.normalizedStatus !== "absent" && row.normalizedStatus !== "absent_with_permission"
    ).length
    return {
      totalWorkedHours: Math.round(worked * 10) / 10,
      totalMissedHours: Math.round(missed * 10) / 10,
      attendedDays: attended,
      totalWorkdays: scorable.length,
    }
  }, [filteredRows, todayIso])

  function exportCSV() {
    const headers = ["Date", "Day", "Clock In", "Clock Out", "Total Hours", "Work Hour", "Status"]
    const csvRows = rows.map((row) => [
      row.dateLabel,
      row.dayLabel,
      row.clock_in || "-",
      row.clock_out || "-",
      row.calculatedTotalHours != null ? row.calculatedTotalHours.toFixed(2) : "-",
      row.workHours != null ? row.workHours.toFixed(2) : "-",
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
                <MapPin className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  Remote {todayRecord?.clock_in && !todayRecord?.clock_out ? "Clock Out" : "Clock In"}
                </span>
              </Button>
            )}
            <Button variant="outline" onClick={exportCSV} size="sm">
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        }
        spacing="tight"
        actionsPlacement="inline-always"
        stats={
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <StatCard
                variant="compact"
                title="Today Status"
                value={ATTENDANCE_STATUS_LABELS[todayStatus] ?? todayStatus}
                icon={UserCheck}
                iconBgColor="bg-blue-500/10"
                iconColor="text-blue-500"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="h-full cursor-help">
                    <StatCard
                      variant="compact"
                      className="h-full"
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
                  <div className="h-full cursor-help">
                    <StatCard
                      variant="compact"
                      className="h-full"
                      title="Total Work Hours"
                      value={`${totalWorkedHours} hrs`}
                      icon={Clock}
                      iconBgColor="bg-emerald-500/10"
                      iconColor="text-emerald-500"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">
                    Total verified work hours credited across expected workdays in this period.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="h-full cursor-help">
                    <StatCard
                      variant="compact"
                      className="h-full"
                      title="Missed Hours"
                      value={`${totalMissedHours} hrs`}
                      icon={AlertCircle}
                      iconBgColor="bg-amber-500/10"
                      iconColor="text-amber-500"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">
                    Total hours lost due to late arrival, early departure, or incomplete punches in this period.
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
            mobileRow={{
              // The whole point of this log is spotting the days that cost you
              // something, so those days carry an accent instead of blending in.
              accentClass: (row) =>
                row.normalizedStatus === "absent"
                  ? "bg-rose-500"
                  : ["late", "incomplete"].includes(row.normalizedStatus)
                    ? "bg-amber-500"
                    : undefined,
              title: (row) => (
                <span className="text-foreground font-medium">
                  {formatWATDate(row.date, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              ),
              // Three clauses truncate on a phone before the third is readable.
              // Clock times plus the number that actually matters — hours lost.
              subtitle: (row) =>
                `${formatClockTime(row.clock_in)} – ${getClockOutLabel(row)}${
                  (row.missedHoursValue ?? 0) > 0 ? ` · ${row.missedHoursValue!.toFixed(2)} hrs missed` : ""
                }`,
              trailing: (row) => <StatusBadge status={row.normalizedStatus} />,
              detail: {
                title: (row) =>
                  formatWATDate(row.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
                subtitle: (row) => row.dayLabel,
                badges: (row) => <StatusBadge status={row.normalizedStatus} />,
                fields: (row) => {
                  // Newest first: an appealed day can carry a rejected attempt and
                  // the re-appeal that followed it.
                  const rowAppeals = appeals
                    .filter((a) => a.appeal_date === row.date)
                    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
                  const latestAppeal = rowAppeals[0]

                  return [
                    { icon: Clock, label: "Clock In", value: formatClockTime(row.clock_in) },
                    { icon: Clock, label: "Clock Out", value: getClockOutLabel(row) },
                    {
                      icon: Clock,
                      label: "Work Hours",
                      value: row.workHours != null ? `${row.workHours.toFixed(2)} hrs` : "-",
                    },
                    {
                      icon: AlertCircle,
                      label: "Missed Hours",
                      value: (row.missedHoursValue ?? 0) > 0 ? `${row.missedHoursValue!.toFixed(2)} hrs` : "0.00 hrs",
                      muted: (row.missedHoursValue ?? 0) === 0,
                    },
                    {
                      icon: Clock,
                      label: "Total Hours",
                      value: row.calculatedTotalHours != null ? `${row.calculatedTotalHours.toFixed(2)} hrs` : "-",
                    },
                    // ── Appeal thread ──────────────────────────────────────────
                    // Restored from the removed expandable row. Without these an
                    // employee cannot see why an appeal was refused, which is the
                    // one thing they open this record to find out.
                    ...(latestAppeal
                      ? [
                          {
                            icon: Gavel,
                            label: rowAppeals.length > 1 ? `Latest Appeal (${rowAppeals.length} submitted)` : "Appeal",
                            value:
                              latestAppeal.status === "pending"
                                ? "Pending approval"
                                : latestAppeal.status === "approved"
                                  ? "Approved"
                                  : "Rejected",
                            copyable: false,
                          },
                          {
                            icon: FileQuestion,
                            label: "Your Reason",
                            value: latestAppeal.appeal_reason,
                            copyable: true,
                          },
                          ...(latestAppeal.resolution_note
                            ? [
                                {
                                  icon: MessageSquare,
                                  label: "Admin Comment / Note",
                                  value: latestAppeal.resolution_note,
                                  copyable: true,
                                },
                              ]
                            : []),
                        ]
                      : []),
                  ]
                },
                actions: (row) => {
                  const rowAppeals = appeals.filter((a) => a.appeal_date === row.date)
                  const pendingAppeal = rowAppeals.find((a) => a.status === "pending")
                  const isEligible = (["absent", "late", "incomplete"] as string[]).includes(row.normalizedStatus)
                  if (pendingAppeal) {
                    return [
                      {
                        label: "Edit Appeal",
                        icon: FileQuestion,
                        variant: "outline" as const,
                        onClick: () => {
                          setEditAppeal(pendingAppeal)
                          setAppealDialogRow(row)
                        },
                      },
                      // Withdrawing a pending appeal was only reachable from the
                      // expandable row; without this its confirm dialog can never open.
                      {
                        label: "Cancel Appeal",
                        icon: Trash2,
                        variant: "destructive" as const,
                        onClick: () => setCancelAppealId(pendingAppeal.id),
                      },
                    ]
                  }
                  if (isEligible || rowAppeals.length > 0) {
                    return [
                      {
                        label: rowAppeals.some((a) => a.status === "rejected") ? "Re-submit Appeal" : "Submit Appeal",
                        icon: FileQuestion,
                        variant: "default" as const,
                        onClick: () => {
                          setEditAppeal(null)
                          setAppealDialogRow(row)
                        },
                      },
                    ]
                  }
                  return []
                },
              },
            }}
            viewToggle
            contactsView
            defaultViewMode={{ mobile: "contacts", desktop: "list" }}
            stickyToolbar
            cardRenderer={(row) => {
              const rowAppeals = appeals.filter((a) => a.appeal_date === row.date)
              const pendingAppeal = rowAppeals.find((a) => a.status === "pending")
              const approvedAppeal = rowAppeals.find((a) => a.status === "approved")
              const hasRejected = rowAppeals.some((a) => a.status === "rejected")
              const isEligible = (["absent", "late", "incomplete"] as string[]).includes(row.normalizedStatus)

              return (
                <div className="bg-card text-card-foreground border-border/60 hover:border-primary/40 space-y-3 rounded-xl border p-3.5 shadow-sm transition-all sm:p-4">
                  <div className="flex items-center justify-between gap-2 border-b pb-2">
                    <div>
                      <span className="text-foreground block text-sm font-semibold">
                        {formatWATDate(row.date, { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <span className="text-muted-foreground block text-xs">{row.dayLabel}</span>
                    </div>
                    <StatusBadge status={row.normalizedStatus} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Clock className="text-primary h-3.5 w-3.5 shrink-0" />
                      <span>
                        In: <strong className="text-foreground">{formatClockTime(row.clock_in)}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      <span>
                        Out: <strong className="text-foreground">{getClockOutLabel(row)}</strong>
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Work:{" "}
                      <strong className="text-foreground">
                        {row.workHours != null ? `${row.workHours.toFixed(2)} hrs` : "-"}
                      </strong>
                    </div>
                    <div className="text-muted-foreground">
                      Total:{" "}
                      <strong className="text-foreground">
                        {row.calculatedTotalHours != null ? `${row.calculatedTotalHours.toFixed(2)} hrs` : "-"}
                      </strong>
                    </div>
                  </div>

                  {(isEligible || rowAppeals.length > 0) && (
                    <div className="border-border/40 flex items-center justify-end border-t pt-2">
                      {pendingAppeal ? (
                        <Badge variant="outline" className="border-amber-500 bg-amber-500/5 text-amber-500">
                          Pending Appeal
                        </Badge>
                      ) : approvedAppeal ? (
                        <Badge variant="outline" className="border-emerald-500 bg-emerald-500/5 text-emerald-500">
                          Appeal Approved
                        </Badge>
                      ) : hasRejected ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive h-7 gap-1 text-xs"
                          onClick={() => {
                            setEditAppeal(null)
                            setAppealDialogRow(row)
                          }}
                        >
                          <FileQuestion className="h-3.5 w-3.5" />
                          Re-appeal
                        </Button>
                      ) : isEligible ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => {
                            setEditAppeal(null)
                            setAppealDialogRow(row)
                          }}
                        >
                          <FileQuestion className="h-3.5 w-3.5" />
                          Appeal
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              )
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
          lwpAwpCountThisMonth={currentMonthLwpAwpCount}
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
  const norm = normalizeStoredAttendanceStatus(status) || status
  return (
    <Badge
      className={
        ATTENDANCE_STATUS_COLORS[norm as keyof typeof ATTENDANCE_STATUS_COLORS] ??
        "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
      }
    >
      {ATTENDANCE_STATUS_LABELS[norm as keyof typeof ATTENDANCE_STATUS_LABELS] ?? norm}
    </Badge>
  )
}
