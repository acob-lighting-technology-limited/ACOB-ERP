"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatCard } from "@/components/ui/stat-card"
import { Users, Clock, AlertCircle, FileText, Pencil } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate } from "@/lib/hr/attendance-utils"
import { StatusBadge, formatTime, labelSource } from "./status-badge"

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function getHourBreakdown(r: AttendanceRecord) {
  const inMin = parseTimeToMinutes(r.clock_in)
  const outMin = parseTimeToMinutes(r.clock_out)
  if (inMin === null || outMin === null || outMin <= inMin) {
    return { total: null, work: null, overtime: null }
  }
  const total = (outMin - inMin) / 60
  const workStart = 8 * 60
  const workEnd = 17 * 60
  const workMinutes = Math.max(0, Math.min(outMin, workEnd) - Math.max(inMin, workStart))
  const work = workMinutes / 60
  const overtime = Math.max(0, total - work)
  return { total, work, overtime }
}

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

interface DailyRosterViewProps {
  departments: string[]
}

export function DailyRosterView({ departments }: DailyRosterViewProps) {
  const [rosterDate, setRosterDate] = useState(toLocalISODate())
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: "", clock_out: "" })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ start_date: rosterDate, end_date: rosterDate })
      const res = await fetch(`/api/admin/hr/attendance/records?${params}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load roster")
      setRecords(payload.records || [])
    } catch {
      toast.error("Failed to load daily roster")
    } finally {
      setLoading(false)
    }
  }, [rosterDate])

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
      const body: Record<string, unknown> = {}
      if (editForm.clock_in) body.clock_in = editForm.clock_in
      if (editForm.clock_out) body.clock_out = editForm.clock_out
      const res = await fetch(`/api/admin/hr/attendance/records/${editRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save")
      toast.success("Record updated")
      setEditRecord(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(
    () => ({
      present: records.filter((r) => r.status === "present").length,
      late: records.filter((r) => r.status === "late").length,
      issues: records.filter((r) => r.status === "incomplete" || (r.clock_in && !r.clock_out)).length,
    }),
    [records]
  )

  const departmentOptions = useMemo(() => departments.map((d) => ({ value: d, label: d })), [departments])

  const columns: DataTableColumn<AttendanceRecord>[] = [
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
      key: "clock_in",
      label: "Clock In",
      accessor: (r) => r.clock_in ?? "",
      render: (r) => <span className="text-sm">{formatTime(r.clock_in)}</span>,
      align: "center",
    },
    {
      key: "clock_out",
      label: "Clock Out",
      accessor: (r) => r.clock_out ?? "",
      render: (r) => <span className="text-sm">{formatTime(r.clock_out)}</span>,
      align: "center",
    },
    {
      key: "total_hours",
      label: "Total Hr",
      sortable: true,
      accessor: (r) => r.total_hours ?? 0,
      render: (r) => {
        const { total } = getHourBreakdown(r)
        return <span>{total != null ? `${total.toFixed(1)}h` : "—"}</span>
      },
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "work_hours",
      label: "Work Hour",
      sortable: true,
      accessor: (r) => getHourBreakdown(r).work ?? 0,
      render: (r) => {
        const { work } = getHourBreakdown(r)
        return <span>{work != null ? `${work.toFixed(1)}h` : "—"}</span>
      },
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "overtime",
      label: "Over Time",
      sortable: true,
      accessor: (r) => getHourBreakdown(r).overtime ?? 0,
      render: (r) => {
        const { overtime } = getHourBreakdown(r)
        return overtime != null && overtime >= 0.05 ? (
          <span className="font-medium text-orange-600 dark:text-orange-400">+{overtime.toFixed(1)}h</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
      align: "center",
      hideOnMobile: true,
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
      render: (r) => <span className="text-muted-foreground text-xs">{labelSource(r.source)}</span>,
      hideOnMobile: true,
    },
    {
      key: "actions",
      label: "Edit",
      render: (r) => (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ]

  const tableFilters: DataTableFilter<AttendanceRecord>[] = [
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
    },
    {
      key: "status",
      label: "Status",
      options: [
        { value: "present", label: "Present" },
        { value: "late", label: "Late" },
        { value: "incomplete", label: "Incomplete" },
        { value: "absent", label: "Absent" },
      ],
      placeholder: "All Statuses",
    },
  ]

  const invalidTimeRange = Boolean(editForm.clock_in && editForm.clock_out && editForm.clock_out < editForm.clock_in)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Date</Label>
          <input
            type="date"
            value={rosterDate}
            max={toLocalISODate()}
            onChange={(e) => setRosterDate(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          title="Present"
          value={stats.present}
          icon={Users}
          iconBgColor="bg-green-500/10"
          iconColor="text-green-500"
        />
        <StatCard
          title="Late"
          value={stats.late}
          icon={Clock}
          iconBgColor="bg-yellow-500/10"
          iconColor="text-yellow-500"
        />
        <StatCard
          title="Incomplete / Issues"
          value={stats.issues}
          icon={AlertCircle}
          iconBgColor="bg-red-500/10"
          iconColor="text-red-500"
        />
      </div>

      <DataTable<AttendanceRecord>
        data={records}
        columns={columns}
        filters={tableFilters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search employee or department…"
        searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
        isLoading={loading}
        emptyTitle="No records for this date"
        emptyDescription="No attendance records found for the selected date."
        emptyIcon={FileText}
      />

      <Dialog open={editRecord !== null} onOpenChange={(open) => !open && setEditRecord(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Attendance Record</DialogTitle>
            <DialogDescription>
              {editRecord?.user_name} — {rosterDate}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-muted-foreground text-xs">Status is auto-derived from clock times.</p>
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
            {invalidTimeRange && <p className="text-destructive text-xs">Clock out must be after clock in.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving || invalidTimeRange}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
