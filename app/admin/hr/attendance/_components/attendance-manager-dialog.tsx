"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Trash2, CalendarDays, ShieldOff, MapPin, CheckCircle2, Plane } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate, monthBounds, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { logger } from "@/lib/logger"

const log = logger("attendance-manager-dialog")

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface AttendanceReport {
  user_id: string
  user_name: string
  department: string
  employee_no?: string
  attendance_exempt?: boolean
  exempted_days?: number
}

interface Holiday {
  holiday_date: string
  name?: string | null
}

interface AttendanceManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reports: AttendanceReport[]
  yearMonth: string
  holidays: Holiday[]
  onHolidaysChanged: () => void
  onReportChanged: () => void
  lockedDepartment?: string
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function EmployeeCheckList({
  reports,
  selected,
  onChange,
  search,
  onSearchChange,
}: {
  reports: AttendanceReport[]
  selected: string[]
  onChange: (ids: string[]) => void
  search: string
  onSearchChange: (v: string) => void
}) {
  const filtered = reports.filter((r) =>
    `${r.user_name} ${r.department} ${r.employee_no ?? ""}`.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className="space-y-2">
      <Input placeholder="Search employee…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(filtered.map((r) => r.user_id))}>
          Select All
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
          Clear
        </Button>
        {selected.length > 0 && (
          <span className="text-muted-foreground ml-auto text-xs">{selected.length} selected</span>
        )}
      </div>
      <div className="max-h-44 space-y-0.5 overflow-auto rounded border p-2">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">No employees found</p>
        ) : (
          filtered.map((row) => (
            <label
              key={row.user_id}
              className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(row.user_id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, row.user_id] : selected.filter((id) => id !== row.user_id))
                }
              />
              <span>{row.user_name}</span>
              <span className="text-muted-foreground text-xs">({row.department})</span>
              {(row.attendance_exempt || (row.exempted_days ?? 0) > 0) && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  Exempted
                </Badge>
              )}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Exemption
// ────────────────────────────────────────────────────────────

function ExemptionTab({
  reports,
  yearMonth,
  onDone,
}: {
  reports: AttendanceReport[]
  yearMonth: string
  onDone: () => void
}) {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mode, setMode] = useState<"off" | "infinite" | "weekly" | "monthly" | "period">("off")
  const [month, setMonth] = useState(yearMonth)
  const [weeks, setWeeks] = useState<number[]>([])
  const [months, setMonths] = useState<string[]>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one employee")
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { user_ids: selectedIds, mode, reason: reason || undefined }
      if (mode === "weekly") body.month = month
      if (mode === "weekly") body.weeks = weeks
      if (mode === "monthly") body.months = months
      if (mode === "period") {
        body.start_date = startDate
        body.end_date = endDate
      }
      const res = await fetch("/api/admin/hr/attendance/exemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to save exemption")
        return
      }
      toast.success("Exemption saved")
      setSelectedIds([])
      setReason("")
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "exemption save failed")
      toast.error("Failed to save exemption")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <EmployeeCheckList
        reports={reports}
        selected={selectedIds}
        onChange={setSelectedIds}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="space-y-2">
        <Label>Exemption Mode</Label>
        <Select value={mode} onValueChange={(v: "off" | "infinite" | "weekly" | "monthly" | "period") => setMode(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Disabled (remove exemption)</SelectItem>
            <SelectItem value="infinite">Permanent (until disabled)</SelectItem>
            <SelectItem value="weekly">Specific weeks in a month</SelectItem>
            <SelectItem value="monthly">Specific months</SelectItem>
            <SelectItem value="period">Custom date range</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "weekly" && (
        <div className="space-y-2">
          <Label>Month</Label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
          <Label>Weeks</Label>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((wk) => (
              <Button
                key={wk}
                type="button"
                variant={weeks.includes(wk) ? "default" : "outline"}
                size="sm"
                onClick={() => setWeeks((prev) => (prev.includes(wk) ? prev.filter((x) => x !== wk) : [...prev, wk]))}
              >
                Week {wk}
              </Button>
            ))}
          </div>
        </div>
      )}

      {mode === "monthly" && (
        <div className="space-y-2">
          <Label>Months</Label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (!months.includes(month)) setMonths((prev) => [...prev, month].sort())
              }}
            >
              Add Month
            </Button>
          </div>
          {months.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {months.map((m) => (
                <Badge key={m} variant="secondary" className="gap-1">
                  {m}
                  <button
                    type="button"
                    onClick={() => setMonths((prev) => prev.filter((x) => x !== m))}
                    className="hover:text-destructive ml-0.5"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "period" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>End Date</Label>
            <Input
              type="date"
              min={startDate || undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {mode !== "off" && (
        <div className="space-y-1">
          <Label>Reason (optional)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Remote assignment" />
        </div>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={saving || selectedIds.length === 0}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : mode === "off" ? "Remove Exemption" : "Apply Exemption"}
      </Button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Holiday
// ────────────────────────────────────────────────────────────

function HolidayTab({
  holidays,
  yearMonth,
  onChanged,
}: {
  holidays: Holiday[]
  yearMonth: string
  onChanged: () => void
}) {
  const [date, setDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isRange, setIsRange] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function addHoliday() {
    if (!date || !name.trim()) {
      toast.error("Please fill in the date and name")
      return
    }
    setSaving(true)
    const res = await fetch("/api/admin/hr/attendance/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holiday_date: date,
        holiday_date_end: isRange && endDate ? endDate : undefined,
        name: name || undefined,
      }),
    })
    const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!res.ok) {
      toast.error(payload?.error || "Failed to add holiday")
    } else {
      toast.success(payload?.message || "Holiday added")
      setDate("")
      setEndDate("")
      setName("")
      onChanged()
    }
    setSaving(false)
  }

  async function removeHoliday(holidayDate: string) {
    const res = await fetch(`/api/admin/hr/attendance/holidays?holiday_date=${encodeURIComponent(holidayDate)}`, {
      method: "DELETE",
    })
    const payload = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) {
      toast.error(payload?.error || "Failed to remove holiday")
      return
    }
    toast.success("Holiday removed")
    onChanged()
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <Switch
          id="mgr-holiday-range"
          checked={isRange}
          onCheckedChange={(c) => {
            setIsRange(c)
            if (!c) setEndDate("")
          }}
        />
        <Label htmlFor="mgr-holiday-range">Date range (multiple days)</Label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{isRange ? "Start Date" : "Date"}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {isRange ? (
          <div className="space-y-1">
            <Label>
              End Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>
              Name <span className="text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workers Day" />
          </div>
        )}
      </div>
      {isRange && (
        <div className="space-y-1">
          <Label>
            Name <span className="text-destructive">*</span>
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Christmas Break" />
        </div>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={!date || !name.trim() || saving || (isRange && (!endDate || endDate < date))}
        onClick={() => void addHoliday()}
      >
        {saving ? "Saving…" : isRange ? "Add Holidays" : "Add Holiday"}
      </Button>

      <div className="mt-2">
        <Label className="text-muted-foreground mb-2 block text-xs tracking-wider uppercase">
          Holidays in {yearMonth}
        </Label>
        <div className="max-h-52 space-y-1 overflow-auto rounded border p-2">
          {holidays.length === 0 ? (
            <p className="text-muted-foreground py-2 text-center text-sm">No holidays for this month</p>
          ) : (
            holidays.map((h) => (
              <div
                key={h.holiday_date}
                className="flex items-center justify-between rounded border px-2 py-1.5 text-sm"
              >
                <span>
                  {h.holiday_date}
                  {h.name ? ` • ${h.name}` : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => void removeHoliday(h.holiday_date)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Out of Station (OOS)
// ────────────────────────────────────────────────────────────

function OOSTab({ reports, onDone }: { reports: AttendanceReport[]; onDone: () => void }) {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState(toLocalISODate())
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one employee")
      return
    }
    if (!startDate || !endDate) {
      toast.error("Please set a date range")
      return
    }
    if (!comment.trim()) {
      toast.error("A comment is required for OOS records")
      return
    }
    if (endDate < startDate) {
      toast.error("End date must be on or after start date")
      return
    }

    setSaving(true)
    try {
      // POST bulk OOS records
      const res = await fetch("/api/admin/hr/attendance/records/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: selectedIds,
          start_date: startDate,
          end_date: endDate,
          status: "out_of_station",
          manual_comment: comment.trim(),
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; created?: number } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to apply OOS")
        return
      }
      toast.success(`OOS applied for ${payload?.created ?? selectedIds.length} record(s)`)
      setSelectedIds([])
      setComment("")
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "OOS save failed")
      toast.error("Failed to apply OOS")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Mark employees as <strong>Out of Station</strong> for a date range. This creates attendance records with OOS
        status, counting as an approved absence.
      </p>
      <EmployeeCheckList
        reports={reports}
        selected={selectedIds}
        onChange={setSelectedIds}
        search={search}
        onSearchChange={setSearch}
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>End Date</Label>
          <Input
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>
          Comment <span className="text-destructive">*</span>
        </Label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="e.g. Field assignment to Lagos branch"
          rows={2}
        />
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={saving || selectedIds.length === 0}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Apply OOS"}
      </Button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Waiver
// ────────────────────────────────────────────────────────────

function WaiverTab({ reports, onDone }: { reports: AttendanceReport[]; onDone: () => void }) {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState(toLocalISODate())
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one employee")
      return
    }
    if (!startDate || !endDate) {
      toast.error("Please set a date range")
      return
    }
    if (!reason.trim()) {
      toast.error("A waiver reason is required")
      return
    }
    if (endDate < startDate) {
      toast.error("End date must be on or after start date")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin/hr/attendance/records/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: selectedIds,
          start_date: startDate,
          end_date: endDate,
          status: "waiver",
          waiver_reason: reason.trim(),
          manual_comment: reason.trim(),
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; created?: number } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to apply waiver")
        return
      }
      toast.success(`Waiver applied for ${payload?.created ?? selectedIds.length} record(s)`)
      setSelectedIds([])
      setReason("")
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "waiver save failed")
      toast.error("Failed to apply waiver")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Apply an attendance <strong>waiver</strong> for selected employees over a date range. Waived days are counted
        separately and do not penalise the attendance score.
      </p>
      <EmployeeCheckList
        reports={reports}
        selected={selectedIds}
        onChange={setSelectedIds}
        search={search}
        onSearchChange={setSearch}
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>End Date</Label>
          <Input
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>
          Waiver Reason <span className="text-destructive">*</span>
        </Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. National conference attendance"
          rows={2}
        />
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={saving || selectedIds.length === 0}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Apply Waiver"}
      </Button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Leave (manual bypass)
// ────────────────────────────────────────────────────────────

function LeaveTab({ reports, onDone }: { reports: AttendanceReport[]; onDone: () => void }) {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState(toLocalISODate())
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [leaveType, setLeaveType] = useState("annual")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one employee")
      return
    }
    if (!startDate || !endDate) {
      toast.error("Please set a date range")
      return
    }
    if (!comment.trim()) {
      toast.error("A comment is required")
      return
    }
    if (endDate < startDate) {
      toast.error("End date must be on or after start date")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin/hr/attendance/leave/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: selectedIds,
          start_date: startDate,
          end_date: endDate,
          leave_type: leaveType,
          comment: comment.trim(),
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; created?: number } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to add leave")
        return
      }
      toast.success(`Leave added for ${payload?.created ?? selectedIds.length} employee(s)`)
      setSelectedIds([])
      setComment("")
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "leave save failed")
      toast.error("Failed to add leave")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Manually add <strong>approved leave</strong> for employees, bypassing the normal leave request chain. The leave
        will appear as &ldquo;On Leave&rdquo; in attendance reports.
      </p>
      <EmployeeCheckList
        reports={reports}
        selected={selectedIds}
        onChange={setSelectedIds}
        search={search}
        onSearchChange={setSearch}
      />
      <div className="space-y-1">
        <Label>Leave Type</Label>
        <Select value={leaveType} onValueChange={setLeaveType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual">Annual Leave</SelectItem>
            <SelectItem value="sick">Sick Leave</SelectItem>
            <SelectItem value="maternity">Maternity Leave</SelectItem>
            <SelectItem value="paternity">Paternity Leave</SelectItem>
            <SelectItem value="compassionate">Compassionate Leave</SelectItem>
            <SelectItem value="study">Study Leave</SelectItem>
            <SelectItem value="unpaid">Unpaid Leave</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>End Date</Label>
          <Input
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>
          Comment / Reason <span className="text-destructive">*</span>
        </Label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="e.g. Emergency family situation — pre-approved by HOD"
          rows={2}
        />
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={saving || selectedIds.length === 0}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Add Leave Record"}
      </Button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Main Dialog
// ────────────────────────────────────────────────────────────

export function AttendanceManagerDialog({
  open,
  onOpenChange,
  reports,
  yearMonth,
  holidays,
  onHolidaysChanged,
  onReportChanged,
}: AttendanceManagerDialogProps) {
  const [activeTab, setActiveTab] = useState("exemption")

  // Reset to first tab on open
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) setActiveTab("exemption")
    prevOpen.current = open
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attendance Manager</DialogTitle>
          <DialogDescription>Manage exemptions, holidays, OOS, waivers, and manual leave records.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="exemption" className="text-xs">
              <ShieldOff className="mr-1 h-3.5 w-3.5 shrink-0" />
              Exempt
            </TabsTrigger>
            <TabsTrigger value="holiday" className="text-xs">
              <CalendarDays className="mr-1 h-3.5 w-3.5 shrink-0" />
              Holiday
            </TabsTrigger>
            <TabsTrigger value="oos" className="text-xs">
              <MapPin className="mr-1 h-3.5 w-3.5 shrink-0" />
              OOS
            </TabsTrigger>
            <TabsTrigger value="waiver" className="text-xs">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0" />
              Waiver
            </TabsTrigger>
            <TabsTrigger value="leave" className="text-xs">
              <Plane className="mr-1 h-3.5 w-3.5 shrink-0" />
              Leave
            </TabsTrigger>
          </TabsList>

          <TabsContent value="exemption">
            <ExemptionTab reports={reports} yearMonth={yearMonth} onDone={onReportChanged} />
          </TabsContent>

          <TabsContent value="holiday">
            <HolidayTab holidays={holidays} yearMonth={yearMonth} onChanged={onHolidaysChanged} />
          </TabsContent>

          <TabsContent value="oos">
            <OOSTab reports={reports} onDone={onReportChanged} />
          </TabsContent>

          <TabsContent value="waiver">
            <WaiverTab reports={reports} onDone={onReportChanged} />
          </TabsContent>

          <TabsContent value="leave">
            <LeaveTab reports={reports} onDone={onReportChanged} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
