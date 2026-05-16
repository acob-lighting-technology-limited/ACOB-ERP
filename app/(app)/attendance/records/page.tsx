"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, ExpandableConfig } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Clock, Calendar, TrendingDown, Download } from "lucide-react"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  latenessDeduction,
  formatNaira,
  monthBounds,
  toLocalYearMonth,
  ABSENT_DEDUCTION,
} from "@/lib/hr/attendance-utils"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"

interface AttendanceRecord {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
  waived: boolean
  waiver_reason: string | null
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatDay(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { weekday: "long" })
}

function formatTime(t: string | null) {
  if (!t) return "-"
  return t.substring(0, 5)
}

function recordDeduction(record: AttendanceRecord): number {
  if (record.waived) return 0
  if (record.status === "absent") return ABSENT_DEDUCTION
  return latenessDeduction(record.clock_in)
}

function downloadCSV(records: AttendanceRecord[], yearMonth: string) {
  const headers = ["Date", "Day", "Clock In", "Clock Out", "Hours", "Status", "Deduction (₦)"]
  const rows = records.map((r) => {
    const d = recordDeduction(r)
    return [
      formatDate(r.date),
      formatDay(r.date),
      formatTime(r.clock_in),
      formatTime(r.clock_out),
      r.total_hours?.toFixed(2) ?? "-",
      r.status,
      r.waived ? "Waived" : d.toFixed(2),
    ]
  })
  const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `attendance-${yearMonth}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function AttendanceRecordsPage() {
  const [yearMonth, setYearMonth] = useState(toLocalYearMonth)

  const { data: records = [], isLoading } = useQuery({
    queryKey: [...QUERY_KEYS.attendance(), yearMonth],
    queryFn: async () => {
      const { start, end } = monthBounds(yearMonth)
      const res = await fetch(`/api/hr/attendance/records?start_date=${start}&end_date=${end}`)
      if (!res.ok) throw new Error("Failed to load attendance records")
      const data = await res.json()
      return (data.data || []) as AttendanceRecord[]
    },
  })

  const totalHours = records.reduce((s, r) => s + (r.total_hours ?? 0), 0)
  const presentDays = records.filter((r) => r.status === "present" || r.status === "late").length
  const totalDeduction = records.reduce((s, r) => s + recordDeduction(r), 0)

  const columns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      accessor: (r) => r.date,
      render: (r) => <span className="font-medium">{formatDate(r.date)}</span>,
    },
    {
      key: "day",
      label: "Day",
      sortable: true,
      accessor: (r) => new Date(r.date).getDay(),
      render: (r) => <span className="text-muted-foreground">{formatDay(r.date)}</span>,
    },
    {
      key: "clock_in",
      label: "Clock In",
      accessor: (r) => r.clock_in ?? "",
      render: (r) => (
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-green-600" />
          {formatTime(r.clock_in)}
        </span>
      ),
      align: "center",
    },
    {
      key: "clock_out",
      label: "Clock Out",
      accessor: (r) => r.clock_out ?? "",
      render: (r) => (
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-red-500" />
          {formatTime(r.clock_out)}
        </span>
      ),
      align: "center",
    },
    {
      key: "total_hours",
      label: "Hours",
      sortable: true,
      accessor: (r) => r.total_hours ?? 0,
      render: (r) => (r.total_hours != null ? `${r.total_hours.toFixed(2)}h` : "-"),
      align: "center",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => (
        <Badge
          className={
            ATTENDANCE_STATUS_COLORS[r.status as keyof typeof ATTENDANCE_STATUS_COLORS] ?? "bg-gray-100 text-gray-800"
          }
        >
          {ATTENDANCE_STATUS_LABELS[r.status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "deduction",
      label: "Deduction",
      sortable: true,
      accessor: (r) => recordDeduction(r),
      render: (r) => {
        const d = recordDeduction(r)
        if (r.waived) return <span className="text-xs font-medium text-blue-600">Waived</span>
        if (d > 0) return <span className="text-xs font-medium text-red-600">-{formatNaira(d)}</span>
        return <span className="text-muted-foreground text-xs">₦0</span>
      },
      align: "right",
    },
  ]

  const tableFilters: DataTableFilter<AttendanceRecord>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "present", label: "Present" },
        { value: "late", label: "Late" },
        { value: "absent", label: "Absent" },
        { value: "incomplete", label: "Incomplete" },
        { value: "waiver", label: "Waiver" },
      ],
      placeholder: "All Statuses",
    },
  ]

  const expandable: ExpandableConfig<AttendanceRecord> = {
    render: (r) => {
      const d = recordDeduction(r)
      return (
        <div className="bg-muted/30 grid grid-cols-2 gap-4 border-t px-4 py-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Clock In</div>
            <div className="flex items-center gap-1 font-medium">
              <Clock className="h-3 w-3 text-green-600" />
              {formatTime(r.clock_in)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Clock Out</div>
            <div className="flex items-center gap-1 font-medium">
              <Clock className="h-3 w-3 text-red-500" />
              {formatTime(r.clock_out)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Hours Worked</div>
            <div className="font-medium">{r.total_hours?.toFixed(2) ?? "-"} hrs</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Lateness Deduction</div>
            <div className={d > 0 ? "font-medium text-red-600" : "font-medium text-green-600"}>
              {r.waived ? `Waived${r.waiver_reason ? ` — ${r.waiver_reason}` : ""}` : `-${formatNaira(d)}`}
            </div>
          </div>
        </div>
      )
    },
  }

  return (
    <DataTablePage
      title="My Attendance Records"
      description="Monthly attendance history."
      icon={Calendar}
      backLink={{ href: "/attendance", label: "Back to Attendance" }}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCSV(records, yearMonth)}
          disabled={records.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard title="Days Recorded" value={records.length} icon={Calendar} />
          <StatCard title="Days Present" value={presentDays} icon={Calendar} />
          <StatCard title="Hours Worked" value={`${totalHours.toFixed(1)}h`} icon={Clock} />
          <StatCard
            title="Total Deduction"
            value={formatNaira(totalDeduction)}
            icon={TrendingDown}
            iconBgColor={totalDeduction > 0 ? "bg-red-500/10" : "bg-green-500/10"}
            iconColor={totalDeduction > 0 ? "text-red-500" : "text-green-500"}
          />
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Label>Month</Label>
        <Input
          type="month"
          value={yearMonth}
          max={toLocalYearMonth()}
          onChange={(e) => setYearMonth(e.target.value)}
          className="w-40"
        />
      </div>

      <DataTable<AttendanceRecord>
        data={records}
        columns={columns}
        filters={tableFilters}
        expandable={expandable}
        getRowId={(r) => r.id}
        searchPlaceholder="Search date or status..."
        searchFn={(r, q) => [formatDate(r.date), formatDay(r.date), r.status].join(" ").toLowerCase().includes(q)}
        isLoading={isLoading}
        emptyTitle="No records found"
        emptyDescription="No attendance records for this month."
        emptyIcon={Calendar}
        skeletonRows={5}
      />
    </DataTablePage>
  )
}
