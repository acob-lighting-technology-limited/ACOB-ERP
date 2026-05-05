"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { BarChart3, Download, FileText, Users } from "lucide-react"
import { logger } from "@/lib/logger"

const log = logger("hr-attendance-reports")

interface AttendanceReport {
  user_id: string
  user_name: string
  department: string
  total_days: number
  present_days: number
  late_days: number
  absent_days: number
  total_hours: number
  attendance_rate: number
}

function AttendanceCard({ report }: { report: AttendanceReport }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{report.user_name}</p>
          <p className="text-muted-foreground text-xs">{report.department}</p>
        </div>
        <Badge
          variant={
            report.attendance_rate >= 80 ? "default" : report.attendance_rate >= 60 ? "secondary" : "destructive"
          }
        >
          {report.attendance_rate}%
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Present</p>
          <p>{report.present_days}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Absent</p>
          <p>{report.absent_days}</p>
        </div>
      </div>
    </div>
  )
}

export default function AttendanceReportsPage() {
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<AttendanceReport[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [filters, setFilters] = useState({
    department: "all",
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    end_date: new Date().toISOString().split("T")[0],
  })

  const generateReport = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        start_date: filters.start_date,
        end_date: filters.end_date,
        department: filters.department,
      })
      const response = await fetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as {
        data?: AttendanceReport[]
        departments?: string[]
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load attendance report")
      }
      setReports(payload?.data || [])
      setDepartments(payload?.departments || [])
    } catch (error) {
      log.error("Error generating report:", error)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [filters.department, filters.end_date, filters.start_date])

  useEffect(() => {
    void generateReport()
  }, [generateReport])

  function exportCSV() {
    const headers = ["Name", "Department", "Total Days", "Present", "Late", "Absent", "Total Hours", "Attendance Rate"]
    const rows = reports.map((report) => [
      report.user_name,
      report.department,
      report.total_days,
      report.present_days,
      report.late_days,
      report.absent_days,
      report.total_hours.toFixed(1),
      `${report.attendance_rate}%`,
    ])
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `attendance_report_${filters.start_date}_${filters.end_date}.csv`
    link.click()
  }

  const departmentOptions = useMemo(
    () => departments.map((department) => ({ value: department, label: department })),
    [departments]
  )

  const stats = {
    employees: reports.length,
    present: reports.reduce((acc, report) => acc + report.present_days, 0),
    absent: reports.reduce((acc, report) => acc + report.absent_days, 0),
    averageRate:
      reports.length > 0
        ? `${Math.round(reports.reduce((sum, report) => sum + report.attendance_rate, 0) / reports.length)}%`
        : "-",
  }

  const columns: DataTableColumn<AttendanceReport>[] = [
    {
      key: "user_name",
      label: "Employee",
      sortable: true,
      accessor: (report) => report.user_name,
      render: (report) => <span className="font-medium">{report.user_name}</span>,
      resizable: true,
      initialWidth: 200,
    },
    { key: "department", label: "Department", sortable: true, accessor: (report) => report.department },
    {
      key: "total_days",
      label: "Total Days",
      sortable: true,
      accessor: (report) => report.total_days,
      align: "center",
    },
    {
      key: "present_days",
      label: "Present",
      sortable: true,
      accessor: (report) => report.present_days,
      render: (report) => <span className="text-green-600">{report.present_days}</span>,
      align: "center",
    },
    {
      key: "late_days",
      label: "Late",
      sortable: true,
      accessor: (report) => report.late_days,
      render: (report) => <span className="text-yellow-600">{report.late_days}</span>,
      align: "center",
    },
    {
      key: "absent_days",
      label: "Absent",
      sortable: true,
      accessor: (report) => report.absent_days,
      render: (report) => <span className="text-red-600">{report.absent_days}</span>,
      align: "center",
    },
    {
      key: "total_hours",
      label: "Hours",
      sortable: true,
      accessor: (report) => report.total_hours,
      render: (report) => report.total_hours.toFixed(1),
      align: "center",
    },
    {
      key: "attendance_rate",
      label: "Attendance Rate",
      sortable: true,
      accessor: (report) => report.attendance_rate,
      render: (report) => (
        <Badge
          variant={
            report.attendance_rate >= 80 ? "default" : report.attendance_rate >= 60 ? "secondary" : "destructive"
          }
        >
          {report.attendance_rate}%
        </Badge>
      ),
    },
  ]

  const reportFilters: DataTableFilter<AttendanceReport>[] = [
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
    },
    {
      key: "rate_band",
      label: "Attendance Band",
      options: [
        { value: "excellent", label: "80%+" },
        { value: "watch", label: "60-79%" },
        { value: "risk", label: "Below 60%" },
      ],
      placeholder: "All Bands",
      mode: "custom",
      filterFn: (report, values) => {
        if (values.length === 0) return true
        return values.some((value) => {
          if (value === "excellent") return report.attendance_rate >= 80
          if (value === "watch") return report.attendance_rate >= 60 && report.attendance_rate < 80
          if (value === "risk") return report.attendance_rate < 60
          return false
        })
      },
    },
  ]

  return (
    <DataTablePage
      title="Attendance Reports"
      description="Generate, review, and export attendance performance reports."
      icon={BarChart3}
      backLink={{ href: "/admin/hr", label: "Back to HR" }}
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={generateReport} disabled={loading} size="sm">
            <FileText className="mr-2 h-4 w-4" />
            {loading ? "Generating..." : "Generate Report"}
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={reports.length === 0} size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Employees"
            value={stats.employees}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Present Days"
            value={stats.present}
            icon={FileText}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Absent Days"
            value={stats.absent}
            icon={FileText}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Avg Attendance"
            value={stats.averageRate}
            icon={BarChart3}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 rounded-xl border p-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label>Department</Label>
          <Select value={filters.department} onValueChange={(value) => setFilters({ ...filters, department: value })}>
            <SelectTrigger>
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department} value={department}>
                  {department}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={filters.start_date}
            onChange={(event) => setFilters({ ...filters, start_date: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>End Date</Label>
          <Input
            type="date"
            value={filters.end_date}
            onChange={(event) => setFilters({ ...filters, end_date: event.target.value })}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={generateReport} disabled={loading} className="w-full">
            <FileText className="mr-2 h-4 w-4" />
            Generate
          </Button>
        </div>
      </div>

      <DataTable<AttendanceReport>
        data={reports}
        columns={columns}
        filters={reportFilters}
        getRowId={(report) => report.user_id}
        searchPlaceholder="Search employee or department..."
        searchFn={(report, query) => [report.user_name, report.department].join(" ").toLowerCase().includes(query)}
        isLoading={loading}
        expandable={{
          render: (report) => (
            <div className="grid gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Total Days</p>
                <p className="mt-1">{report.total_days}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Present Days</p>
                <p className="mt-1">{report.present_days}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Late Days</p>
                <p className="mt-1">{report.late_days}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Absent Days</p>
                <p className="mt-1">{report.absent_days}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(report) => <AttendanceCard report={report} />}
        emptyTitle={loading ? "Generating report..." : "No report generated"}
        emptyDescription="Pick a date range and generate attendance results."
        emptyIcon={FileText}
        skeletonRows={6}
        minWidth="1100px"
      />
    </DataTablePage>
  )
}
