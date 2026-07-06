"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Percent, Clock, Timer, UserX, AlertCircle, Sunrise, Sunset, FileWarning } from "lucide-react"
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
  appeal_count?: number
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
    key: "attendance_rate",
    title: "Attendance Rate",
    description: "Highest attendance credit for the period",
    icon: Percent,
    iconColor: "text-emerald-500",
    getValue: (r) => r.attendance_rate,
    formatValue: (v) => `${v.toFixed(2)}%`,
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
    key: "earliest_arrival",
    title: "Earliest Average Arrival",
    description: "Lowest average clock-in time",
    icon: Sunrise,
    iconColor: "text-amber-500",
    getValue: (r) => r.avg_clock_in_minutes ?? null,
    formatValue: formatMinutesAsTime,
    sort: "asc",
  },
  {
    key: "latest_arrival",
    title: "Latest Average Arrival",
    description: "Highest average clock-in time",
    icon: Sunset,
    iconColor: "text-orange-500",
    getValue: (r) => r.avg_clock_in_minutes ?? null,
    formatValue: formatMinutesAsTime,
    sort: "desc",
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

export function LeaderboardView({ departments, lockedDepartment }: LeaderboardViewProps) {
  const [yearMonth, setYearMonth] = useState(toLocalYearMonth)
  const [periodMode, setPeriodMode] = useState<"month" | "quarter" | "all">("month")
  const [quarter, setQuarter] = useState<Quarter>("Q1")
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear())
  const [department, setDepartment] = useState(lockedDepartment || "all")
  const [reports, setReports] = useState<LeaderboardReport[]>([])
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
      const payload = (await res.json().catch(() => null)) as { data?: LeaderboardReport[]; error?: string } | null
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load leaderboard")
      setReports(payload?.data ?? [])
    } catch (err) {
      log.error("Failed to load attendance leaderboard", err)
      toast.error("Failed to load leaderboard")
      setReports([])
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

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rankings.map(({ metric, rows }) => (
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
        ))}
      </div>
    </div>
  )
}
