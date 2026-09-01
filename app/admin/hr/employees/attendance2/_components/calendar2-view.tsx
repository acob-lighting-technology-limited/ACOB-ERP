"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, Pencil, Users } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toLocalISODate, toLocalYearMonth, isLate } from "@/lib/hr/attendance-utils"
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  isEarlyDeparture,
  getManualStatusEditOptions,
} from "@/lib/hr/attendance-status"
import { formatTime } from "@/app/admin/hr/attendance/_components/status-badge"
import {
  CELL_BG,
  type DayRecord,
  type EmployeeOption,
  type UnifiedDay,
} from "@/app/admin/hr/attendance/_components/calendar-view"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"

const DAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"]
const DAY_HEADERS_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Solid swatch per status for the compact phone grid, where text does not fit. */
const DOT_BG: Record<string, string> = {
  early: "bg-green-500",
  present: "bg-blue-500",
  late: "bg-yellow-500",
  lateness_with_permission: "bg-amber-500",
  early_departure: "bg-orange-500",
  early_departure_with_permission: "bg-orange-400",
  early_closure: "bg-blue-400",
  late_resumption: "bg-sky-500",
  incomplete: "bg-cyan-500",
  absent: "bg-red-500",
  absent_with_permission: "bg-rose-400",
  out_of_station: "bg-indigo-500",
  waiver: "bg-blue-400",
  exempted: "bg-violet-500",
  on_leave: "bg-purple-500",
  holiday: "bg-sky-400",
  half_day: "bg-yellow-400",
}

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
  const offset = monBasedDay(new Date(year, month - 1, 1).getDay())
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

function statusLabel(status: string): string {
  return ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status
}

function statusBadgeClass(status: string): string {
  return (
    ATTENDANCE_STATUS_COLORS[status as keyof typeof ATTENDANCE_STATUS_COLORS] ??
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
  )
}

