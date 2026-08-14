"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Clock, Timer, UserX, AlertCircle, Sunrise, Sunset, FileWarning, Building2 } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import {
  ATTENDANCE_TRACKING_START,
  monthBounds,
  quarterBounds,
  toLocalISODate,
  toLocalYearMonth,
  type Quarter,
} from "@/lib/hr/attendance-utils"

const log = logger("hr-attendance-leaderboard")

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

interface LeaderboardViewProps {
  departments: string[]
  lockedDepartment?: string
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
    description: "Highest count of attendance appeals submitted",
    icon: FileWarning,
    iconColor: "text-rose-500",
    getValue: (r) => r.appeal_count ?? 0,
    formatValue: (v) => `${v} appeal${v === 1 ? "" : "s"}`,
    sort: "desc",
    excludeZero: true,
  },
]

type DepartmentMetricConfig = {
  key: string
  title: string
  description: string
  iconColor: string
  accentClass: string
  getValue: (d: DepartmentStat) => number | null
  formatValue: (v: number) => string
  sort: "asc" | "desc"
  excludeZero?: boolean
}

const DEPT_METRICS: Record<string, DepartmentMetricConfig> = {
  dept_avg_clock_in: {
    key: "dept_avg_clock_in",
    title: "Dept. Avg Clock In",
    description: "Average arrival time for departments as a whole",
    iconColor: "text-amber-500",
    accentClass: "border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/10",
    getValue: (d) => d.avg_clock_in_minutes,
    formatValue: formatMinutesAsTime,
    sort: "asc",
  },
  dept_avg_clock_out: {
    key: "dept_avg_clock_out",
    title: "Dept. Avg Clock Out",
    description: "Average departure time for departments as a whole",
    iconColor: "text-indigo-500",
    accentClass: "border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-500/10",
    getValue: (d) => d.avg_clock_out_minutes,
    formatValue: formatMinutesAsTime,
    sort: "desc",
  },
  dept_time_in_office: {
    key: "dept_time_in_office",
    title: "Dept. Avg Time in Office",
    description: "Average total hours logged per employee",
    iconColor: "text-blue-500",
    accentClass: "border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/10",
    getValue: (d) => d.avg_total_hours ?? (d.employee_count > 0 ? d.total_hours / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)}h avg`,
    sort: "desc",
  },
  dept_overtime: {
    key: "dept_overtime",
    title: "Dept. Avg Overtime",
    description: "Average overtime hours logged per employee",
    iconColor: "text-purple-500",
    accentClass: "border-purple-500/20 bg-purple-500/5 dark:bg-purple-500/10",
    getValue: (d) => d.avg_overtime_hours ?? (d.employee_count > 0 ? (d.overtime_hours ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)}h avg`,
    sort: "desc",
    excludeZero: true,
  },
  dept_absences: {
    key: "dept_absences",
    title: "Dept. Avg Absences",
    description: "Average absent days per employee in department",
    iconColor: "text-red-500",
    accentClass: "border-red-500/20 bg-red-500/5 dark:bg-red-500/10",
    getValue: (d) => d.avg_absent_days ?? (d.employee_count > 0 ? (d.absent_days ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)} days avg`,
    sort: "desc",
    excludeZero: true,
  },
  dept_incomplete: {
    key: "dept_incomplete",
    title: "Dept. Avg Incomplete Records",
    description: "Average missing clock-outs per employee",
    iconColor: "text-cyan-500",
    accentClass: "border-cyan-500/20 bg-cyan-500/5 dark:bg-cyan-500/10",
    getValue: (d) => d.avg_incomplete_days ?? (d.employee_count > 0 ? (d.incomplete_days ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)} days avg`,
    sort: "desc",
    excludeZero: true,
  },
  dept_appeals: {
    key: "dept_appeals",
    title: "Dept. Avg Appeals Filed",
    description: "Average attendance appeals submitted per employee",
    iconColor: "text-rose-500",
    accentClass: "border-rose-500/20 bg-rose-500/5 dark:bg-rose-500/10",
    getValue: (d) => d.avg_appeal_count ?? (d.employee_count > 0 ? (d.appeal_count ?? 0) / d.employee_count : 0),
    formatValue: (v) => `${v.toFixed(1)} avg`,
    sort: "desc",
    excludeZero: true,
  },
}

