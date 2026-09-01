"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { toLocalISODate, isLate } from "@/lib/hr/attendance-utils"
import { type AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { ATTENDANCE_STATUS_LABELS, isEarlyDeparture, getManualStatusEditOptions } from "@/lib/hr/attendance-status"
import { StatusBadge, formatTime, labelSource } from "@/app/admin/hr/attendance/_components/status-badge"
import { getHourBreakdown, type AttendanceRecord } from "@/app/admin/hr/attendance/_components/daily-roster-view"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"

type SortKey = "user_name" | "clock_in" | "clock_out" | "work" | "missed" | "status"

/** Scopes the roster to the thing you are actually chasing on a given morning. */
type StatusScope = "all" | "early" | "present" | "late" | "incomplete" | "absent"

const PRESENT_STATUSES = ["early", "present", "late", "incomplete", "lateness_with_permission"]

/** Status as a colour swatch — the mobile table has no room for a badge, and a
 *  dot keeps the name column wide enough to actually read. */
const STATUS_DOT: Record<string, string> = {
  early: "bg-green-500",
  present: "bg-blue-500",
  late: "bg-yellow-500",
  lateness_with_permission: "bg-amber-500",
  incomplete_with_permission: "bg-cyan-400",
  incomplete: "bg-cyan-500",
  absent: "bg-red-500",
  absent_with_permission: "bg-rose-400",
  out_of_station: "bg-indigo-500",
  exempted: "bg-violet-500",
  waiver: "bg-blue-400",
  on_leave: "bg-purple-500",
  holiday: "bg-sky-400",
}

/** Status text colour, paired with the accent bar so the word carries the signal too. */
const STATUS_TEXT: Record<string, string> = {
  early: "text-green-600 dark:text-green-400",
  present: "text-blue-600 dark:text-blue-400",
  late: "text-yellow-600 dark:text-yellow-400",
  lateness_with_permission: "text-amber-600 dark:text-amber-400",
  incomplete_with_permission: "text-cyan-600 dark:text-cyan-400",
  incomplete: "text-cyan-600 dark:text-cyan-400",
  absent: "text-red-600 dark:text-red-400",
  absent_with_permission: "text-rose-600 dark:text-rose-400",
  out_of_station: "text-indigo-600 dark:text-indigo-400",
  exempted: "text-violet-600 dark:text-violet-400",
  waiver: "text-blue-600 dark:text-blue-400",
  on_leave: "text-purple-600 dark:text-purple-400",
  holiday: "text-sky-600 dark:text-sky-400",
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (name.slice(0, 2) || "??").toUpperCase()
}

function statusLabelOf(status: string): string {
  return ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status.replaceAll("_", " ")
}

const STATUS_OPTIONS = [
  { value: "early", label: "Early" },
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "lateness_with_permission", label: "LWP" },
  { value: "incomplete_with_permission", label: "IWP" },
  { value: "incomplete", label: "Incomplete" },
  { value: "absent", label: "Absent" },
  { value: "absent_with_permission", label: "AWP" },
  { value: "out_of_station", label: "OOS" },
  { value: "exempted", label: "Exempted" },
  { value: "waiver", label: "Waiver" },
  { value: "on_leave", label: "On Leave" },
  { value: "holiday", label: "Holiday" },
]

