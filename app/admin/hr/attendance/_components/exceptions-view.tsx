"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { Clock, AlertTriangle, XCircle, FileText, Pencil } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate, monthBounds, toLocalYearMonth, isLate } from "@/lib/hr/attendance-utils"
import {
  MANUAL_ATTENDANCE_STATUS_OPTIONS,
  isEarlyDeparture,
  getManualStatusEditOptions,
} from "@/lib/hr/attendance-status"
import { formatTime, labelSource, StatusBadge } from "./status-badge"
import { apiFetch } from "@/lib/api-client"

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
  clock_in_source?: string | null
  clock_out_source?: string | null
  manual_comment?: string | null
}

interface ExceptionsViewProps {
  departments: string[]
  lockedDepartment?: string
}

function isPastRecord(r: { date?: string | null }) {
  return Boolean(r.date && r.date < toLocalISODate())
}

function issueBadge(record: AttendanceRecord) {
  const isPast = isPastRecord(record)
  const statusKey =
    record.status === "incomplete" || (isPast && record.clock_in && !record.clock_out) ? "incomplete" : record.status
  return <StatusBadge status={statusKey} record={record} />
}

function isException(r: AttendanceRecord) {
  const isPast = isPastRecord(r)
  return (
    r.status === "late" ||
    r.status === "incomplete" ||
    r.status === "absent" ||
    (isPast && Boolean(r.clock_in) && !r.clock_out)
  )
}

export function ExceptionsView({ departments, lockedDepartment }: ExceptionsViewProps) {
  const { start: defaultStart } = monthBounds(toLocalYearMonth())
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [editForm, setEditForm] = useState({ status: "", manual_comment: "" })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!startDate || !endDate) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
      if (lockedDepartment) params.set("department", lockedDepartment)
      const res = await apiFetch(`/api/admin/hr/attendance/records?${params}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load")
      const all: AttendanceRecord[] = payload.records || []
      setRecords(all.filter(isException))
    } catch {
      toast.error("Failed to load exceptions")
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, lockedDepartment])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit(record: AttendanceRecord) {
    const clockIn = record.clock_in ?? null
    const clockOut = record.clock_out ?? null
    const hasClockIn = Boolean(clockIn)
    const hasClockOut = Boolean(clockOut)
    const hasAnyPunch = hasClockIn || hasClockOut

    const isLatePunch = hasClockIn && isLate(clockIn)
    const isEarlyOut = hasClockOut && isEarlyDeparture(clockOut as string)
    const isOnTimePresent = hasClockIn && hasClockOut && !isLatePunch && !isEarlyOut

    let initialStatus = ""
    if (!hasAnyPunch) {
      initialStatus = "absent_with_permission"
    } else if (!isOnTimePresent) {
      initialStatus = "lateness_with_permission"
    }

    setEditRecord(record)
    setEditForm({
      status:
        record.status && ["lateness_with_permission", "absent_with_permission"].includes(record.status)
          ? record.status
          : initialStatus,
      manual_comment: record.manual_comment ?? "",
    })
  }

  async function saveEdit() {
    if (!editRecord) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        waived: false,
        manual_comment: editForm.manual_comment,
        status: editForm.status,
      }
      const res = await apiFetch(`/api/admin/hr/attendance/records/${editRecord.id}`, {
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
      late: records.filter((r) => r.status === "late").length,
      incomplete: records.filter((r) => r.status === "incomplete" || (isPastRecord(r) && r.clock_in && !r.clock_out))
        .length,
      absent: records.filter((r) => r.status === "absent").length,
    }),
    [records]
  )

  const departmentOptions = useMemo(() => {
    const visibleDepartments = lockedDepartment ? [lockedDepartment] : departments
    return visibleDepartments.map((d) => ({ value: d, label: d }))
  }, [departments, lockedDepartment])

  const columns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      accessor: (r) => r.date,
      render: (r) => <span className="text-sm font-medium">{r.date}</span>,
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
      resizable: true,
      initialWidth: 200,
    },
    {
      key: "issue",
      label: "Issue",
      accessor: (r) => r.status,
      render: (r) => issueBadge(r),
    },
    {
      key: "clock_in",
      label: "Clock In",
      accessor: (r) => r.clock_in ?? "",
      render: (r) => (
        <span className="flex items-center justify-center gap-1 text-sm">
          {r.clock_in ? (
            <>
              <Clock className="h-3 w-3 shrink-0 text-green-600" />
              <span>{formatTime(r.clock_in)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
      align: "center",
    },
    {
      key: "clock_out",
      label: "Clock Out",
      accessor: (r) => r.clock_out ?? "",
      render: (r) => (
        <span className="flex items-center justify-center gap-1 text-sm">
          {r.clock_out ? (
            <>
              <Clock className="h-3 w-3 shrink-0 text-red-500" />
              <span>{formatTime(r.clock_out)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
      align: "center",
    },
    {
      key: "source",
      label: "Source",
      accessor: (r) => r.source ?? "",
      render: (r) => <span className="text-muted-foreground text-xs">{labelSource(r)}</span>,
      hideOnMobile: true,
    },
    {
      key: "actions",
      label: "",
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
      placeholder: lockedDepartment || "All Departments",
    },
    {
      key: "issue_type",
      label: "Issue Type",
      options: [
        { value: "late", label: "Late" },
        { value: "incomplete", label: "Missing Clock-Out" },
        { value: "absent", label: "Absent" },
      ],
      placeholder: "All Issues",
      mode: "custom",
      filterFn: (r, values) => {
        if (values.length === 0) return true
        return values.some((v) => {
          if (v === "late") return r.status === "late"
          if (v === "incomplete") return r.status === "incomplete" || (isPastRecord(r) && Boolean(r.clock_in) && !r.clock_out)
          if (v === "absent") return r.status === "absent"
          return false
        })
      },
    },
  ]

  const { isOnTimePresent, options: statusOptions } = getManualStatusEditOptions(editRecord)

  const hasManualComment = editForm.manual_comment.trim().length >= 3
  const cannotSave = saving || !editForm.status || !hasManualComment || isOnTimePresent

  return (
    <>
      {/* Date range controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">From</Label>
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">To</Label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={toLocalISODate()}
            onChange={(e) => setEndDate(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          title="Late"
          value={stats.late}
          icon={Clock}
          iconBgColor="bg-yellow-500/10"
          iconColor="text-yellow-500"
        />
        <StatCard
          title="Missing Clock-Out"
          value={stats.incomplete}
          icon={AlertTriangle}
          iconBgColor="bg-cyan-500/10"
          iconColor="text-cyan-500"
        />
        <StatCard
          title="Absent"
          value={stats.absent}
          icon={XCircle}
          iconBgColor="bg-red-500/10"
          iconColor="text-red-500"
        />
      </div>

      <DataTable<AttendanceRecord>
        data={records}
        columns={columns}
        filters={tableFilters}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search employee or department…"
        searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
        isLoading={loading}
        emptyTitle="No exceptions found"
        emptyDescription="No late, incomplete, or absent records for this period."
        emptyIcon={FileText}
      />

      <Dialog open={editRecord !== null} onOpenChange={(open) => !open && setEditRecord(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fix Attendance Record</DialogTitle>
            <DialogDescription>
              {editRecord?.user_name} — {editRecord?.date}
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
                    Comment <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={editForm.manual_comment}
                    onChange={(e) => setEditForm((f) => ({ ...f, manual_comment: e.target.value }))}
                    placeholder="Reason for this manual attendance change"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={cannotSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