export function LeaderboardView({ departments, lockedDepartment }: LeaderboardViewProps) {
  const [yearMonth, setYearMonth] = useState(toLocalYearMonth)
  const [periodMode, setPeriodMode] = useState<"month" | "quarter" | "all">("month")
  const [quarter, setQuarter] = useState<Quarter>("Q1")
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear())
  const [department, setDepartment] = useState(lockedDepartment || "all")
  const [viewScope, setViewScope] = useState<"individual" | "department" | "combined">("individual")
  const [reports, setReports] = useState<LeaderboardReport[]>([])
  const [departmentStats, setDepartmentStats] = useState<DepartmentStat[]>([])
  const [loading, setLoading] = useState(false)

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

  const departmentOptions = useMemo(() => {
    const visible = lockedDepartment ? [lockedDepartment] : departments
    return visible.map((d) => ({ value: d, label: d }))
  }, [departments, lockedDepartment])

  const rankings = useMemo(() => {
    return METRICS.map((metric) => {
      const rows = reports
        .map((r) => ({ report: r, value: metric.getValue(r) }))
        .filter((row): row is { report: LeaderboardReport; value: number } => row.value !== null)
        .filter((row) => !metric.excludeZero || row.value > 0)
        .sort((a, b) => (metric.sort === "desc" ? b.value - a.value : a.value - b.value))
      return { metric, rows }
    })
  }, [reports])

  const rankingsByKey = useMemo(() => {
    const map = new Map<string, { metric: Metric; rows: { report: LeaderboardReport; value: number }[] }>()
    for (const r of rankings) {
      map.set(r.metric.key, r)
    }
    return map
  }, [rankings])

  const renderIndividualMetricCard = (ranking?: {
    metric: Metric
    rows: { report: LeaderboardReport; value: number }[]
  }) => {
    if (!ranking) return null
    const { metric, rows } = ranking
    return (
      <Card key={metric.key}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <metric.icon className={`h-4 w-4 ${metric.iconColor}`} />
            {metric.title}
          </CardTitle>
          <p className="text-muted-foreground text-xs">{metric.description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <p className="text-muted-foreground py-4 text-center text-xs">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">No data for this period.</p>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-1 pr-3">
                {rows.map((row, i) => (
                  <div
                    key={row.report.user_id}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="w-6 shrink-0 justify-center px-0 text-[10px]">
                        {i + 1}
                      </Badge>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{row.report.user_name}</div>
                        <div className="text-muted-foreground truncate text-[10px]">{row.report.department}</div>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold">{metric.formatValue(row.value)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    )
  }

  const renderDepartmentCardByKey = (deptKey: string) => {
    const config = DEPT_METRICS[deptKey]
    if (!config) return null

    const rows = departmentStats
      .map((d) => ({ dept: d, value: config.getValue(d) }))
      .filter((row): row is { dept: DepartmentStat; value: number } => row.value !== null)
      .filter((row) => !config.excludeZero || row.value > 0)
      .sort((a, b) => (config.sort === "desc" ? b.value - a.value : a.value - b.value))

    return (
      <Card key={config.key} className={config.accentClass}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Building2 className={`h-4 w-4 ${config.iconColor}`} />
            {config.title}
          </CardTitle>
          <p className="text-muted-foreground text-xs">{config.description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <p className="text-muted-foreground py-4 text-center text-xs">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">No department data for this period.</p>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-1 pr-3">
                {rows.map(({ dept, value }, i) => (
                  <div
                    key={dept.department}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="w-6 shrink-0 justify-center px-0 text-[10px]">
                        {i + 1}
                      </Badge>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{dept.department}</div>
                        <div className="text-muted-foreground truncate text-[10px]">
                          {dept.employee_count} employee{dept.employee_count === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold">{config.formatValue(value)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Cycle</Label>
            <Select value={periodMode} onValueChange={(v) => setPeriodMode(v as "month" | "quarter" | "all")}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Monthly</SelectItem>
                <SelectItem value="quarter">Quarterly</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {periodMode === "month" && (
            <div className="space-y-1">
              <Label className="text-xs">Month</Label>
              <Input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="w-[160px]"
              />
            </div>
          )}
          {periodMode === "quarter" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Quarter</Label>
                <Select value={quarter} onValueChange={(v) => setQuarter(v as Quarter)}>
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Q1">Q1</SelectItem>
                    <SelectItem value="Q2">Q2</SelectItem>
                    <SelectItem value="Q3">Q3</SelectItem>
                    <SelectItem value="Q4">Q4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Year</Label>
                <Input
                  type="number"
                  value={quarterYear}
                  onChange={(e) => setQuarterYear(Number(e.target.value) || quarterYear)}
                  className="w-[100px]"
                />
              </div>
            </>
          )}
          {!lockedDepartment && (
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departmentOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* View Scope Toggle */}
        <div className="space-y-1">
          <Label className="text-xs">View Scope</Label>
          <div className="bg-muted flex items-center gap-1 rounded-lg border p-1">
            <button
              type="button"
              onClick={() => setViewScope("individual")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewScope === "individual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Individual
            </button>
            <button
              type="button"
              onClick={() => setViewScope("department")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewScope === "department"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Department
            </button>
            <button
              type="button"
              onClick={() => setViewScope("combined")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewScope === "combined"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Combined
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Individual Scope */}
        {viewScope === "individual" && (
          <>
            {renderIndividualMetricCard(rankingsByKey.get("avg_clock_in"))}
            {renderIndividualMetricCard(rankingsByKey.get("avg_clock_out"))}
            {renderIndividualMetricCard(rankingsByKey.get("total_hours"))}
            {renderIndividualMetricCard(rankingsByKey.get("overtime_hours"))}
            {renderIndividualMetricCard(rankingsByKey.get("absent_days"))}
            {renderIndividualMetricCard(rankingsByKey.get("incomplete_days"))}
            {renderIndividualMetricCard(rankingsByKey.get("appeal_count"))}
          </>
        )}

        {/* Department Scope */}
        {viewScope === "department" && (
          <>
            {renderDepartmentCardByKey("dept_avg_clock_in")}
            {renderDepartmentCardByKey("dept_avg_clock_out")}
            {renderDepartmentCardByKey("dept_time_in_office")}
            {renderDepartmentCardByKey("dept_overtime")}
            {renderDepartmentCardByKey("dept_absences")}
            {renderDepartmentCardByKey("dept_incomplete")}
            {renderDepartmentCardByKey("dept_appeals")}
          </>
        )}

        {/* Combined Scope */}
        {viewScope === "combined" && (
          <>
            {renderIndividualMetricCard(rankingsByKey.get("avg_clock_in"))}
            {renderDepartmentCardByKey("dept_avg_clock_in")}

            {renderIndividualMetricCard(rankingsByKey.get("avg_clock_out"))}
            {renderDepartmentCardByKey("dept_avg_clock_out")}

            {renderIndividualMetricCard(rankingsByKey.get("total_hours"))}
            {renderDepartmentCardByKey("dept_time_in_office")}

            {renderIndividualMetricCard(rankingsByKey.get("overtime_hours"))}
            {renderDepartmentCardByKey("dept_overtime")}

            {renderIndividualMetricCard(rankingsByKey.get("absent_days"))}
            {renderDepartmentCardByKey("dept_absences")}

            {renderIndividualMetricCard(rankingsByKey.get("incomplete_days"))}
            {renderDepartmentCardByKey("dept_incomplete")}

            {renderIndividualMetricCard(rankingsByKey.get("appeal_count"))}
            {renderDepartmentCardByKey("dept_appeals")}
          </>
        )}
      </div>
    </div>
  )
}
