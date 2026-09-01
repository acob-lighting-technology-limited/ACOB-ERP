"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChevronRight,
  Clock,
  Download,
  Mail,
  MoreVertical,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader, PageWrapper } from "@/components/layout"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Roster2View } from "./_components/roster2-view"
import type { EmployeeOption } from "@/app/admin/hr/attendance/_components/calendar-view"
import { Calendar2View } from "./_components/calendar2-view"
import { Appeals2View } from "./_components/appeals2-view"
import { Leaderboard2View } from "./_components/leaderboard2-view"
import { AttendanceManagerDialog } from "@/app/admin/hr/attendance/_components/attendance-manager-dialog"
import { AttendanceReportDialog } from "@/app/admin/hr/attendance/_components/attendance-report-dialog"
import { AttendanceExportDialog } from "@/app/admin/hr/attendance/_components/attendance-export-dialog"
import { EmployeeExpandPanel, type AttendanceReport } from "@/app/admin/hr/attendance/view"
import { ATTENDANCE_TRACKING_START, monthBounds, quarterBounds } from "@/lib/hr/attendance-utils"
import { type AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { apiFetch } from "@/lib/api-client"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"

const log = logger("hr-attendance2")

type AttendanceTab = "daily" | "summary" | "leaderboard" | "calendar" | "appeals"

const ATTENDANCE_TABS: { key: AttendanceTab; label: string }[] = [
  { key: "daily", label: "Daily Roster" },
  { key: "summary", label: "Summary" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "calendar", label: "Calendar" },
  { key: "appeals", label: "Appeals" },
]

type SortKey = "name" | "department" | "early" | "present" | "absent" | "incomplete" | "permission" | "hours" | "missed"

const SORT_ACCESSORS: Record<SortKey, (r: AttendanceReport) => string | number> = {
  name: (r) => r.user_name.toLowerCase(),
  department: (r) => (r.department || "").toLowerCase(),
  early: (r) => r.early_days ?? 0,
  present: (r) => r.present_days ?? 0,
  absent: (r) => r.absent_days ?? 0,
  incomplete: (r) => r.incomplete_days ?? 0,
  permission: (r) => permissionDays(r),
  hours: (r) => r.total_hours ?? 0,
  missed: (r) => r.total_missed_hours ?? 0,
}

function permissionDays(r: AttendanceReport): number {
  return (
    (r.lateness_with_permission_days ?? 0) +
    (r.incomplete_with_permission_days ?? 0) +
    (r.absent_with_permission_days ?? 0)
  )
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export function Attendance2View({
  backLinkHref,
  lockedDepartment,
}: { backLinkHref?: string; lockedDepartment?: string } = {}) {
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState<AttendanceTab>(
    ATTENDANCE_TABS.some((t) => t.key === requestedTab) ? (requestedTab as AttendanceTab) : "summary"
  )

  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<AttendanceReport[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [policy, setPolicy] = useState<AttendancePolicy>(DEFAULT_ATTENDANCE_POLICY)
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name?: string | null }>>([])

  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [periodMode, setPeriodMode] = useState<"month" | "quarter">("month")
  const [quarter, setQuarter] = useState<"Q1" | "Q2" | "Q3" | "Q4">("Q1")
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear())
  const reportDepartment = lockedDepartment || "all"

  const [search, setSearch] = useState("")
  const [selectedDept, setSelectedDept] = useState("all")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [peeked, setPeeked] = useState<AttendanceReport | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "name", direction: "asc" })

  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const [isExportOpen, setIsExportOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)

  const refreshSingleEmployeeSummary = useCallback(
    async (userId: string) => {
      try {
        const { start, end } = periodMode === "month" ? monthBounds(yearMonth) : quarterBounds(quarterYear, quarter)
        const params = new URLSearchParams({
          start_date: start,
          end_date: end,
          department: reportDepartment,
          user_id: userId,
        })
        const response = await apiFetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
        const payload = (await response.json().catch(() => null)) as {
          data?: AttendanceReport[]
          error?: string
        } | null
        if (!response.ok) throw new Error(payload?.error ?? "Failed to refresh employee summary")
        const row = payload?.data?.[0]
        if (!row) return

        const activePeriodLabel = periodMode === "month" ? yearMonth : `${quarter} ${quarterYear}`
        const activeCycleLabel = periodMode === "month" ? "Monthly" : "Quarterly"
        setReports((prev) =>
          prev.map((r) =>
            r.user_id === userId ? { ...row, period_label: activePeriodLabel, cycle_label: activeCycleLabel } : r
          )
        )
      } catch (error) {
        log.error("Failed to refresh single employee summary:", error)
      }
    },
    [periodMode, quarter, quarterYear, reportDepartment, yearMonth]
  )

  const generateReport = useCallback(async () => {
    setLoading(true)
    try {
      const { start, end } = periodMode === "month" ? monthBounds(yearMonth) : quarterBounds(quarterYear, quarter)
      const params = new URLSearchParams({ start_date: start, end_date: end, department: reportDepartment })
      const response = await apiFetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as {
        data?: AttendanceReport[]
        departments?: string[]
        policy?: AttendancePolicy
        error?: string
      } | null
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load attendance report")

      const activePeriodLabel = periodMode === "month" ? yearMonth : `${quarter} ${quarterYear}`
      const activeCycleLabel = periodMode === "month" ? "Monthly" : "Quarterly"
      setReports(
        (payload?.data ?? []).map((row) => ({
          ...row,
          period_label: activePeriodLabel,
          cycle_label: activeCycleLabel,
        }))
      )
      setDepartments(lockedDepartment ? [lockedDepartment] : (payload?.departments ?? []))
      if (payload?.policy) setPolicy({ ...DEFAULT_ATTENDANCE_POLICY, ...payload.policy })
    } catch (error) {
      log.error("Error generating report:", error)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [yearMonth, reportDepartment, periodMode, quarter, quarterYear, lockedDepartment])

  const loadHolidays = useCallback(async () => {
    const response = await apiFetch(`/api/admin/hr/attendance/holidays?month=${yearMonth}`, { cache: "no-store" })
    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ holiday_date: string; name?: string | null }>
    } | null
    if (response.ok) setHolidays(payload?.data ?? [])
  }, [yearMonth])

  useEffect(() => {
    void generateReport()
  }, [generateReport])

  useEffect(() => {
    void loadHolidays()
  }, [loadHolidays])

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    const now = new Date()
    const [trackingStartYear, trackingStartMonth] = ATTENDANCE_TRACKING_START.split("-").map(Number)
    let y = now.getFullYear()
    let m = now.getMonth()

    while (y > trackingStartYear || (y === trackingStartYear && m >= trackingStartMonth - 1)) {
      const d = new Date(y, m, 1)
      options.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      })
      m--
      if (m < 0) {
        m = 11
        y--
      }
    }
    return options
  }, [])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter((r) => {
      if (selectedDept !== "all" && r.department !== selectedDept) return false
      if (!q) return true
      return [r.user_name, r.department, r.employee_no].filter(Boolean).join(" ").toLowerCase().includes(q)
    })
  }, [reports, search, selectedDept])

  const sortedRows = useMemo(() => {
    const accessor = SORT_ACCESSORS[sort.key]
    const sorted = [...filteredRows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (typeof av === "number" && typeof bv === "number") return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sort.direction === "asc" ? sorted : sorted.reverse()
  }, [filteredRows, sort])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pagedRows = useMemo(() => sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedRows, page])

  useEffect(() => {
    setPage(0)
  }, [search, selectedDept, yearMonth, periodMode, quarter, quarterYear])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    )
  }

  const stats = useMemo(() => {
    const totalHours = filteredRows.reduce((a, r) => a + (r.total_hours ?? 0), 0)
    const totalMissed = filteredRows.reduce((a, r) => a + (r.total_missed_hours ?? 0), 0)
    const totalAbsent = filteredRows.reduce((a, r) => a + (r.absent_days ?? 0), 0)
    return {
      employees: filteredRows.length,
      totalHours: Math.round(totalHours * 10) / 10,
      totalMissed: Math.round(totalMissed * 10) / 10,
      totalAbsent,
    }
  }, [filteredRows])

  const employeeOptions = useMemo<EmployeeOption[]>(
    () =>
      reports.map((r) => ({
        user_id: r.user_id,
        user_name: r.user_name,
        department: r.department,
        attendance_exempt: r.attendance_exempt,
      })),
    [reports]
  )

  const activeFilterCount = (selectedDept !== "all" ? 1 : 0) + (periodMode !== "month" ? 1 : 0)
  const periodLabel =
    periodMode === "month"
      ? (monthOptions.find((m) => m.value === yearMonth)?.label ?? yearMonth)
      : `${quarter} ${quarterYear}`

  const isSummary = activeTab === "summary"

  return (
    <PageWrapper maxWidth="full" background="gradient" spacing="compact" className="pb-12">
      <div className="flex flex-row items-end justify-between gap-3 sm:items-center">
        <PageHeader
          title="Attendance"
          icon={BarChart3}
          backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
          className="mb-0 min-w-0 pb-0"
        />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExportOpen(true)}
            disabled={reports.length === 0}
            className="h-9 gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" title="More actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setReportDialogOpen(true)}>
                <Mail className="mr-2 h-4 w-4" />
                Reports
              </DropdownMenuItem>
              {!lockedDepartment && (
                <DropdownMenuItem onClick={() => setManagerOpen(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  Attendance Manager
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs as a scrollable pill row — five tabs never fit a phone as a segmented bar */}
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {ATTENDANCE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isSummary && (
        <>
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
                  <SheetTitle>Period &amp; filters</SheetTitle>
                </SheetHeader>
                <div className="space-y-5 px-4 pb-4">
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs font-medium">Cycle</p>
                    <div className="flex gap-1.5">
                      {(["month", "quarter"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPeriodMode(mode)}
                          className={cn(
                            "flex-1 rounded-lg border py-2 text-xs font-medium capitalize transition-colors",
                            periodMode === mode
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {mode === "month" ? "Monthly" : "Quarterly"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {periodMode === "month" ? (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-medium">Month</p>
                      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                        {monthOptions.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setYearMonth(m.value)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs",
                              yearMonth === m.value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <p className="text-muted-foreground text-xs font-medium">Quarter</p>
                        <div className="flex gap-1.5">
                          {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => setQuarter(q)}
                              className={cn(
                                "flex-1 rounded-lg border py-2 text-xs font-medium transition-colors",
                                quarter === q
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "text-muted-foreground"
                              )}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-muted-foreground text-xs font-medium">Year</p>
                        <div className="flex flex-wrap gap-1.5">
                          {[0, 1, 2].map((offset) => {
                            const y = new Date().getFullYear() - offset
                            return (
                              <button
                                key={y}
                                type="button"
                                onClick={() => setQuarterYear(y)}
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs",
                                  quarterYear === y
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "text-muted-foreground"
                                )}
                              >
                                {y}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}

                  {!lockedDepartment && departments.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-medium">Department</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedDept("all")}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs",
                            selectedDept === "all"
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          All
                        </button>
                        {departments.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setSelectedDept(d)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs",
                              selectedDept === d
                                ? "border-primary bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Attendance is ranked data, so mobile needs a sort control — unlike a contacts list. */}
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs font-medium">Sort by</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { key: "name", label: "Name" },
                          { key: "absent", label: "Most absent" },
                          { key: "missed", label: "Most hours missed" },
                          { key: "hours", label: "Most hours worked" },
                          { key: "present", label: "Most present" },
                        ] as { key: SortKey; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setSort({ key: opt.key, direction: opt.key === "name" ? "asc" : "desc" })}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs",
                            sort.key === opt.key
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {opt.label}
                        </button>
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
                      setPeriodMode("month")
                      setYearMonth(currentYearMonth())
                      setSort({ key: "name", direction: "asc" })
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

          {/* Separate stat badges, including the period being viewed */}
          <div className="-mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
              {periodLabel}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
              {stats.employees} {stats.employees === 1 ? "employee" : "employees"}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
              {stats.totalHours.toLocaleString()} hrs worked
            </Badge>
            {stats.totalMissed > 0 && (
              <Badge variant="outline" className="rounded-full px-2.5 py-1 text-xs font-normal text-amber-600">
                {stats.totalMissed.toLocaleString()} hrs missed
              </Badge>
            )}
            {stats.totalAbsent > 0 && (
              <Badge variant="outline" className="rounded-full px-2.5 py-1 text-xs font-normal text-rose-600">
                {stats.totalAbsent} absent days
              </Badge>
            )}
          </div>

          {/* Mobile: one row per employee with the numbers that matter, tap for the full breakdown */}
          <div className="md:hidden">
            {loading ? (
              <ListSkeleton />
            ) : sortedRows.length === 0 ? (
              <EmptyState loading={loading} />
            ) : (
              <div className="divide-y">
                {sortedRows.map((r) => (
                  <button
                    key={r.user_id}
                    type="button"
                    onClick={() => setPeeked(r)}
                    className="hover:bg-muted/40 flex w-full items-center gap-3 px-1 py-3 text-left transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{r.user_name}</span>
                        {r.attendance_exempt && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Exempt
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground truncate text-xs">{r.department}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="text-emerald-600 dark:text-emerald-400">{r.present_days} present</span>
                        <span className="text-rose-600 dark:text-rose-400">{r.absent_days} absent</span>
                        <span className="text-muted-foreground">{(r.total_hours ?? 0).toFixed(1)}h</span>
                        {(r.total_missed_hours ?? 0) > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">
                            −{(r.total_missed_hours ?? 0).toFixed(1)}h
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground/50 h-4 w-4 shrink-0" />
                  </button>
                ))}
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
              <EmptyState loading={loading} />
            ) : (
              <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wide uppercase">
                      <tr>
                        <th className="w-12 px-4 py-3 text-center">S/N</th>
                        <SortableHeader label="Employee" sortKey="name" current={sort} onSort={toggleSort} />
                        <SortableHeader label="Early" sortKey="early" current={sort} onSort={toggleSort} center />
                        <SortableHeader label="Present" sortKey="present" current={sort} onSort={toggleSort} center />
                        <SortableHeader label="Absent" sortKey="absent" current={sort} onSort={toggleSort} center />
                        <SortableHeader
                          label="Incomplete"
                          sortKey="incomplete"
                          current={sort}
                          onSort={toggleSort}
                          center
                        />
                        <SortableHeader
                          label="LWP/IWP/AWP"
                          sortKey="permission"
                          current={sort}
                          onSort={toggleSort}
                          center
                        />
                        <SortableHeader label="Hours" sortKey="hours" current={sort} onSort={toggleSort} center />
                        <SortableHeader label="Hrs Missed" sortKey="missed" current={sort} onSort={toggleSort} center />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pagedRows.map((r, index) => (
                        <tr key={r.user_id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setPeeked(r)}>
                          <td className="text-muted-foreground px-4 py-3 text-center font-mono">
                            {page * PAGE_SIZE + index + 1}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{r.user_name}</span>
                              {r.attendance_exempt && (
                                <Badge variant="outline" className="text-[9px]">
                                  Exempt
                                </Badge>
                              )}
                            </div>
                            <p className="text-muted-foreground text-[11px]">{r.department}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-green-600">{r.early_days ?? 0}</td>
                          <td className="px-4 py-3 text-center text-blue-600">{r.present_days}</td>
                          <td className="px-4 py-3 text-center text-red-600">{r.absent_days}</td>
                          <td className="px-4 py-3 text-center text-cyan-600">{r.incomplete_days ?? 0}</td>
                          <td className="px-4 py-3 text-center text-amber-600">{permissionDays(r)}</td>
                          <td className="px-4 py-3 text-center">{(r.total_hours ?? 0).toFixed(1)}</td>
                          <td className="px-4 py-3 text-center">
                            {(r.total_missed_hours ?? 0) > 0 ? (
                              <span className="text-orange-500">{(r.total_missed_hours ?? 0).toFixed(1)}h</span>
                            ) : (
                              <span className="text-muted-foreground">0h</span>
                            )}
                          </td>
                        </tr>
                      ))}
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
        </>
      )}

      {activeTab === "daily" && <Roster2View departments={departments} lockedDepartment={lockedDepartment} />}
      {activeTab === "leaderboard" && (
        <Leaderboard2View departments={departments} lockedDepartment={lockedDepartment} />
      )}
      {activeTab === "calendar" && <Calendar2View employees={employeeOptions} />}
      {activeTab === "appeals" && <Appeals2View lockedDepartment={lockedDepartment} />}

      {/* Per-employee breakdown, with the same day-level panel the original table expands to */}
      <Sheet open={peeked !== null} onOpenChange={(open) => !open && setPeeked(null)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          {peeked && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {peeked.user_name}
                  {peeked.attendance_exempt && (
                    <Badge variant="outline" className="text-[10px]">
                      Exempt
                    </Badge>
                  )}
                </SheetTitle>
                <p className="text-muted-foreground text-sm">
                  {peeked.department} · {periodLabel}
                </p>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4">
                <MetricTile label="Early" value={peeked.early_days ?? 0} tone="text-green-600" />
                <MetricTile label="Present" value={peeked.present_days} tone="text-blue-600" />
                <MetricTile label="Absent" value={peeked.absent_days} tone="text-red-600" />
                <MetricTile label="Incomplete" value={peeked.incomplete_days ?? 0} tone="text-cyan-600" />
                <MetricTile label="Late" value={peeked.late_days ?? 0} tone="text-orange-600" />
                <MetricTile label="LWP/IWP/AWP" value={permissionDays(peeked)} tone="text-amber-600" />
                <MetricTile label="Leave" value={peeked.leave_days ?? 0} tone="text-violet-600" />
                <MetricTile label="Holidays" value={peeked.holiday_days ?? 0} tone="text-muted-foreground" />
                <MetricTile
                  label="Hours worked"
                  value={`${(peeked.total_hours ?? 0).toFixed(1)}h`}
                  tone="text-emerald-600"
                />
                <MetricTile
                  label="Hours missed"
                  value={`${(peeked.total_missed_hours ?? 0).toFixed(1)}h`}
                  tone="text-amber-600"
                />
                <MetricTile
                  label="Attendance rate"
                  value={`${Math.round(peeked.attendance_rate ?? 0)}%`}
                  tone="text-foreground"
                />
                <MetricTile label="Out of station" value={peeked.out_of_station_days ?? 0} tone="text-sky-600" />
              </div>

              <div className="px-4 pb-4">
                <EmployeeExpandPanel
                  report={peeked}
                  yearMonth={yearMonth}
                  policy={policy}
                  onRecordChanged={refreshSingleEmployeeSummary}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AttendanceExportDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        department={lockedDepartment}
        monthOptions={monthOptions}
      />

      {!lockedDepartment && (
        <AttendanceManagerDialog
          open={managerOpen}
          onOpenChange={setManagerOpen}
          reports={reports}
          yearMonth={yearMonth}
          holidays={holidays}
          onHolidaysChanged={() => {
            void loadHolidays()
            void generateReport()
          }}
          onReportChanged={() => void generateReport()}
        />
      )}

      <AttendanceReportDialog open={reportDialogOpen} onOpenChange={setReportDialogOpen} />
    </PageWrapper>
  )
}

// ── Building blocks ─────────────────────────────────────────────────────────

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

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-2.5">
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
      <p className={cn("mt-0.5 text-base font-semibold", tone)}>{value}</p>
    </div>
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

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
      {loading ? (
        <Clock className="text-muted-foreground/50 h-10 w-10" />
      ) : (
        <AlertCircle className="text-muted-foreground/50 h-10 w-10" />
      )}
      <h3 className="mt-3 text-sm font-semibold">{loading ? "Loading attendance report…" : "No attendance report"}</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-xs">No attendance results available for this period.</p>
    </div>
  )
}
