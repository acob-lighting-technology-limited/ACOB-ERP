"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import {
  AlertCircle,
  Building2,
  Clock,
  FileWarning,
  SlidersHorizontal,
  Sunrise,
  Sunset,
  Timer,
  Trophy,
  UserX,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  ATTENDANCE_TRACKING_START,
  monthBounds,
  quarterBounds,
  toLocalISODate,
  toLocalYearMonth,
  type Quarter,
} from "@/lib/hr/attendance-utils"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"

const log = logger("hr-attendance2-leaderboard")

interface LeaderboardReport {
  user_id: string
  user_name: string
  department: string
  attendance_rate: number
  total_hours: number
  overtime_hours?: number
  absent_days: number
  incomplete_days?: number
  avg_clock_in_minutes?: number | null
  avg_clock_out_minutes?: number | null
  appeal_count?: number
}

interface DepartmentStat {
  department: string
  employee_count: number
  avg_attendance_rate: number
  avg_clock_in_minutes: number | null
  avg_clock_out_minutes: number | null
  total_hours: number
  avg_total_hours?: number
  overtime_hours?: number
  avg_overtime_hours?: number
  absent_days?: number
  avg_absent_days?: number
  incomplete_days?: number
  avg_incomplete_days?: number
  appeal_count?: number
  avg_appeal_count?: number
}

function formatMinutesAsTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

type Metric = {
  key: string
  title: string
  shortTitle: string
  description: string
  icon: ComponentType<{ className?: string }>
  iconColor: string
  getValue: (r: LeaderboardReport) => number | null
  formatValue: (v: number) => string
  sort: "asc" | "desc"
  excludeZero?: boolean
}

const METRICS: Metric[] = [
  {
    key: "avg_clock_in",
    title: "Avg Clock In",
    shortTitle: "Clock in",
    description: "Lowest average clock-in time",
    icon: Sunrise,
    iconColor: "text-amber-500",
    getValue: (r) => r.avg_clock_in_minutes ?? null,
    formatValue: formatMinutesAsTime,
    sort: "asc",
  },
  {
    key: "avg_clock_out",
    title: "Avg Clock Out",
    shortTitle: "Clock out",
    description: "Highest average clock-out time",
    icon: Sunset,
    iconColor: "text-purple-500",
    getValue: (r) => r.avg_clock_out_minutes ?? null,
    formatValue: formatMinutesAsTime,
    sort: "desc",
  },
  {
    key: "total_hours",
    title: "Most Time in Office",
    shortTitle: "Hours",
    description: "Highest total hours logged",
    icon: Clock,
    iconColor: "text-blue-500",
    getValue: (r) => r.total_hours,
    formatValue: (v) => `${v.toFixed(1)}h`,
    sort: "desc",
  },
  {
    key: "overtime_hours",
    title: "Most Overtime",
    shortTitle: "Overtime",
    description: "Hours worked past close of business",
    icon: Timer,
    iconColor: "text-purple-500",
    getValue: (r) => r.overtime_hours ?? 0,
    formatValue: (v) => `${v.toFixed(1)}h`,
    sort: "desc",
    excludeZero: true,
  },
  {
    key: "absent_days",
    title: "Most Absences",
    shortTitle: "Absences",
    description: "Highest count of unexplained absences",
    icon: UserX,
    iconColor: "text-red-500",
    getValue: (r) => r.absent_days,
    formatValue: (v) => `${v} day${v === 1 ? "" : "s"}`,
    sort: "desc",
    excludeZero: true,
  },
  {
    key: "incomplete_days",
    title: "Most Incomplete Records",
    shortTitle: "Incomplete",
    description: "Highest count of missing clock-outs",
    icon: AlertCircle,
    iconColor: "text-cyan-500",
    getValue: (r) => r.incomplete_days ?? 0,
    formatValue: (v) => `${v} day${v === 1 ? "" : "s"}`,
    sort: "desc",
    excludeZero: true,
  },
  {
    key: "appeal_count",
    title: "Most Appeals Filed",
    shortTitle: "Appeals",
    description: "Highest count of attendance appeals submitted",
    icon: FileWarning,
    iconColor: "text-rose-500",
    getValue: (r) => r.appeal_count ?? 0,
    formatValue: (v) => `${v} appeal${v === 1 ? "" : "s"}`,
    sort: "desc",
    excludeZero: true,
  },
]