export function Roster2View({ departments, lockedDepartment }: { departments: string[]; lockedDepartment?: string }) {
  const [rosterDate, setRosterDate] = useState(toLocalISODate())
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [policy, setPolicy] = useState<AttendancePolicy>(DEFAULT_ATTENDANCE_POLICY)

  const [search, setSearch] = useState("")
  const [statusScope, setStatusScope] = useState<StatusScope>("all")
  const [selectedDept, setSelectedDept] = useState("all")
  const [selectedStatus, setSelectedStatus] = useState("all")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [peeked, setPeeked] = useState<AttendanceRecord | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "user_name",
    direction: "asc",
  })
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [editForm, setEditForm] = useState({ status: "", manual_comment: "" })
  const [saving, setSaving] = useState(false)

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

  const counts = useMemo(
    () => ({
      all: records.length,
      present: records.filter((r) => PRESENT_STATUSES.includes(r.status ?? "")).length,
      late: records.filter((r) => r.status === "late").length,
      incomplete: records.filter((r) => r.status === "incomplete").length,
      absent: records.filter((r) => r.status === "absent").length,
      early: records.filter((r) => r.status === "early").length,
    }),
    [records]
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (statusScope === "early" && r.status !== "early") return false
      if (statusScope === "present" && !PRESENT_STATUSES.includes(r.status ?? "")) return false
      if (statusScope === "late" && r.status !== "late") return false
      if (statusScope === "incomplete" && r.status !== "incomplete") return false
      if (statusScope === "absent" && r.status !== "absent") return false
      if (selectedDept !== "all" && r.department !== selectedDept) return false
      if (selectedStatus !== "all" && r.status !== selectedStatus) return false
      if (!q) return true
      return [r.user_name, r.department].join(" ").toLowerCase().includes(q)
    })
  }, [records, statusScope, selectedDept, selectedStatus, search])

  const sortedRows = useMemo(() => {
    const accessor = (r: AttendanceRecord): string | number => {
      switch (sort.key) {
        case "user_name":
          return r.user_name.toLowerCase()
        case "clock_in":
          return r.clock_in ?? "~"
        case "clock_out":
          return r.clock_out ?? "~"
        case "work":
          return getHourBreakdown(r, policy).work ?? -1
        case "missed":
          return getHourBreakdown(r, policy).missed ?? -1
        case "status":
          return r.status ?? ""
      }
    }
    const sorted = [...filteredRows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (typeof av === "number" && typeof bv === "number") return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sort.direction === "asc" ? sorted : sorted.reverse()
  }, [filteredRows, sort, policy])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pagedRows = useMemo(() => sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedRows, page])

  useEffect(() => {
    setPage(0)
  }, [search, selectedDept, selectedStatus, statusScope, rosterDate])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    )
  }

  const todayIso = toLocalISODate()
  const shiftDate = (deltaDays: number) => {
    setRosterDate((prev) => {
      const d = new Date(`${prev}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + deltaDays)
      const next = toLocalISODate(d)
      return next > todayIso ? prev : next
    })
  }

  const dateLabel = new Date(`${rosterDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

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

    setPeeked(null)
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
        res = await apiFetch(`/api/admin/hr/attendance/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: editRecord.user_id,
            date: editRecord.date,
            waived: false,
            manual_comment: editForm.manual_comment,
            status: editForm.status,
            clock_in: null,
            clock_out: null,
          }),
        })
      } else {
        res = await apiFetch(`/api/admin/hr/attendance/records/${editRecord.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            waived: false,
            manual_comment: editForm.manual_comment,
            status: editForm.status,
          }),
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

  const { isOnTimePresent, options: statusEditOptions } = getManualStatusEditOptions(editRecord)
  const hasManualComment = editForm.manual_comment.trim().length >= 3
  const cannotSave = saving || !editForm.status || !hasManualComment || isOnTimePresent

  const activeFilterCount = (selectedDept !== "all" ? 1 : 0) + (selectedStatus !== "all" ? 1 : 0)

  const scopeTabs: { key: StatusScope; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "early", label: "Early", count: counts.early },
    { key: "present", label: "Present", count: counts.present },
    { key: "late", label: "Late", count: counts.late },
    { key: "incomplete", label: "Incomplete", count: counts.incomplete },
    { key: "absent", label: "Absent", count: counts.absent },
  ]

  return (
    <div className="space-y-4">
      {/* Date navigator — the roster's primary control, so it gets real touch targets */}
      <div className="bg-card flex items-center gap-2 rounded-xl border p-2">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => shiftDate(-1)}
          title="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* One date, centred, tappable. The native input sits invisibly on top so the
            whole label opens the picker — rendering it inline showed the date twice
            and could not be centred. */}
        <label className="hover:bg-muted/50 relative min-w-0 flex-1 cursor-pointer rounded-lg py-1.5 text-center transition-colors">
          <span className="truncate text-sm font-semibold">{dateLabel}</span>
          {rosterDate !== todayIso && (
            <span className="text-muted-foreground mt-0.5 block text-[11px]">Tap to change</span>
          )}
          <input
            type="date"
            value={rosterDate}
            max={todayIso}
            onChange={(e) => e.target.value && setRosterDate(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Roster date"
          />
        </label>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => shiftDate(1)}
          disabled={rosterDate >= todayIso}
          title="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Status scope pills with counts */}
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {scopeTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusScope(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              statusScope === tab.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-bold",
                statusScope === tab.key ? "bg-white/20" : "bg-muted"
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Sticky search + one filter trigger */}
      <div className="bg-background sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b px-4 py-2 shadow-sm sm:static sm:mx-0 sm:border-b-0 sm:px-0 sm:py-0 sm:shadow-none">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search employee or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card h-10 border-2 pr-9 pl-10 shadow-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter roster</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              {!lockedDepartment && departments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-medium">Department</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterPill active={selectedDept === "all"} onClick={() => setSelectedDept("all")} label="All" />
                    {departments.map((d) => (
                      <FilterPill key={d} active={selectedDept === d} onClick={() => setSelectedDept(d)} label={d} />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Exact status</p>
                <div className="flex flex-wrap gap-1.5">
                  <FilterPill active={selectedStatus === "all"} onClick={() => setSelectedStatus("all")} label="Any" />
                  {STATUS_OPTIONS.map((opt) => (
                    <FilterPill
                      key={opt.value}
                      active={selectedStatus === opt.value}
                      onClick={() => setSelectedStatus(opt.value)}
                      label={opt.label}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Sort by</p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: "user_name", label: "Name" },
                      { key: "clock_in", label: "Clock in" },
                      { key: "missed", label: "Most missed" },
                      { key: "status", label: "Status" },
                    ] as { key: SortKey; label: string }[]
                  ).map((opt) => (
                    <FilterPill
                      key={opt.key}
                      active={sort.key === opt.key}
                      onClick={() => setSort({ key: opt.key, direction: opt.key === "missed" ? "desc" : "asc" })}
                      label={opt.label}
                    />
                  ))}
                </div>
              </div>
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSelectedDept("all")
                  setSelectedStatus("all")
                  setSort({ key: "user_name", direction: "asc" })
                }}
              >
                Reset
              </Button>
              <SheetClose asChild>
                <Button className="flex-1">Apply</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <p className="text-muted-foreground -mt-1 text-xs">
        {sortedRows.length} of {counts.all} shown
      </p>

      {/* Mobile: a list row with a fixed internal grid — the pattern every workforce
          app (Deputy, Homebase, Jibble) uses. Every row shares the same structure, so
          the clock-in times still line up down the page for scanning, without the
          spreadsheet chrome of a real table. */}
      <div className="md:hidden">
        {loading ? (
          <ListSkeleton />
        ) : sortedRows.length === 0 ? (
          <EmptyRoster />
        ) : (
          <div className="bg-card overflow-hidden rounded-xl border">
            <div className="divide-y">
              {sortedRows.map((r) => {
                const { missed } = getHourBreakdown(r, policy)
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setPeeked(r)}
                    className="hover:bg-muted/40 active:bg-muted relative flex w-full items-center gap-3 py-2.5 pr-3.5 pl-3 text-left transition-colors"
                  >
                    {/* Status as a left accent — readable at a glance, costs no width */}
                    <span
                      className={cn(
                        "absolute inset-y-1 left-0 w-1 rounded-r",
                        STATUS_DOT[r.status] ?? "bg-muted-foreground/30"
                      )}
                    />

                    <span className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                      {initialsOf(r.user_name)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.user_name}</span>
                      <span className="flex items-center gap-1 text-xs">
                        <span className={cn("shrink-0 font-medium", STATUS_TEXT[r.status])}>
                          {statusLabelOf(r.status)}
                        </span>
                        {r.department && (
                          <span className="text-muted-foreground min-w-0 truncate">· {r.department}</span>
                        )}
                        {missed != null && missed > 0 && (
                          <span className="shrink-0 font-medium text-orange-500">· −{missed.toFixed(1)}h</span>
                        )}
                      </span>
                    </span>

                    {/* Fixed-width slot keeps every time on the same x-position */}
                    <span className="w-14 shrink-0 text-right">
                      <span className="block text-sm tabular-nums">
                        {r.clock_in ? formatTime(r.clock_in) : <span className="text-muted-foreground/40">—</span>}
                      </span>
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        {r.clock_out ? formatTime(r.clock_out) : "—"}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: dense sortable table with S/N and pagination */}
      <div className="hidden md:block">
        {loading ? (
          <div className="bg-card space-y-2 rounded-xl border p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-muted h-8 w-full animate-pulse rounded" />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <EmptyRoster />
        ) : (
          <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wide uppercase">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center">S/N</th>
                    <SortableHeader label="Employee" sortKey="user_name" current={sort} onSort={toggleSort} />
                    <SortableHeader label="Clock In" sortKey="clock_in" current={sort} onSort={toggleSort} center />
                    <SortableHeader label="Clock Out" sortKey="clock_out" current={sort} onSort={toggleSort} center />
                    <SortableHeader label="Work" sortKey="work" current={sort} onSort={toggleSort} center />
                    <SortableHeader label="Missed" sortKey="missed" current={sort} onSort={toggleSort} center />
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center">Overtime</th>
                    <SortableHeader label="Status" sortKey="status" current={sort} onSort={toggleSort} />
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedRows.map((r, index) => {
                    const { total, work, missed, overtime } = getHourBreakdown(r, policy)
                    return (
                      <tr key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setPeeked(r)}>
                        <td className="text-muted-foreground px-4 py-3 text-center font-mono">
                          {page * PAGE_SIZE + index + 1}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.user_name}</p>
                          <p className="text-muted-foreground text-[11px]">{r.department}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.clock_in ? formatTime(r.clock_in) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.clock_out ? formatTime(r.clock_out) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">{work != null ? `${work.toFixed(1)}h` : "—"}</td>
                        <td className="px-4 py-3 text-center">
                          {missed == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : missed > 0 ? (
                            <span className="text-orange-500">{missed.toFixed(1)}h</span>
                          ) : (
                            <span className="text-muted-foreground">0.0h</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">{total != null ? `${total.toFixed(1)}h` : "—"}</td>
                        <td className="px-4 py-3 text-center">
                          {overtime != null && overtime >= 0.05 ? (
                            <span className="font-medium text-orange-600 dark:text-orange-400">
                              +{overtime.toFixed(1)}h
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            status={r.status}
                            record={r}
                            earlyClosure={r.early_closure_time ? { closeTime: r.early_closure_time } : null}
                          />
                        </td>
                        <td className="text-muted-foreground px-4 py-3">{labelSource(r)}</td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-4 border-t px-4 py-3 text-sm">
                <p className="text-muted-foreground">
                  Showing{" "}
                  <span className="text-foreground font-medium">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedRows.length)}
                  </span>{" "}
                  of <span className="text-foreground font-medium">{sortedRows.length}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-record detail sheet */}
      <Sheet open={peeked !== null} onOpenChange={(open) => !open && setPeeked(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {peeked && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {peeked.user_name}
                  <StatusBadge
                    status={peeked.status}
                    record={peeked}
                    earlyClosure={peeked.early_closure_time ? { closeTime: peeked.early_closure_time } : null}
                  />
                </SheetTitle>
                <p className="text-muted-foreground text-sm">
                  {peeked.department} · {dateLabel}
                </p>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3">
                <Tile
                  label="Clock in"
                  value={peeked.clock_in ? formatTime(peeked.clock_in) : "—"}
                  tone="text-green-600"
                />
                <Tile
                  label="Clock out"
                  value={peeked.clock_out ? formatTime(peeked.clock_out) : "—"}
                  tone="text-red-500"
                />
                {(() => {
                  const { total, work, missed, overtime } = getHourBreakdown(peeked, policy)
                  return (
                    <>
                      <Tile
                        label="Work hours"
                        value={work != null ? `${work.toFixed(1)}h` : "—"}
                        tone="text-emerald-600"
                      />
                      <Tile
                        label="Missed"
                        value={missed != null ? `${missed.toFixed(1)}h` : "—"}
                        tone="text-orange-500"
                      />
                      <Tile label="Total clocked" value={total != null ? `${total.toFixed(1)}h` : "—"} />
                      <Tile
                        label="Overtime"
                        value={overtime != null && overtime >= 0.05 ? `+${overtime.toFixed(1)}h` : "—"}
                        tone="text-orange-600"
                      />
                    </>
                  )
                })()}
              </div>

              <div className="space-y-2 px-4">
                <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-medium">{labelSource(peeked)}</span>
                </div>
                {peeked.manual_comment && (
                  <div className="rounded-lg border p-2.5 text-xs">
                    <p className="text-muted-foreground mb-1">Manual comment</p>
                    <p className="whitespace-pre-wrap">{peeked.manual_comment}</p>
                  </div>
                )}
              </div>

              <SheetFooter>
                <Button className="w-full gap-2" onClick={() => openEdit(peeked)}>
                  <Pencil className="h-4 w-4" />
                  {peeked.id.startsWith("missing-") ? "Add record" : "Edit record"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

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
                      {statusEditOptions.map((option) => (
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
    </div>
  )
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
      )}
    >
      {label}
    </button>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-2.5">
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
      <p className={cn("mt-0.5 text-base font-semibold", tone)}>{value}</p>
    </div>
  )
}

function SortableHeader({
  label,
  sortKey,
  current,
  onSort,
  center,
}: {
  label: string
  sortKey: SortKey
  current: { key: SortKey; direction: "asc" | "desc" }
  onSort: (key: SortKey) => void
  center?: boolean
}) {
  const isActive = current.key === sortKey
  return (
    <th className={cn("px-4 py-3", center && "text-center")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        {label}
        {isActive ? (
          current.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse space-y-1.5 px-1 py-3">
          <div className="bg-muted h-3.5 w-36 rounded" />
          <div className="bg-muted h-3 w-24 rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyRoster() {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
      <FileText className="text-muted-foreground/50 h-10 w-10" />
      <h3 className="mt-3 text-sm font-semibold">No records for this date</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-xs">No attendance records found for the selected date.</p>
    </div>
  )
}
