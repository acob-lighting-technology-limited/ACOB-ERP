"use client"

import { useEffect, useMemo, useState } from "react"
import { Clock, Download, TrendingDown, UserCheck, AlertCircle, CalendarDays, Timer, CalendarX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import type { AttendanceRecord } from "./page"
import { logger } from "@/lib/logger"
import {
  ABSENT_DEDUCTION,
  earlyDepartureDeduction,
  formatNaira,
  getWorkdaysInMonth,
  latenessDeduction,
  missedHours,
  toLocalISODate,
  toLocalYearMonth,
} from "@/lib/hr/attendance-utils"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"

const log = logger("dashboard-attendance-attendance-content")

interface AttendanceContentProps {
  initialTodayRecord: AttendanceRecord | null
  initialRecentRecords: AttendanceRecord[]
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
  deduction: number
}
type UnifiedDay = {
  date: string
  record: AttendanceRecord | null
  status: AttendanceRow["normalizedStatus"]
  deduction: number
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

export function AttendanceContent({ initialTodayRecord, initialRecentRecords }: AttendanceContentProps) {
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(initialTodayRecord)
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>(initialRecentRecords)
  const [unifiedDays, setUnifiedDays] = useState<UnifiedDay[] | null>(null)

  async function fetchAttendanceData() {
    try {
      const ym = toLocalYearMonth()
      const today = toLocalISODate()
      const response = await fetch(`/api/hr/attendance/my-days?year_month=${ym}`, { cache: "no-store" })
      const data = await response.json()
      if (response.ok && data.data) {
        setUnifiedDays(data.data as UnifiedDay[])
        const todayRec = (data.data as UnifiedDay[]).find((row) => row.date === today)?.record || null
        setTodayRecord(todayRec)
        setRecentRecords((data.data as UnifiedDay[]).map((row) => row.record).filter(Boolean) as AttendanceRecord[])
      }
    } catch (error) {
      log.error("Error fetching attendance:", error)
    }
  }

  useEffect(() => {
    void fetchAttendanceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo<AttendanceRow[]>(() => {
    if (unifiedDays === null) {
      return []
    }
    const ym = toLocalYearMonth()
    const todayIso = toLocalISODate()
    const monthToDateWorkdays = getWorkdaysInMonth(ym).filter((d) => d <= todayIso)
    const unifiedByDate = new Map(unifiedDays.map((d) => [d.date, d]))
    const recordByDate = new Map(recentRecords.map((record) => [record.date, record]))

    return monthToDateWorkdays
      .map((workday) => {
        const unified = unifiedByDate.get(workday)
        const existing = unified?.record || recordByDate.get(workday)
        const date = new Date(workday)
        if (!existing) {
          const normalizedStatus = unified?.status || "absent"
          const deduction = typeof unified?.deduction === "number" ? unified.deduction : ABSENT_DEDUCTION
          return {
            id: `missing-${workday}`,
            date: workday,
            clock_in: null,
            clock_out: null,
            total_hours: null,
            status: "no_record",
            dayLabel: date.toLocaleDateString("en-GB", { weekday: "long" }),
            dateLabel: date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }),
            periodLabel: "-",
            monthLabel: date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
            calculatedTotalHours: null,
            workHours: null,
            overtimeHours: null,
            missedHoursValue: null,
            normalizedStatus,
            deduction,
          } as AttendanceRow
        }

        const breakdown = calculateHourBreakdown(existing.clock_in, existing.clock_out)
        const normalizedStatus = unified?.status || normalizeStatus(existing)

        return {
          ...existing,
          total_hours: breakdown.total ?? existing.total_hours,
          dayLabel: date.toLocaleDateString("en-GB", { weekday: "long" }),
          dateLabel: date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }),
          periodLabel: `${existing.clock_in || "-"} - ${existing.clock_out || "In Progress"}`,
          monthLabel: date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
          calculatedTotalHours: breakdown.total,
          workHours: breakdown.work,
          overtimeHours: breakdown.overtime,
          missedHoursValue: breakdown.missed,
          normalizedStatus,
          deduction:
            typeof unified?.deduction === "number" ? unified.deduction : deductionForRow(normalizedStatus, existing),
        } as AttendanceRow
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [recentRecords, unifiedDays])

  const columns = useMemo<DataTableColumn<AttendanceRow>[]>(
    () => [
      {
        key: "date",
        label: "Date",
        sortable: true,
        accessor: (row) => row.date,
        render: (row) => <span>{row.dateLabel}</span>,
      },
      {
        key: "day",
        label: "Day",
        sortable: true,
        accessor: (row) => row.dayLabel,
        render: (row) => <span className="font-medium">{row.dayLabel}</span>,
      },
      {
        key: "period",
        label: "Clock Period",
        sortable: true,
        accessor: (row) => row.periodLabel,
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
      },
      {
        key: "overtime_hours",
        label: "Overtime",
        sortable: true,
        accessor: (row) => row.overtimeHours || 0,
        render: (row) => (row.overtimeHours != null ? `${row.overtimeHours.toFixed(2)} hrs` : "-"),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.normalizedStatus,
        render: (row) => <StatusBadge status={row.normalizedStatus} />,
      },
      {
        key: "deduction",
        label: "Deduction",
        sortable: true,
        accessor: (row) => row.deduction || 0,
        render: (row) =>
          row.normalizedStatus === "waiver" ? (
            <span className="text-muted-foreground text-xs">Waived</span>
          ) : row.deduction > 0 ? (
            <span className="font-medium text-red-600">-{formatNaira(row.deduction)}</span>
          ) : (
            <span className="text-muted-foreground text-xs">₦0</span>
          ),
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

  const todayHours = todayRecord?.total_hours ? `${todayRecord.total_hours.toFixed(2)} hrs` : "-"
  const todayStatus = todayRecord ? normalizeStatus(todayRecord) : "absent"
  const totalDeduction = rows.reduce((sum, row) => sum + row.deduction, 0)
  const presentDays = rows.filter((row) => row.normalizedStatus === "present").length
  const lateDays = rows.filter((row) => row.normalizedStatus === "late").length
  const incompleteDays = rows.filter((row) => row.normalizedStatus === "incomplete").length
  const totalHoursWorked = rows.reduce((sum, row) => sum + (row.calculatedTotalHours ?? row.total_hours ?? 0), 0)
  const totalWorkHours = rows.reduce((sum, row) => sum + (row.workHours ?? 0), 0)
  const totalOvertimeHours = rows.reduce((sum, row) => sum + (row.overtimeHours ?? 0), 0)
  const totalMissedHours = rows.reduce(
    (sum, row) => sum + (row.missedHoursValue ?? missedHours(row.clock_in, row.clock_out)),
    0
  )

  function exportCSV() {
    const headers = [
      "Date",
      "Day",
      "Clock In",
      "Clock Out",
      "Total Hours",
      "Work Hour",
      "Overtime",
      "Status",
      "Deduction (₦)",
    ]
    const csvRows = rows.map((row) => [
      row.dateLabel,
      row.dayLabel,
      row.clock_in || "-",
      row.clock_out || "-",
      row.calculatedTotalHours != null ? row.calculatedTotalHours.toFixed(2) : "-",
      row.workHours != null ? row.workHours.toFixed(2) : "-",
      row.overtimeHours != null ? row.overtimeHours.toFixed(2) : "-",
      row.normalizedStatus,
      row.normalizedStatus === "waiver" ? 0 : row.deduction,
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
    <DataTablePage
      title="Attendance"
      description="Track your work hours and attendance records."
      icon={Clock}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      actions={
        <Button variant="outline" onClick={exportCSV} size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            title="Today Status"
            value={todayStatus}
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
            title="Present Days"
            value={presentDays}
            icon={UserCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Late Days"
            value={lateDays}
            icon={AlertCircle}
            iconBgColor="bg-yellow-500/10"
            iconColor="text-yellow-500"
          />
          <StatCard
            title="Incomplete Days"
            value={incompleteDays}
            icon={AlertCircle}
            iconBgColor="bg-cyan-500/10"
            iconColor="text-cyan-500"
          />
          <StatCard
            title="Absent Days"
            value={rows.filter((row) => row.normalizedStatus === "absent").length}
            icon={CalendarDays}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Total Deduction"
            value={formatNaira(totalDeduction)}
            icon={TrendingDown}
            iconBgColor={totalDeduction > 0 ? "bg-red-500/10" : "bg-green-500/10"}
            iconColor={totalDeduction > 0 ? "text-red-500" : "text-green-500"}
          />
          <StatCard
            title="Total Hours (MTD)"
            value={`${totalHoursWorked.toFixed(1)} hrs`}
            icon={Timer}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Work Hours (MTD)"
            value={`${totalWorkHours.toFixed(1)} hrs`}
            icon={Clock}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Hours Missed (MTD)"
            value={`${totalMissedHours.toFixed(1)} hrs`}
            icon={CalendarX}
            iconBgColor={totalMissedHours > 0 ? "bg-orange-500/10" : "bg-green-500/10"}
            iconColor={totalMissedHours > 0 ? "text-orange-500" : "text-green-500"}
          />
          <StatCard
            title="Overtime (MTD)"
            value={`${totalOvertimeHours.toFixed(1)} hrs`}
            icon={TrendingDown}
            iconBgColor={totalOvertimeHours > 0 ? "bg-amber-500/10" : "bg-muted/50"}
            iconColor={totalOvertimeHours > 0 ? "text-amber-500" : "text-muted-foreground"}
          />
        </div>
      }
    >
      <DataTable<AttendanceRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search date, clock period, or status..."
        searchFn={(row, query) =>
          `${row.dayLabel} ${row.dateLabel} ${row.periodLabel} ${row.status}`.toLowerCase().includes(query)
        }
        isLoading={unifiedDays === null}
        emptyTitle={unifiedDays === null ? "Loading attendance..." : "No attendance records"}
        emptyDescription={unifiedDays === null ? "Fetching your attendance status..." : "No records are available yet."}
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
                <p className="font-medium">{row.clock_in || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Clock Out</p>
                <p className="font-medium">{row.clock_out || "-"}</p>
              </div>
            </div>
          ),
        }}
        urlSync
      />
    </DataTablePage>
  )
}
function normalizeStatus(record: AttendanceRecord | null): AttendanceRow["normalizedStatus"] {
  if (!record) return "absent"
  const value = String(record.status || "").toLowerCase()
  if (value === "holiday") return "holiday"
  if (value === "on_leave" || value === "leave") return "on_leave"
  if (value === "exempted" || value === "exempt") return "exempted"
  if (value === "waiver" || value === "waived" || record.waived) return "waiver"
  if (value === "present") return "present"
  if (value === "late") return "late"
  if (value === "incomplete") return "incomplete"
  if (value === "absent") return "absent"
  if (!record.clock_in && !record.clock_out) return "absent"
  if (!record.clock_in || !record.clock_out) return "incomplete"
  return latenessDeduction(record.clock_in) > 0 ? "late" : "present"
}

function deductionForRow(status: AttendanceRow["normalizedStatus"], row: AttendanceRecord | null): number {
  if (!row) return ABSENT_DEDUCTION
  if (status === "absent") return ABSENT_DEDUCTION
  if (status === "present" || status === "late")
    return latenessDeduction(row.clock_in) + earlyDepartureDeduction(row.clock_out)
  return 0
}

function StatusBadge({ status }: { status: AttendanceRow["normalizedStatus"] }) {
  return (
    <Badge className={ATTENDANCE_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800"}>
      {ATTENDANCE_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