type DeptMetric = {
  key: string
  title: string
  shortTitle: string
  description: string
  iconColor: string
  getValue: (d: DepartmentStat) => number | null
  formatValue: (v: number) => string
  sort: "asc" | "desc"
  excludeZero?: boolean
}

const DEPT_METRICS: DeptMetric[] = [
  {
    key: "dept_avg_clock_in",
    title: "Dept. Avg Clock In",
    shortTitle: "Clock in",
    description: "Average arrival time for departments as a whole",
    iconColor: "text-amber-500",
    getValue: (d) => d.avg_clock_in_minutes,
    formatValue: formatMinutesAsTime,
    sort: "asc",
  },
  {
    key: "dept_avg_clock_out",
    title: "Dept. Avg Clock Out",
    shortTitle: "Clock out",
    description: "Average departure time for departments as a whole",
    iconColor: "text-indigo-500",
    getValue: (d) => d.avg_clock_out_minutes,
    formatValue: formatMinutesAsTime,
    sort: "desc",
  },
  {
    key: "dept_time_in_office",
    title: "Dept. Avg Time in Office",
    shortTitle: "Hours",
    description: "Average total hours logged per employee",
    iconColor: "text-blue-500",
    getValue: (d) => d.avg_total_hours ?? (d.employee_count > 0 ? d.total_hours / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)}h avg`,
    sort: "desc",
  },
  {
    key: "dept_overtime",
    title: "Dept. Avg Overtime",
    shortTitle: "Overtime",
    description: "Average overtime hours logged per employee",
    iconColor: "text-purple-500",
    getValue: (d) => d.avg_overtime_hours ?? (d.employee_count > 0 ? (d.overtime_hours ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)}h avg`,
    sort: "desc",
    excludeZero: true,
  },
  {
    key: "dept_absences",
    title: "Dept. Avg Absences",
    shortTitle: "Absences",
    description: "Average absent days per employee in department",
    iconColor: "text-red-500",
    getValue: (d) => d.avg_absent_days ?? (d.employee_count > 0 ? (d.absent_days ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)} days avg`,
    sort: "desc",
    excludeZero: true,
  },
  {
    key: "dept_incomplete",
    title: "Dept. Avg Incomplete Records",
    shortTitle: "Incomplete",
    description: "Average missing clock-outs per employee",
    iconColor: "text-cyan-500",
    getValue: (d) => d.avg_incomplete_days ?? (d.employee_count > 0 ? (d.incomplete_days ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)} days avg`,
    sort: "desc",
    excludeZero: true,
  },
  {
    key: "dept_appeals",
    title: "Dept. Avg Appeals Filed",
    shortTitle: "Appeals",
    description: "Average attendance appeals submitted per employee",
    iconColor: "text-rose-500",
    getValue: (d) => d.avg_appeal_count ?? (d.employee_count > 0 ? (d.appeal_count ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)} avg`,
    sort: "desc",
    excludeZero: true,
  },
]

/** Gold/silver/bronze for the top three, plain otherwise. */
function rankTone(rank: number): string {
  if (rank === 1) return "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  if (rank === 2) return "border-slate-400/50 bg-slate-400/15 text-slate-700 dark:text-slate-300"
  if (rank === 3) return "border-orange-700/40 bg-orange-700/15 text-orange-800 dark:text-orange-300"
  return "text-muted-foreground"
}

const DEFAULT_VISIBLE = 10

export function Leaderboard2View({
  departments,
  lockedDepartment,
}: {
  departments: string[]
  lockedDepartment?: string
}) {
  const [yearMonth, setYearMonth] = useState(toLocalYearMonth)
  const [periodMode, setPeriodMode] = useState<"month" | "quarter" | "all">("month")
  const [quarter, setQuarter] = useState<Quarter>("Q1")
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear())
  const [department, setDepartment] = useState(lockedDepartment || "all")
  const [scope, setScope] = useState<"individual" | "department">("individual")
  const [reports, setReports] = useState<LeaderboardReport[]>([])
  const [departmentStats, setDepartmentStats] = useState<DepartmentStat[]>([])
  const [loading, setLoading] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // On mobile one board is shown at a time, chosen here. Seven cards each with
  // their own inner scrollbar is unusable on a phone — nested scrolling traps
  // the gesture and you can never tell which list you are actually moving.
  const [activeMetric, setActiveMetric] = useState<string>("avg_clock_in")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { start, end } =
        periodMode === "month"
          ? monthBounds(yearMonth)
          : periodMode === "quarter"
            ? quarterBounds(quarterYear, quarter)
            : { start: ATTENDANCE_TRACKING_START, end: toLocalISODate() }
      const params = new URLSearchParams({
        start_date: start,
        end_date: end,
        department: lockedDepartment || department,
      })
      const res = await fetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as {
        data?: LeaderboardReport[]
        department_stats?: DepartmentStat[]
        error?: string
      } | null
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load leaderboard")
      setReports(payload?.data ?? [])
      setDepartmentStats(payload?.department_stats ?? [])
    } catch (err) {
      log.error("Failed to load attendance leaderboard", err)
      toast.error("Failed to load leaderboard")
      setReports([])
      setDepartmentStats([])
    } finally {
      setLoading(false)
    }
  }, [periodMode, yearMonth, quarter, quarterYear, department, lockedDepartment])

  useEffect(() => {
    void load()
  }, [load])

  const individualBoards = useMemo(
    () =>
      METRICS.map((metric) => ({
        key: metric.key,
        title: metric.title,
        shortTitle: metric.shortTitle,
        description: metric.description,
        icon: metric.icon,
        iconColor: metric.iconColor,
        rows: reports
          .map((r) => ({ id: r.user_id, name: r.user_name, sub: r.department, value: metric.getValue(r) }))
          .filter((row): row is { id: string; name: string; sub: string; value: number } => row.value !== null)
          .filter((row) => !metric.excludeZero || row.value > 0)
          .sort((a, b) => (metric.sort === "desc" ? b.value - a.value : a.value - b.value))
          .map((row) => ({ ...row, display: metric.formatValue(row.value) })),
      })),
    [reports]
  )

  const departmentBoards = useMemo(
    () =>
      DEPT_METRICS.map((metric) => ({
        key: metric.key,
        title: metric.title,
        shortTitle: metric.shortTitle,
        description: metric.description,
        icon: Building2 as ComponentType<{ className?: string }>,
        iconColor: metric.iconColor,
        rows: departmentStats
          .map((d) => ({
            id: d.department,
            name: d.department,
            sub: `${d.employee_count} employee${d.employee_count === 1 ? "" : "s"}`,
            value: metric.getValue(d),
          }))
          .filter((row): row is { id: string; name: string; sub: string; value: number } => row.value !== null)
          .filter((row) => !metric.excludeZero || row.value > 0)
          .sort((a, b) => (metric.sort === "desc" ? b.value - a.value : a.value - b.value))
          .map((row) => ({ ...row, display: metric.formatValue(row.value) })),
      })),
    [departmentStats]
  )

  const boards = scope === "individual" ? individualBoards : departmentBoards

  // Keep the mobile selection valid when the scope flips between the two metric sets.
  useEffect(() => {
    if (!boards.some((b) => b.key === activeMetric)) {
      setActiveMetric(boards[0]?.key ?? "")
    }
  }, [boards, activeMetric])

  const mobileBoard = boards.find((b) => b.key === activeMetric) ?? boards[0]

  const periodLabel =
    periodMode === "month"
      ? new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : periodMode === "quarter"
        ? `${quarter} ${quarterYear}`
        : "All time"

  const activeFilterCount = (periodMode !== "month" ? 1 : 0) + (!lockedDepartment && department !== "all" ? 1 : 0)

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    const now = new Date()
    const [startYear, startMonth] = ATTENDANCE_TRACKING_START.split("-").map(Number)
    let y = now.getFullYear()
    let m = now.getMonth()
    while (y > startYear || (y === startYear && m >= startMonth - 1)) {
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

  return (
    <div className="space-y-4">
      {/* Scope + one filter trigger */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5">
          {(["individual", "department"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={cn(
                "flex-1 rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                scope === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="relative h-9 w-9 shrink-0">
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
              <SheetTitle>Period &amp; department</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Cycle</p>
                <div className="flex gap-1.5">
                  {(
                    [
                      { value: "month", label: "Monthly" },
                      { value: "quarter", label: "Quarterly" },
                      { value: "all", label: "All time" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPeriodMode(opt.value)}
                      className={cn(
                        "flex-1 rounded-lg border py-2 text-xs font-medium transition-colors",
                        periodMode === opt.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {periodMode === "month" && (
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
              )}

              {periodMode === "quarter" && (
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
                      onClick={() => setDepartment("all")}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        department === "all"
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
                        onClick={() => setDepartment(d)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs",
                          department === d
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
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPeriodMode("month")
                  setYearMonth(toLocalYearMonth())
                  setDepartment(lockedDepartment || "all")
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

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {periodLabel}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {scope === "individual"
            ? `${reports.length} ${reports.length === 1 ? "employee" : "employees"}`
            : `${departmentStats.length} ${departmentStats.length === 1 ? "department" : "departments"}`}
        </Badge>
      </div>

      {/* Mobile: pick one board, then read it as a full list — no nested scrollers */}
      <div className="space-y-3 md:hidden">
        <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {boards.map((board) => (
            <button
              key={board.key}
              type="button"
              onClick={() => setActiveMetric(board.key)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                activeMetric === board.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {board.shortTitle}
            </button>
          ))}
        </div>

        {mobileBoard && (
          <div className="bg-card rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <mobileBoard.icon className={cn("h-4 w-4", mobileBoard.iconColor)} />
              <h3 className="text-sm font-semibold">{mobileBoard.title}</h3>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">{mobileBoard.description}</p>

            <div className="mt-3">
              {loading ? (
                <BoardSkeleton />
              ) : mobileBoard.rows.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-xs">No data for this period.</p>
              ) : (
                <RankList rows={mobileBoard.rows} limit={null} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: all boards side by side, each showing a top slice that expands
          in place rather than scrolling inside a fixed-height box. */}
      <div className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
        {boards.map((board) => {
          const isExpanded = expanded[board.key]
          const hasMore = board.rows.length > DEFAULT_VISIBLE
          return (
            <div key={board.key} className="bg-card flex flex-col rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <board.icon className={cn("h-4 w-4", board.iconColor)} />
                <h3 className="text-sm font-semibold">{board.title}</h3>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">{board.description}</p>

              <div className="mt-3 flex-1">
                {loading ? (
                  <BoardSkeleton />
                ) : board.rows.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center text-xs">No data for this period.</p>
                ) : (
                  <RankList rows={board.rows} limit={isExpanded ? null : DEFAULT_VISIBLE} />
                )}
              </div>

              {hasMore && !loading && (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [board.key]: !prev[board.key] }))}
                  className="text-muted-foreground hover:text-foreground mt-2 border-t pt-2 text-xs font-medium transition-colors"
                >
                  {isExpanded ? "Show less" : `Show all ${board.rows.length}`}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {!loading && boards.every((b) => b.rows.length === 0) && (
        <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
          <Trophy className="text-muted-foreground/50 h-10 w-10" />
          <h3 className="mt-3 text-sm font-semibold">Nothing to rank yet</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-xs">
            No attendance data was recorded for this period.
          </p>
        </div>
      )}
    </div>
  )
}

type RankRow = { id: string; name: string; sub: string; display: string }

function RankList({ rows, limit }: { rows: RankRow[]; limit: number | null }) {
  const visible = limit === null ? rows : rows.slice(0, limit)
  return (
    <ol className="space-y-0.5">
      {visible.map((row, i) => {
        const rank = i + 1
        return (
          <li key={row.id} className="flex items-center justify-between gap-2 rounded px-1 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                variant="outline"
                className={cn("w-6 shrink-0 justify-center px-0 text-[10px] font-bold", rankTone(rank))}
              >
                {rank}
              </Badge>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{row.name}</p>
                <p className="text-muted-foreground truncate text-[10px]">{row.sub}</p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold">{row.display}</span>
          </li>
        )
      })}
    </ol>
  )
}

function BoardSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-2 py-1">
          <div className="bg-muted h-5 w-6 rounded" />
          <div className="flex-1 space-y-1">
            <div className="bg-muted h-3 w-28 rounded" />
            <div className="bg-muted h-2.5 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
