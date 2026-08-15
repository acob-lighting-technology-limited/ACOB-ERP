"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatCard } from "@/components/ui/stat-card"
import { Users, Clock, AlertCircle, FileText, Pencil, ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate, isLate } from "@/lib/hr/attendance-utils"
import { computeAttendanceDay } from "@/lib/hr/attendance-ssot"
import { type AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { MANUAL_ATTENDANCE_STATUS_OPTIONS, isEarlyDeparture } from "@/lib/hr/attendance-status"
import { StatusBadge, formatTime, labelSource } from "./status-badge"
import { apiFetch } from "@/lib/api-client"

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function getHourBreakdown(r: AttendanceRecord, policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY) {
  const inMin = parseTimeToMinutes(r.clock_in)
  const outMin = parseTimeToMinutes(r.clock_out)

  // One punch only — surface what the day actually costs (the recorded side's
  // bracket plus the incomplete penalty) instead of a dash. Work stays blank
  // because the missing half of the day is unverifiable.
  if ((inMin === null) !== (outMin === null)) {
    const { hoursLost } = computeAttendanceDay({
      status: "incomplete",
      clockIn: r.clock_in,
      clockOut: r.clock_out,
      policy,
      earlyCloseTime: r.early_closure_time ?? null,
      lateResumptionTime: r.late_resumption_time ?? null,
    })
    return { total: null, work: null, overtime: null, missed: hoursLost }
  }

  if (inMin === null || outMin === null || outMin <= inMin) {
    return { total: null, work: null, overtime: null, missed: null }
  }
  const total = (outMin - inMin) / 60

  // Work, missed and overtime all come from the SSOT. Work and missed sit on the
  // bracketed 8.5-hour scale and always add up to the net day; overtime is strictly
  // time past the configured shift end, so arriving early is not overtime.
  // Only "total" is raw clock time.
  const {
    hoursLost: missed,
    hoursWorked: work,
    overtimeHours: overtime,
  } = computeAttendanceDay({
    status: r.status,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    policy,
    earlyCloseTime: r.early_closure_time ?? null,
    lateResumptionTime: r.late_resumption_time ?? null,
  })

  return { total, work, overtime, missed }
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
  clock_in_source?: string | null
  clock_out_source?: string | null
  waived?: boolean
  manual_comment?: string | null
  early_closure_time?: string | null
  late_resumption_time?: string | null
}

interface DailyRosterViewProps {
  departments: string[]
  lockedDepartment?: string
}

export function DailyRosterView({ departments, lockedDepartment }: DailyRosterViewProps) {
  const [rosterDate, setRosterDate] = useState(toLocalISODate())
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [editForm, setEditForm] = useState({ status: "", manual_comment: "" })
  const [saving, setSaving] = useState(false)
  // Served by the records API so day breakdowns here charge the same hours the
  // server did. Defaults only apply until the first response lands.
  const [policy, setPolicy] = useState<AttendancePolicy>(DEFAULT_ATTENDANCE_POLICY)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ start_date: rosterDate, end_date: rosterDate, include_all: "1" })
      if (lockedDepartment) params.set("department", lockedDepartment)
      const res = await apiFetch(`/api/admin/hr/attendance/records?${params}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load roster")
      setRecords(payload.records || [])
      if (payload?.policy) setPolicy({ ...DEFAULT_ATTENDANCE_POLICY, ...payload.policy })
    } catch {
      toast.error("Failed to load daily roster")
    } finally {
      setLoading(false)
    }
  }, [rosterDate, lockedDepartment])

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
      // Synthetic rows (employees with no record for the day) have no real id → create instead of update.
      const isNew = editRecord.id.startsWith("missing-")
      let res: Response
      if (isNew) {
        const body: Record<string, unknown> = {
          user_id: editRecord.user_id,
          date: editRecord.date,
          waived: false,
          manual_comment: editForm.manual_comment,
          status: editForm.status,
          clock_in: null,
          clock_out: null,
        }
        res = await apiFetch(`/api/admin/hr/attendance/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        const body: Record<string, unknown> = {
          waived: false,
          manual_comment: editForm.manual_comment,
          status: editForm.status,
        }
        res = await apiFetch(`/api/admin/hr/attendance/records/${editRecord.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save")
      toast.success(isNew ? "Record created" : "Record updated")
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
      early: records.filter((r) => r.status === "early").length,
      present: records.filter((r) =>
        ["early", "present", "late", "incomplete", "lateness_with_permission"].includes(r.status ?? "")
      ).length,
      late: records.filter((r) => r.status === "late").length,
      incomplete: records.filter((r) => r.status === "incomplete").length,
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
      key: "work_hours",
      label: "Work Hour",
      sortable: true,
      accessor: (r) => getHourBreakdown(r, policy).work ?? 0,
      render: (r) => {
        const { work } = getHourBreakdown(r, policy)
        return <span>{work != null ? `${work.toFixed(1)}h` : "—"}</span>
      },
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "missed_hours",
      label: "Missed",
      sortable: true,
      accessor: (r) => getHourBreakdown(r, policy).missed ?? 0,
      render: (r) => {
        const { missed } = getHourBreakdown(r, policy)
        if (missed == null) return <span className="text-muted-foreground">—</span>
        return missed > 0 ? (
          <span className="text-orange-500">{missed.toFixed(1)}h</span>
        ) : (
          <span className="text-muted-foreground">0.0h</span>
        )
      },
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "total_hours",
      label: "Total Hr",
      sortable: true,
      accessor: (r) => r.total_hours ?? 0,
      render: (r) => {
        const { total } = getHourBreakdown(r, policy)
        return <span>{total != null ? `${total.toFixed(1)}h` : "—"}</span>
      },
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "overtime",
      label: "Over Time",
      sortable: true,
      accessor: (r) => getHourBreakdown(r, policy).overtime ?? 0,
      render: (r) => {
        const { overtime } = getHourBreakdown(r, policy)
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
      render: (r) => (
        <StatusBadge
          status={r.status}
          record={r}
          earlyClosure={r.early_closure_time ? { closeTime: r.early_closure_time } : null}
        />
      ),
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
      placeholder: lockedDepartment || "All Departments",
    },
    {
      key: "status",
      label: "Status",
      options: [
        { value: "early", label: "Early" },
        { value: "present", label: "Present" },
        { value: "late", label: "Late" },
        { value: "lateness_with_permission", label: "LWP" },
        { value: "incomplete", label: "Incomplete" },
        { value: "absent", label: "Absent" },
        { value: "absent_with_permission", label: "AWP" },
        { value: "out_of_station", label: "OOS" },
        { value: "exempted", label: "Exempted" },
        { value: "waiver", label: "Waiver" },
        { value: "on_leave", label: "On Leave" },
        { value: "holiday", label: "Holiday" },
      ],
      placeholder: "All Statuses",
    },
  ]

  const clockIn = editRecord?.clock_in ?? null
  const clockOut = editRecord?.clock_out ?? null
  const hasClockIn = Boolean(clockIn)
  const hasClockOut = Boolean(clockOut)
  const hasAnyPunch = hasClockIn || hasClockOut

  const isLatePunch = hasClockIn && isLate(clockIn)
  const isEarlyOut = hasClockOut && isEarlyDeparture(clockOut as string)
  const isOnTimePresent = hasClockIn && hasClockOut && !isLatePunch && !isEarlyOut

  const showAWP = !hasAnyPunch
  const showLWP = hasAnyPunch && !isOnTimePresent

  const statusOptions = [
    ...(showLWP ? [{ value: "lateness_with_permission", label: "LWP" }] : []),
    ...(showAWP ? [{ value: "absent_with_permission", label: "AWP" }] : []),
  ]

  const hasManualComment = editForm.manual_comment.trim().length >= 3
  const cannotSave = saving || !editForm.status || !hasManualComment || isOnTimePresent

  const todayIso = toLocalISODate()
  function shiftDate(deltaDays: number) {
    setRosterDate((prev) => {
      const d = new Date(`${prev}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + deltaDays)
      const next = toLocalISODate(d)
      // Don't allow navigating into the future.
      return next > todayIso ? prev : next
    })
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Date</Label>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => shiftDate(-1)}
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={rosterDate}
            max={todayIso}
            onChange={(e) => setRosterDate(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => shiftDate(1)}
            disabled={rosterDate >= todayIso}
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          title="Present"
          value={stats.present}
          icon={Users}
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Early"
          value={stats.early}
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
          title="Incomplete"
          value={stats.incomplete}
          icon={AlertCircle}
          iconBgColor="bg-cyan-500/10"
          iconColor="text-cyan-500"
        />
        <StatCard
          title="Absent"
          value={stats.absent}
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
        pagination={{ pageSize: 50 }}
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
            <DialogTitle>
              {editRecord?.id.startsWith("missing-") ? "Add Attendance Record" : "Edit Attendance Record"}
            </DialogTitle>
            <DialogDescription>
              {editRecord?.user_name} — {rosterDate}
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
