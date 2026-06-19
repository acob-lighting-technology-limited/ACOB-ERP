"use client"

import { useEffect, useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { Clock, Download, UserCheck, MapPin, BarChart3, AlertCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { EmployeeCalendarView } from "./calendar-view"
import { StatCard } from "@/components/ui/stat-card"
import type { AttendanceRecord } from "./page"
import { logger } from "@/lib/logger"
import { RemoteCheckinModal } from "@/components/attendance/remote-checkin-modal"
import { dayCredit, toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  deriveUnifiedAttendanceStatus,
} from "@/lib/hr/attendance-status"

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
  normalizedStatus: "holiday" | "on_leave" | "exempted" | "waiver" | "present" | "late" | "incomplete" | "absent"
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

function calculateHourBreakdown(clockIn: string | null | undefined, clockOut: string | null | undefined) {
  const inMinutes = parseClockToMinutes(clockIn)
  const outMinutes = parseClockToMinutes(clockOut)
  if (inMinutes === null || outMinutes === null || outMinutes <= inMinutes) {
    return { total: null, work: null, overtime: null, missed: null }
  }

  const totalMinutes = outMinutes - inMinutes
  const workStart = 8 * 60
  const workEnd = 17 * 60
  const overlapStart = Math.max(inMinutes, workStart)
  const overlapEnd = Math.min(outMinutes, workEnd)
  const workMinutes = Math.max(0, overlapEnd - overlapStart)
  const overtimeMinutes = Math.max(0, totalMinutes - workMinutes)
  const lateMinutes = Math.max(0, inMinutes - workStart)
  const earlyMinutes = Math.max(0, workEnd - outMinutes)

  return {
    total: minutesToHours(totalMinutes),
    work: minutesToHours(workMinutes),
    overtime: minutesToHours(overtimeMinutes),
    missed: minutesToHours(lateMinutes + earlyMinutes),
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
  return status === "waiver" || status === "exempted" || status === "on_leave" || status === "holiday"
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

  async function fetchAttendanceData() {
    try {
      const ym = toLocalYearMonth()
      const today = toLocalISODate()
      // Fetch current month + 2 previous months so the log and filter show history
      const months = [getPrevMonth(ym, 2), getPrevMonth(ym, 1), ym]
      const results = await Promise.all(
        months.map((m) =>
          fetch(`/api/hr/attendance/my-days?year_month=${m}`, { cache: "no-store" })
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
  }

  useEffect(() => {
    void fetchAttendanceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            dayLabel: formatWATDate(dateObj, { weekday: "long" }),
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
          : calculateHourBreakdown(existing.clock_in, existing.clock_out)

        return {
          ...existing,
          total_hours: breakdown.total ?? existing.total_hours,
          dayLabel: formatWATDate(dateObj, { weekday: "long" }),
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

  // Seed filteredRows with all rows on first load so stat cards show before any filter interaction
  useEffect(() => {
    if (rows.length > 0) setFilteredRows(rows)
  }, [rows])

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
    ],
    []
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

  // Rates are computed from whatever rows survive the active filter — "all time" when no filter is set
  const { attendanceRate, absentRate } = useMemo(() => {
    const scorable = filteredRows.filter((row) => {
      if (isCoveredStatus(row.normalizedStatus)) return false
      // Exclude a day still in progress (clocked in today, not yet clocked out)
      if (row.date === todayIso && row.clock_in && !row.clock_out) return false
      return true
    })
    if (scorable.length === 0) return { attendanceRate: 0, absentRate: 0 }
    let credits = 0
    for (const row of scorable) credits += dayCredit(row.normalizedStatus, row.clock_in, row.clock_out)
    const attendanceRate = Math.round((credits / scorable.length) * 100)
    const absentDays = scorable.filter((r) => r.normalizedStatus === "absent").length
    const absentRate = Math.round((absentDays / scorable.length) * 100)
    return { attendanceRate, absentRate }
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              title="Today Status"
              value={ATTENDANCE_STATUS_LABELS[todayStatus] ?? todayStatus}
              icon={UserCheck}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="Today Hours"
              value={todayHours}
              icon={Clock}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
            <StatCard
              title="Attendance Rate"
              value={`${attendanceRate}%`}
              icon={BarChart3}
              iconBgColor={
                attendanceRate >= 80 ? "bg-emerald-500/10" : attendanceRate >= 60 ? "bg-yellow-500/10" : "bg-red-500/10"
              }
              iconColor={
                attendanceRate >= 80 ? "text-emerald-500" : attendanceRate >= 60 ? "text-yellow-500" : "text-red-500"
              }
            />
            <StatCard
              title="Absent Rate"
              value={`${absentRate}%`}
              icon={AlertCircle}
              iconBgColor={
                absentRate <= 10 ? "bg-emerald-500/10" : absentRate <= 25 ? "bg-yellow-500/10" : "bg-red-500/10"
              }
              iconColor={absentRate <= 10 ? "text-emerald-500" : absentRate <= 25 ? "text-yellow-500" : "text-red-500"}
            />
          </div>
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
              render: (row) => (
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
              ),
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
