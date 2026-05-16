"use client"

import { useCallback, useEffect, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatCard } from "@/components/ui/stat-card"
import { Clock, Calendar, Pencil, AlertCircle, Download } from "lucide-react"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"

const log = logger("admin-attendance-records")

interface AttendanceRecord {
  id: string
  user_id: string
  user_name: string
  department: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(t: string | null) {
  if (!t) return "-"
  return t.substring(0, 5)
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={
        ATTENDANCE_STATUS_COLORS[status as keyof typeof ATTENDANCE_STATUS_COLORS] ?? "bg-gray-100 text-gray-800"
      }
    >
      {ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status}
    </Badge>
  )
}

export default function AdminAttendanceRecordsPage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    start_date: toLocalISODate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    end_date: toLocalISODate(),
  })

  const [exportOpen, setExportOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: "", clock_out: "" })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ start_date: filters.start_date, end_date: filters.end_date })
      const res = await fetch(`/api/admin/hr/attendance/records?${params}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load records")
      setRecords(payload.records || [])
    } catch (err) {
      log.error("Failed to load attendance records", err)
      toast.error("Failed to load records")
    } finally {
      setLoading(false)
    }
  }, [filters.start_date, filters.end_date])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit(record: AttendanceRecord) {
    setEditRecord(record)
    setEditForm({
      clock_in: record.clock_in?.substring(0, 5) ?? "",
      clock_out: record.clock_out?.substring(0, 5) ?? "",
    })
  }

  async function saveEdit() {
    if (!editRecord) return
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (editForm.clock_in) body.clock_in = editForm.clock_in
      if (editForm.clock_out) body.clock_out = editForm.clock_out
      if (!editRecord.clock_out && editForm.clock_out) body.status = "present"

      const res = await fetch(`/api/admin/hr/attendance/records/${editRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to save")
      toast.success("Record updated")
      setEditRecord(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  function downloadCSV() {
    const headers = ["Date", "Employee", "Department", "Clock In", "Clock Out", "Hours", "Status", "Source"]
    const rows = records.map((r) => [
      formatDate(r.date),
      r.user_name,
      r.department,
      formatTime(r.clock_in),
      formatTime(r.clock_out),
      r.total_hours?.toFixed(2) ?? "-",
      r.status,
      r.source === "hikvision" ? "Device" : "Manual",
    ])
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `attendance-records-${filters.start_date}-to-${filters.end_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const incomplete = records.filter((r) => !r.clock_out).length
  const totalHours = records.reduce((s, r) => s + (r.total_hours ?? 0), 0)

  const columns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      accessor: (r) => r.date,
      render: (r) => <span className="font-medium">{formatDate(r.date)}</span>,
      initialWidth: 180,
    },
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
      initialWidth: 180,
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
      render: (r) =>
        r.clock_out ? (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-red-500" />
            {formatTime(r.clock_out)}
          </span>
        ) : (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <AlertCircle className="h-3 w-3 text-orange-500" />
            Missing
          </span>
        ),
      align: "center",
    },
    {
      key: "total_hours",
      label: "Hours",
      sortable: true,
      accessor: (r) => r.total_hours ?? 0,
      render: (r) => (r.total_hours != null ? `${r.total_hours.toFixed(1)}h` : "-"),
      align: "center",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "source",
      label: "Source",
      accessor: (r) => r.source ?? "",
      render: (r) => (
        <Badge className={r.source === "hikvision" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}>
          {r.source === "hikvision" ? "Device" : "Manual"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "",
      accessor: () => "",
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
          <Pencil className="h-3 w-3" />
        </Button>
      ),
      align: "center",
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
      ],
      placeholder: "All Statuses",
    },
    {
      key: "source",
      label: "Source",
      options: [
        { value: "hikvision", label: "Device" },
        { value: "manual", label: "Manual" },
      ],
      placeholder: "All Sources",
    },
  ]

  return (
    <>
      <DataTablePage
        title="Attendance Records"
        description="View and fix individual attendance records."
        icon={Calendar}
        backLink={{ href: "/admin/hr/attendance", label: "Back to Attendance" }}
        actions={
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={records.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
        stats={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard title="Total Records" value={records.length} icon={Calendar} />
            <StatCard
              title="Missing Clock-Out"
              value={incomplete}
              icon={AlertCircle}
              iconBgColor="bg-orange-500/10"
              iconColor="text-orange-500"
            />
            <StatCard title="Total Hours" value={totalHours.toFixed(1)} icon={Clock} />
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 rounded-xl border p-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters((f) => ({ ...f, start_date: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters((f) => ({ ...f, end_date: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={load} disabled={loading} className="w-full">
              {loading ? "Loading..." : "Apply"}
            </Button>
          </div>
        </div>

        <DataTable<AttendanceRecord>
          data={records}
          columns={columns}
          filters={tableFilters}
          getRowId={(r) => r.id}
          searchPlaceholder="Search employee or department..."
          searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
          isLoading={loading}
          emptyTitle="No records found"
          emptyDescription="Adjust the date range and try again."
          emptyIcon={Calendar}
          skeletonRows={8}
          minWidth="900px"
        />
      </DataTablePage>

      <ExportOptionsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        options={[{ id: "csv", label: "CSV (.csv)", icon: "excel" }]}
        onSelect={() => {
          downloadCSV()
          setExportOpen(false)
        }}
      />

      <Dialog open={!!editRecord} onOpenChange={(open) => !open && setEditRecord(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Attendance Record</DialogTitle>
            <DialogDescription>
              {editRecord && `${editRecord.user_name} — ${formatDate(editRecord.date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