export function Calendar2View({ employees }: { employees: EmployeeOption[] }) {
  const [selectedUserId, setSelectedUserId] = useState<string>(employees[0]?.user_id ?? "")
  const [calendarMonth, setCalendarMonth] = useState(toLocalYearMonth())
  const [days, setDays] = useState<UnifiedDay[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [peeked, setPeeked] = useState<UnifiedDay | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)

  const [editTarget, setEditTarget] = useState<{ date: string; record: DayRecord | null } | null>(null)
  const [editForm, setEditForm] = useState({ status: "", manual_comment: "" })
  const [saving, setSaving] = useState(false)

  const selectedEmployee = employees.find((e) => e.user_id === selectedUserId)

  // The picker defaults to the first employee, but the list arrives asynchronously
  // from the summary report — adopt the first one once it does.
  useEffect(() => {
    if (!selectedUserId && employees.length > 0) setSelectedUserId(employees[0].user_id)
  }, [employees, selectedUserId])

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
      const res = await apiFetch(`/api/admin/hr/attendance/employee-days?${qs}`, { cache: "no-store" })
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

  const today = toLocalISODate()
  const currentYearMonth = toLocalYearMonth()
  const cells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth])
  const daysByDate = useMemo(() => new Map<string, UnifiedDay>((days ?? []).map((d) => [d.date, d])), [days])

  // Only the statuses this month actually contains. The original legend printed
  // all sixteen every time, which on a phone was a full screen of colour telling
  // you nothing about the month you were looking at.
  const presentStatuses = useMemo(() => {
    const seen = new Set<string>()
    for (const d of days ?? []) {
      if (d.date > today) continue
      if (d.status && d.status !== "weekend") seen.add(d.status)
    }
    return Array.from(seen)
  }, [days, today])

  const monthSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of days ?? []) {
      if (d.date > today) continue
      if (!d.status || d.status === "weekend") continue
      counts.set(d.status, (counts.get(d.status) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [days, today])

  function openEdit(day: UnifiedDay) {
    if (day.status === "on_leave") return
    const clockIn = day.record?.clock_in ?? null
    const clockOut = day.record?.clock_out ?? null
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

    setPeeked(null)
    setEditTarget({ date: day.date, record: day.record })
    setEditForm({
      status:
        day.record?.status && ["lateness_with_permission", "absent_with_permission"].includes(day.record.status)
          ? day.record.status
          : initialStatus,
      manual_comment: day.record?.manual_comment ?? "",
    })
  }

  async function saveEdit() {
    if (!editTarget || !selectedUserId) return
    setSaving(true)
    try {
      let res: Response
      if (editTarget.record) {
        res = await apiFetch(`/api/admin/hr/attendance/records/${editTarget.record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            waived: false,
            manual_comment: editForm.manual_comment,
            status: editForm.status,
          }),
        })
      } else {
        res = await apiFetch("/api/admin/hr/attendance/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: selectedUserId,
            date: editTarget.date,
            waived: false,
            manual_comment: editForm.manual_comment,
            status: editForm.status,
            clock_in: null,
            clock_out: null,
          }),
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

  const isCreating = editTarget !== null && editTarget.record === null
  const { isOnTimePresent, options: statusOptions } = getManualStatusEditOptions(editTarget?.record ?? null)
  const hasManualComment = editForm.manual_comment.trim().length >= 3
  const cannotSave = saving || !editForm.status || !hasManualComment || isOnTimePresent

  return (
    <div className="space-y-4">
      {/* Employee picker on its own row — it is the subject of the whole view */}
      <div className="space-y-2">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="bg-card h-10 w-full border-2">
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

        <div className="bg-card flex items-center gap-2 rounded-xl border p-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setCalendarMonth((m) => navigateMonth(m, -1))}
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{formatMonthLabel(calendarMonth)}</p>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setCalendarMonth((m) => navigateMonth(m, 1))}
            disabled={calendarMonth >= currentYearMonth}
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!selectedUserId ? (
        <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
          <Users className="text-muted-foreground/50 h-10 w-10" />
          <h3 className="mt-3 text-sm font-semibold">No employee selected</h3>
          <p className="text-muted-foreground mt-1 text-xs">Pick someone above to see their attendance calendar.</p>
        </div>
      ) : (
        <>
          {/* Month summary — the numbers you would otherwise count by eye */}
          {!loading && monthSummary.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {monthSummary.map(([status, count]) => (
                <Badge key={status} className={cn("text-xs font-normal", statusBadgeClass(status))}>
                  {count} {statusLabel(status).toLowerCase()}
                </Badge>
              ))}
            </div>
          )}

          {loading ? (
            <div className="bg-card rounded-xl border p-4">
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} className="bg-muted aspect-square animate-pulse rounded" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Mobile: colour-only month grid. Badges and times cannot fit a 48px
                  cell, so the day carries a swatch and the detail lives in a sheet. */}
              <div className="bg-card rounded-xl border p-2 md:hidden">
                <div className="mb-1 grid grid-cols-7">
                  {DAY_HEADERS.map((d, i) => (
                    <div key={i} className="text-muted-foreground py-1 text-center text-[10px] font-semibold">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((date, i) => {
                    if (!date) return <div key={`empty-${i}`} className="aspect-square" />
                    const day = daysByDate.get(date)
                    const status = day?.status
                    const isFuture = date > today
                    const isWeekend = status === "weekend"
                    const isToday = date === today
                    const clickable = !isFuture && !isWeekend && day
                    const swatch = !isFuture && status && !isWeekend ? DOT_BG[status] : undefined

                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && setPeeked(day)}
                        className={cn(
                          "relative flex aspect-square flex-col items-center justify-center rounded-md border text-xs transition-colors",
                          isWeekend && "bg-muted/40 text-muted-foreground",
                          isFuture && "text-muted-foreground/40",
                          clickable && "hover:bg-muted/60 active:bg-muted",
                          isToday && "ring-primary ring-2"
                        )}
                      >
                        <span className={cn("font-medium", swatch && "mb-1")}>{Number(date.slice(8))}</span>
                        {swatch && <span className={cn("h-1.5 w-1.5 rounded-full", swatch)} />}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Desktop: the roomy grid, where the badge and times genuinely fit */}
              <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
                <div className="grid grid-cols-7 border-b">
                  {DAY_HEADERS_LONG.map((d) => (
                    <div key={d} className="text-muted-foreground py-2 text-center text-xs font-semibold">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {cells.map((date, i) => {
                    const isLastInRow = (i + 1) % 7 === 0
                    if (!date) {
                      return (
                        <div
                          key={`empty-${i}`}
                          className={cn("bg-muted/20 min-h-20 border-b p-1", !isLastInRow && "border-r")}
                        />
                      )
                    }
                    const day = daysByDate.get(date)
                    const status = day?.status
                    const isFuture = date > today
                    const isWeekend = status === "weekend"
                    const isToday = date === today
                    const bg = !isFuture && status && CELL_BG[status] ? CELL_BG[status] : ""
                    const clickable = !isFuture && !isWeekend && day

                    return (
                      <div
                        key={date}
                        onClick={() => clickable && setPeeked(day)}
                        className={cn(
                          "min-h-20 border-b p-1.5 text-xs transition-colors",
                          !isLastInRow && "border-r",
                          bg,
                          clickable && "cursor-pointer hover:brightness-95",
                          isToday && "ring-primary ring-2 ring-inset"
                        )}
                      >
                        <div className="text-muted-foreground mb-1 font-medium">{Number(date.slice(8))}</div>
                        {!isFuture && day && status && !isWeekend && (
                          <>
                            <Badge
                              className={cn(
                                "max-w-full truncate px-1 py-0 text-[10px] font-medium",
                                statusBadgeClass(status)
                              )}
                            >
                              {statusLabel(status)}
                            </Badge>
                            {day.record?.clock_in && (
                              <div className="text-muted-foreground mt-0.5 text-[10px] leading-tight">
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
            </>
          )}

          {/* Legend, collapsed and scoped to what this month contains */}
          {presentStatuses.length > 0 && (
            <div className="bg-card rounded-xl border">
              <button
                type="button"
                onClick={() => setLegendOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium"
              >
                <span className="text-muted-foreground">
                  Legend · {presentStatuses.length} {presentStatuses.length === 1 ? "status" : "statuses"} this month
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", legendOpen && "rotate-180")} />
              </button>
              {legendOpen && (
                <div className="flex flex-wrap gap-1.5 border-t px-3.5 py-3">
                  {presentStatuses.map((status) => (
                    <span key={status} className="inline-flex items-center gap-1.5 text-xs">
                      <span className={cn("h-2.5 w-2.5 rounded-full", DOT_BG[status] ?? "bg-gray-400")} />
                      <span className="text-muted-foreground">{statusLabel(status)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Day detail sheet — replaces tapping a 48px cell straight into an edit form */}
      <Sheet open={peeked !== null} onOpenChange={(open) => !open && setPeeked(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {peeked && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  {new Date(`${peeked.date}T00:00:00`).toLocaleDateString("en-US", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                  })}
                  <Badge className={cn("text-[10px]", statusBadgeClass(peeked.status))}>
                    {statusLabel(peeked.status)}
                  </Badge>
                </SheetTitle>
                <p className="text-muted-foreground text-sm">{selectedEmployee?.user_name}</p>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-2 px-4">
                <Tile
                  label="Clock in"
                  value={peeked.record?.clock_in ? formatTime(peeked.record.clock_in) : "—"}
                  tone="text-green-600"
                />
                <Tile
                  label="Clock out"
                  value={peeked.record?.clock_out ? formatTime(peeked.record.clock_out) : "—"}
                  tone="text-red-500"
                />
                <Tile
                  label="Total hours"
                  value={peeked.record?.total_hours != null ? `${peeked.record.total_hours.toFixed(1)}h` : "—"}
                />
                <Tile label="Source" value={peeked.record?.source ?? "—"} />
              </div>

              {peeked.record?.manual_comment && (
                <div className="px-4">
                  <div className="rounded-lg border p-2.5 text-xs">
                    <p className="text-muted-foreground mb-1">Manual comment</p>
                    <p className="whitespace-pre-wrap">{peeked.record.manual_comment}</p>
                  </div>
                </div>
              )}

              {peeked.status !== "on_leave" && (
                <SheetFooter>
                  <Button className="w-full gap-2" onClick={() => openEdit(peeked)}>
                    <Pencil className="h-4 w-4" />
                    {peeked.record ? "Edit record" : "Add record"}
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isCreating ? "Add Attendance Record" : "Edit Attendance Record"}</DialogTitle>
            <DialogDescription>
              {selectedEmployee?.user_name} — {editTarget?.date}
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
                    placeholder="Reason for this manual attendance change"
                    value={editForm.manual_comment}
                    onChange={(e) => setEditForm((f) => ({ ...f, manual_comment: e.target.value }))}
                  />
                </div>
              </>
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
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-2.5">
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
      <p className={cn("mt-0.5 truncate text-base font-semibold", tone)}>{value}</p>
    </div>
  )
}
