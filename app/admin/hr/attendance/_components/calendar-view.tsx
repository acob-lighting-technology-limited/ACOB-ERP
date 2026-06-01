"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import { formatTime } from "./status-badge"

type DayStatus =
  | "present"
  | "late"
  | "absent"
  | "incomplete"
  | "half_day"
  | "waiver"
  | "exempted"
  | "on_leave"
  | "holiday"
  | "weekend"

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

interface UnifiedDay {
  date: string
  record: DayRecord | null
  status: DayStatus
}

export interface EmployeeOption {
  user_id: string
  user_name: string
  department: string
  attendance_exempt?: boolean
}

interface CalendarViewProps {
  employees: EmployeeOption[]
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function monBasedDay(jsDay: number) {
  return jsDay === 0 ? 6 : jsDay - 1
}

function formatMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function navigateMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function buildCalendarCells(yearMonth: string): (string | null)[] {
  const [year, month] = yearMonth.split("-").map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
  const offset = monBasedDay(firstDayOfWeek)
  const cells: (string | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1
      return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const CELL_BG: Record<string, string> = {
  present: "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800",
  late: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
  incomplete: "bg-cyan-50 border-cyan-200 dark:bg-cyan-950/30 dark:border-cyan-800",
  half_day: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
  absent: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
  waiver: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  exempted: "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800",
  on_leave: "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
  holiday: "bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800",
}

export function CalendarView({ employees }: CalendarViewProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>(employees[0]?.user_id ?? "")
  const [calendarMonth, setCalendarMonth] = useState(toLocalYearMonth())
  const [days, setDays] = useState<UnifiedDay[] | null>(null)
  const [loading, setLoading] = useState(false)

  const [editTarget, setEditTarget] = useState<{ date: string; record: DayRecord | null } | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: "", clock_out: "", waived: false, waiver_reason: "" })
  const [saving, setSaving] = useState(false)

  const selectedEmployee = employees.find((e) => e.user_id === selectedUserId)

  const load = useCallback(async () => {
    if (!selectedUserId) return
    setLoading(true)
    setDays(null)
    try {
      const qs = new URLSearchParams({
        user_id: selectedUserId,
        year_month: calendarMonth,
        exempt_hint: selectedEmployee?.attendance_exempt ? "1" : "0",
      })
      const res = await fetch(`/api/admin/hr/attendance/employee-days?${qs}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load")
      setDays(payload?.data ?? [])
    } catch {
      toast.error("Failed to load calendar data")
      setDays([])
    } finally {
      setLoading(false)
    }
  }, [selectedUserId, calendarMonth, selectedEmployee?.attendance_exempt])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit(day: UnifiedDay) {
    if (day.status === "on_leave") return
    setEditTarget({ date: day.date, record: day.record })
    setEditForm({
      clock_in: day.record?.clock_in?.substring(0, 5) ?? "",
      clock_out: day.record?.clock_out?.substring(0, 5) ?? "",
      waived: day.record?.waived ?? false,
      waiver_reason: day.record?.waiver_reason ?? "",
    })
  }

  async function saveEdit() {
    if (!editTarget || !selectedUserId) return
    setSaving(true)
    try {
      let res: Response
      if (editTarget.record) {
        const body: Record<string, unknown> = {
          waived: editForm.waived,
          waiver_reason: editForm.waiver_reason || null,
        }
        if (editForm.clock_in) body.clock_in = editForm.clock_in
        if (editForm.clock_out) body.clock_out = editForm.clock_out
        res = await fetch(`/api/admin/hr/attendance/records/${editTarget.record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        const body: Record<string, unknown> = {
          user_id: selectedUserId,
          date: editTarget.date,
          waived: editForm.waived,
          waiver_reason: editForm.waiver_reason || null,
        }
        if (editForm.clock_in) body.clock_in = editForm.clock_in
        if (editForm.clock_out) body.clock_out = editForm.clock_out
        res = await fetch("/api/admin/hr/attendance/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save")
      toast.success(editTarget.record ? "Record updated" : "Record created")
      setEditTarget(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const today = toLocalISODate()
  const currentYearMonth = toLocalYearMonth()
  const cells = buildCalendarCells(calendarMonth)
  const daysByDate = new Map<string, UnifiedDay>((days ?? []).map((d) => [d.date, d]))

  const isCreating = editTarget !== null && editTarget.record === null
  const hasClockIn = Boolean(editForm.clock_in)
  const hasClockOut = Boolean(editForm.clock_out)
  const hasPartialTime = hasClockIn !== hasClockOut
  const invalidTimeRange = Boolean(editForm.clock_in && editForm.clock_out && editForm.clock_out <= editForm.clock_in)
  const cannotSave =
    saving ||
    invalidTimeRange ||
    (editForm.waived && !editForm.waiver_reason.trim()) ||
    (!editForm.waived && (!(hasClockIn || hasClockOut) || hasPartialTime))

  return (
    <>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="max-w-72 min-w-48 flex-1">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select employee…" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.user_id} value={e.user_id}>
                  {e.user_name}
                  <span className="text-muted-foreground ml-2 text-xs">({e.department})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCalendarMonth((m) => navigateMonth(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{formatMonthLabel(calendarMonth)}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCalendarMonth((m) => navigateMonth(m, 1))}
            disabled={calendarMonth >= currentYearMonth}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!selectedUserId ? (
        <div className="text-muted-foreground py-16 text-center text-sm">
          Select an employee to view their attendance calendar.
        </div>
      ) : loading ? (
        <div className="text-muted-foreground py-16 text-center text-sm">Loading calendar…</div>
      ) : (
        <div className="rounded-lg border">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b">
            {DAY_HEADERS.map((d) => (
              <div key={d} className="text-muted-foreground py-2 text-center text-xs font-semibold">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              const isLastInRow = (i + 1) % 7 === 0
              if (!date) {
                return (
                  <div
                    key={`empty-${i}`}
                    className={`bg-muted/20 min-h-16 border-b p-1 ${isLastInRow ? "" : "border-r"}`}
                  />
                )
              }
              const day = daysByDate.get(date)
              const status = day?.status
              const isFuture = date > today
              const isWeekend = status === "weekend"
              const bg = !isFuture && status && CELL_BG[status] ? CELL_BG[status] : ""
              const isClickable = !isFuture && !isWeekend && day

              return (
                <div
                  key={date}
                  className={`min-h-16 border-b p-1.5 text-xs transition-colors ${isLastInRow ? "" : "border-r"} ${bg} ${isClickable ? "cursor-pointer hover:brightness-95" : ""}`}
                  onClick={() => {
                    if (isClickable) openEdit(day)
                  }}
                >
                  <div className="text-muted-foreground mb-1 font-medium">{date.slice(8)}</div>
                  {!isFuture && day && status && status !== "weekend" && (
                    <>
                      <div className="truncate leading-tight font-medium" style={{ fontSize: "10px" }}>
                        {ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status}
                      </div>
                      {day.record?.clock_in && (
                        <div className="text-muted-foreground leading-tight" style={{ fontSize: "10px" }}>
                          {formatTime(day.record.clock_in)}
                          {day.record.clock_out ? ` – ${formatTime(day.record.clock_out)}` : ""}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.entries(ATTENDANCE_STATUS_LABELS) as [string, string][]).map(([key, label]) => (
          <Badge
            key={key}
            className={`text-xs ${ATTENDANCE_STATUS_COLORS[key as keyof typeof ATTENDANCE_STATUS_COLORS]}`}
          >
            {label}
          </Badge>
        ))}
      </div>

      {/* Edit dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isCreating ? "Add Attendance Record" : "Edit Attendance Record"}</DialogTitle>
            <DialogDescription>
              {selectedEmployee?.user_name} — {editTarget?.date}
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
            <div className="flex items-center gap-3">
              <Switch
                id="cal-waived"
                checked={editForm.waived}
                onCheckedChange={(checked: boolean) => setEditForm((f) => ({ ...f, waived: checked }))}
              />
              <Label htmlFor="cal-waived">Waive deduction</Label>
            </div>
            {editForm.waived && (
              <div className="space-y-2">
                <Label>
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. Permit granted, client visit"
                  value={editForm.waiver_reason}
                  onChange={(e) => setEditForm((f) => ({ ...f, waiver_reason: e.target.value }))}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={cannotSave}>
              {saving ? "Saving…" : isCreating ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
