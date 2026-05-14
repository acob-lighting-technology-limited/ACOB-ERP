"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
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
import { BarChart3, Download, FileText, Users, Clock, TrendingDown, AlertCircle, Pencil } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { latenessDeduction, formatNaira, getWorkdaysInMonth, monthBounds } from "@/lib/hr/attendance-utils"

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
  lateness_deduction: number
  attendance_rate: number
}

interface DayRecord {
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

type DayStatus = "present" | "late" | "absent" | "incomplete" | "on_leave" | "weekend"

interface CalendarDay {
  date: string
  dayName: string
  record: DayRecord | null
  isOnLeave: boolean
  status: DayStatus
  deduction: number
}

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7)
}

function formatDayShort(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
}

function formatTime(t: string | null) {
  if (!t) return "—"
  return t.substring(0, 5)
}

function StatusBadge({ status, waived }: { status: DayStatus | string; waived?: boolean }) {
  if (waived) return <Badge className="bg-blue-100 text-blue-700">Waived</Badge>
  const map: Record<string, string> = {
    present: "bg-green-100 text-green-800",
    late: "bg-yellow-100 text-yellow-800",
    absent: "bg-red-100 text-red-800",
    half_day: "bg-orange-100 text-orange-800",
    incomplete: "bg-red-100 text-red-700",
    on_leave: "bg-purple-100 text-purple-800",
  }
  const label: Record<string, string> = { on_leave: "On Leave", half_day: "Half Day" }
  return <Badge className={map[status] ?? "bg-gray-100 text-gray-800"}>{label[status] ?? status}</Badge>
}

interface EmployeeExpandProps {
  report: AttendanceReport
  yearMonth: string
}

function EmployeeExpandPanel({ report, yearMonth }: EmployeeExpandProps) {
  const [days, setDays] = useState<CalendarDay[] | null>(null)
  const [editRecord, setEditRecord] = useState<DayRecord | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: "", clock_out: "", waived: false, waiver_reason: "" })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const { start, end } = monthBounds(yearMonth)
    void (async () => {
      try {
        const [recRes, leaveRes] = await Promise.all([
          fetch(`/api/admin/hr/attendance/records?user_id=${report.user_id}&start_date=${start}&end_date=${end}`, {
            cache: "no-store",
          }),
          fetch(`/api/hr/leave/requests?user_id=${report.user_id}&start_date=${start}&end_date=${end}`, {
            cache: "no-store",
          }),
        ])
        const recPayload = recRes.ok ? ((await recRes.json()) as { records?: DayRecord[] }) : null
        const leavePayload = leaveRes.ok
          ? ((await leaveRes.json()) as { data?: { start_date: string; end_date: string; status: string }[] })
          : null

        const recordsByDate = new Map<string, DayRecord>()
        for (const r of recPayload?.records ?? []) recordsByDate.set(r.date, r)

        const leaveDates = new Set<string>()
        for (const lr of leavePayload?.data ?? []) {
          if (lr.status !== "approved") continue
          const s = new Date(lr.start_date)
          const e = new Date(lr.end_date)
          for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            leaveDates.add(d.toISOString().split("T")[0])
          }
        }

        const workdays = getWorkdaysInMonth(yearMonth)
        const today = new Date().toISOString().split("T")[0]

        const calDays: CalendarDay[] = workdays.map((date) => {
          const record = recordsByDate.get(date) ?? null
          const isOnLeave = !record && leaveDates.has(date)
          let status: DayStatus = "absent"
          if (isOnLeave) status = "on_leave"
          else if (record) status = record.status as DayStatus
          else if (date > today) status = "absent" // future days — skip
          const deduction =
            record && !record.waived && record.status !== "absent" ? latenessDeduction(record.clock_in) : 0
          return { date, dayName: formatDayShort(date), record, isOnLeave, status, deduction }
        })

        setDays(calDays)
      } catch (err) {
        log.error("Failed to load employee day records", err)
        setDays([])
      }
    })()
  }, [report.user_id, yearMonth])

  function openEdit(record: DayRecord) {
    setEditRecord(record)
    setEditForm({
      clock_in: record.clock_in?.substring(0, 5) ?? "",
      clock_out: record.clock_out?.substring(0, 5) ?? "",
      waived: record.waived,
      waiver_reason: record.waiver_reason ?? "",
    })
  }

  async function saveEdit() {
    if (!editRecord) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { waived: editForm.waived, waiver_reason: editForm.waiver_reason || null }
      if (editForm.clock_in) body.clock_in = editForm.clock_in
      if (editForm.clock_out) body.clock_out = editForm.clock_out
      if (!editRecord.clock_out && editForm.clock_out && !editForm.waived) body.status = "present"
      const res = await fetch(`/api/admin/hr/attendance/records/${editRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save")
      toast.success("Record updated")
      setEditRecord(null)
      // Refresh days
      setDays(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  if (!days) {
    return <div className="text-muted-foreground py-4 text-center text-sm">Loading days…</div>
  }

  const today = new Date().toISOString().split("T")[0]
  const visibleDays = days.filter((d) => d.date <= today)

  return (
    <>
      <div className="space-y-1 py-2">
        {visibleDays.map((day) => (
          <div key={day.date} className="hover:bg-muted/30 flex items-center gap-3 rounded px-2 py-1.5 text-sm">
            <span className="w-44 text-xs font-medium">{day.dayName}</span>
            <StatusBadge status={day.status} waived={day.record?.waived} />
            <span className="text-muted-foreground w-16 text-xs">
              {day.record ? formatTime(day.record.clock_in) : "—"}
            </span>
            <span className="text-muted-foreground w-16 text-xs">
              {day.record ? formatTime(day.record.clock_out) : "—"}
            </span>
            <span className="w-14 text-xs">
              {day.record?.total_hours != null ? `${day.record.total_hours.toFixed(1)}h` : "—"}
            </span>
            <span
              className={`w-20 text-xs font-medium ${day.deduction > 0 ? "text-red-600" : "text-muted-foreground"}`}
            >
              {day.record?.waived ? "Waived" : day.deduction > 0 ? `-${formatNaira(day.deduction)}` : "₦0"}
            </span>
            {day.record && (
              <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={() => openEdit(day.record!)}>
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!editRecord} onOpenChange={(open) => !open && setEditRecord(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Attendance Record</DialogTitle>
            <DialogDescription>
              {editRecord && `${report.user_name} — ${formatDayShort(editRecord.date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Clock In</Label>
                <Input
                  type="time"
                  value={editForm.clock_in}
                  onChange={(e) => setEditForm((f) => ({ ...f, clock_in: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Clock Out</Label>
                <Input
                  type="time"
                  value={editForm.clock_out}
                  onChange={(e) => setEditForm((f) => ({ ...f, clock_out: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="waived"
                checked={editForm.waived}
                onCheckedChange={(checked) => setEditForm((f) => ({ ...f, waived: checked }))}
              />
              <Label htmlFor="waived">Waive lateness deduction</Label>
            </div>
            {editForm.waived && (
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input
                  placeholder="e.g. Permit granted, client visit"
                  value={editForm.waiver_reason}
                  onChange={(e) => setEditForm((f) => ({ ...f, waiver_reason: e.target.value }))}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function AttendanceReportsPage() {
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<AttendanceReport[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [department, setDepartment] = useState("all")

  const generateReport = useCallback(async () => {
    setLoading(true)
    try {
      const { start, end } = monthBounds(yearMonth)
      const params = new URLSearchParams({ start_date: start, end_date: end, department })
      const response = await fetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as {
        data?: AttendanceReport[]
        departments?: string[]
        error?: string
      } | null
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load attendance report")
      setReports(payload?.data ?? [])
      setDepartments(payload?.departments ?? [])
    } catch (error) {
      log.error("Error generating report:", error)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [yearMonth, department])

  useEffect(() => {
    void generateReport()
  }, [generateReport])

  function exportCSV() {
    const headers = [
      "Name",
      "Department",
      "Total Days",
      "Present",
      "Late",
      "Absent",
      "Total Hours",
      "Attendance Rate",
      "Lateness Deduction (₦)",
    ]
    const rows = reports.map((r) => [
      r.user_name,
      r.department,
      r.total_days,
      r.present_days,
      r.late_days,
      r.absent_days,
      r.total_hours.toFixed(1),
      `${r.attendance_rate}%`,
      r.lateness_deduction,
    ])
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `attendance_${yearMonth}.csv`
    a.click()
  }

  const departmentOptions = useMemo(() => departments.map((d) => ({ value: d, label: d })), [departments])

  const stats = {
    employees: reports.length,
    present: reports.reduce((a, r) => a + r.present_days, 0),
    absent: reports.reduce((a, r) => a + r.absent_days, 0),
    totalDeduction: reports.reduce((a, r) => a + r.lateness_deduction, 0),
    averageRate:
      reports.length > 0 ? `${Math.round(reports.reduce((s, r) => s + r.attendance_rate, 0) / reports.length)}%` : "—",
  }

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
    },
    {
      key: "late_days",
      label: "Late",
      sortable: true,
      accessor: (r) => r.late_days,
      render: (r) => <span className="text-yellow-600">{r.late_days}</span>,
      align: "center",
    },
    {
      key: "absent_days",
      label: "Absent",
      sortable: true,
      accessor: (r) => r.absent_days,
      render: (r) => <span className="text-red-600">{r.absent_days}</span>,
      align: "center",
    },
    {
      key: "total_hours",
      label: "Hours",
      sortable: true,
      accessor: (r) => r.total_hours,
      render: (r) => r.total_hours.toFixed(1),
      align: "center",
    },
    {
      key: "lateness_deduction",
      label: "Deduction",
      sortable: true,
      accessor: (r) => r.lateness_deduction,
      render: (r) =>
        r.lateness_deduction > 0 ? (
          <span className="font-medium text-red-600">-{formatNaira(r.lateness_deduction)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">₦0</span>
        ),
      align: "center",
    },
    {
      key: "attendance_rate",
      label: "Rate",
      sortable: true,
      accessor: (r) => r.attendance_rate,
      render: (r) => (
        <Badge variant={r.attendance_rate >= 80 ? "default" : r.attendance_rate >= 60 ? "secondary" : "destructive"}>
          {r.attendance_rate}%
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
      description="Monthly attendance performance by employee."
      icon={BarChart3}
      backLink={{ href: "/admin/hr", label: "Back to HR" }}
      actions={
        <div className="flex items-center gap-2">
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
            icon={AlertCircle}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Total Deductions"
            value={formatNaira(stats.totalDeduction)}
            icon={TrendingDown}
            iconBgColor={stats.totalDeduction > 0 ? "bg-red-500/10" : "bg-green-500/10"}
            iconColor={stats.totalDeduction > 0 ? "text-red-500" : "text-green-500"}
          />
        </div>
      }
    >
      <div className="flex flex-wrap items-end gap-4 rounded-xl border p-4">
        <div className="space-y-2">
          <Label>Month</Label>
          <input
            type="month"
            value={yearMonth}
            max={currentYearMonth()}
            onChange={(e) => setYearMonth(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label>Department</Label>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={generateReport} disabled={loading}>
          <FileText className="mr-2 h-4 w-4" />
          {loading ? "Generating…" : "Generate"}
        </Button>
      </div>

      <DataTable<AttendanceReport>
        data={reports}
        columns={columns}
        filters={reportFilters}
        getRowId={(r) => r.user_id}
        searchPlaceholder="Search employee or department…"
        searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
        isLoading={loading}
        expandable={{
          render: (r) => <EmployeeExpandPanel report={r} yearMonth={yearMonth} />,
        }}
        emptyTitle={loading ? "Generating report…" : "No report generated"}
        emptyDescription="Pick a month and generate attendance results."
        emptyIcon={FileText}
        skeletonRows={6}
        minWidth="900px"
      />
    </DataTablePage>
  )
}
