"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, Clock, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api-client"
import { toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { formatWATDate } from "@/lib/utils/date"
import type { LeaveItem } from "../view"
import { STAGE_LABELS, getStageBadge, resolvePersonName } from "../view"

export interface CalendarStats {
  total_days: number
  active_leaves: number
  approved_count: number
  pending_count: number
}

export interface LeaveCalendarViewProps {
  apiBasePath?: string
  lockedDepartment?: string
  onSelectLeave?: (leave: LeaveItem) => void
  onStatsChange?: (stats: CalendarStats) => void
}

interface HolidayItem {
  id: string
  holiday_date: string
  name: string
  location?: string | null
}

interface EmployeeFilterOption {
  id: string
  name: string
  department?: string | null
}

interface LeaveTypeOption {
  id: string
  name: string
  code?: string | null
}

interface CalendarApiResponse {
  data: {
    leaves: LeaveItem[]
    holidays: HolidayItem[]
    departments: string[]
    employees: EmployeeFilterOption[]
    leave_types: LeaveTypeOption[]
    stats: {
      total_days: number
      active_leaves: number
      approved_count: number
      pending_count: number
    }
  }
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
]

function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = currentYear - 3; y <= currentYear + 2; y++) {
    years.push(y)
  }
  return years
}

function monBasedDay(jsDay: number) {
  return jsDay === 0 ? 6 : jsDay - 1
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

/** Color palette definition for different leave types */
interface LeaveTypeColorDef {
  bg: string
  text: string
  border: string
  dot: string
  badgeClass: string
  label: string
}

const LEAVE_TYPE_COLORS: Record<string, LeaveTypeColorDef> = {
  annual: {
    bg: "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60",
    text: "text-emerald-800 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-800",
    dot: "bg-emerald-500",
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    label: "Annual Leave",
  },
  sick: {
    bg: "bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/60",
    text: "text-rose-800 dark:text-rose-300",
    border: "border-rose-300 dark:border-rose-800",
    dot: "bg-rose-500",
    badgeClass: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    label: "Sick Leave",
  },
  casual: {
    bg: "bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-950/60",
    text: "text-sky-800 dark:text-sky-300",
    border: "border-sky-300 dark:border-sky-800",
    dot: "bg-sky-500",
    badgeClass: "bg-sky-500/10 text-sky-600 border-sky-500/20",
    label: "Casual / Personal",
  },
  maternity: {
    bg: "bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-950/60",
    text: "text-purple-800 dark:text-purple-300",
    border: "border-purple-300 dark:border-purple-800",
    dot: "bg-purple-500",
    badgeClass: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    label: "Maternity / Paternity",
  },
  study: {
    bg: "bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60",
    text: "text-indigo-800 dark:text-indigo-300",
    border: "border-indigo-300 dark:border-indigo-800",
    dot: "bg-indigo-500",
    badgeClass: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
    label: "Study / Exam",
  },
  compassionate: {
    bg: "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/60",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
    dot: "bg-amber-500",
    badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    label: "Compassionate",
  },
  unpaid: {
    bg: "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800",
    text: "text-slate-800 dark:text-slate-300",
    border: "border-slate-300 dark:border-slate-700",
    dot: "bg-slate-500",
    badgeClass: "bg-slate-500/10 text-slate-600 border-slate-500/20",
    label: "Unpaid / LWOP",
  },
  default: {
    bg: "bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-950/60",
    text: "text-teal-800 dark:text-teal-300",
    border: "border-teal-300 dark:border-teal-800",
    dot: "bg-teal-500",
    badgeClass: "bg-teal-500/10 text-teal-600 border-teal-500/20",
    label: "Other Leave",
  },
}

function resolveLeaveTypeColor(typeName?: string | null): LeaveTypeColorDef {
  const norm = String(typeName || "").toLowerCase()
  if (norm.includes("annual")) return LEAVE_TYPE_COLORS.annual
  if (norm.includes("sick") || norm.includes("medical")) return LEAVE_TYPE_COLORS.sick
  if (norm.includes("casual") || norm.includes("personal")) return LEAVE_TYPE_COLORS.casual
  if (norm.includes("maternity") || norm.includes("paternity")) return LEAVE_TYPE_COLORS.maternity
  if (norm.includes("study") || norm.includes("exam")) return LEAVE_TYPE_COLORS.study
  if (norm.includes("compassionate") || norm.includes("bereavement")) return LEAVE_TYPE_COLORS.compassionate
  if (norm.includes("unpaid") || norm.includes("lwop")) return LEAVE_TYPE_COLORS.unpaid
  return LEAVE_TYPE_COLORS.default
}

export function LeaveCalendarView({
  apiBasePath = "/api/admin/hr/leave",
  lockedDepartment,
  onSelectLeave,
  onStatsChange,
}: LeaveCalendarViewProps) {
  const initialMonth = toLocalYearMonth()
  const [calendarMonth, setCalendarMonth] = useState<string>(initialMonth)
  const [selectedDept, setSelectedDept] = useState<string>(lockedDepartment || "all")
  const [selectedUserId, setSelectedUserId] = useState<string>("all")
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState<string>("all")
  const [selectedStatus, setSelectedStatus] = useState<string>("all")

  const [loading, setLoading] = useState(false)
  const [calendarData, setCalendarData] = useState<{
    leaves: LeaveItem[]
    holidays: HolidayItem[]
    departments: string[]
    employees: EmployeeFilterOption[]
    leave_types: LeaveTypeOption[]
    stats: { total_days: number; active_leaves: number; approved_count: number; pending_count: number }
  }>({
    leaves: [],
    holidays: [],
    departments: [],
    employees: [],
    leave_types: [],
    stats: { total_days: 0, active_leaves: 0, approved_count: 0, pending_count: 0 },
  })

  // Day expansion modal for crowded days
  const [expandedDay, setExpandedDay] = useState<{
    date: string
    leaves: LeaveItem[]
    holiday?: HolidayItem | null
  } | null>(null)

  const activeDept = lockedDepartment || (selectedDept !== "all" ? selectedDept : undefined)

  const [selectedYear, selectedMonth] = useMemo(() => {
    const parts = calendarMonth.split("-")
    return [parts[0] || String(new Date().getFullYear()), parts[1] || "01"]
  }, [calendarMonth])

  const yearOptions = useMemo(() => getYearOptions(), [])

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        year_month: calendarMonth,
      })
      if (activeDept) params.set("department", activeDept)
      if (selectedUserId && selectedUserId !== "all") params.set("user_id", selectedUserId)
      if (selectedLeaveTypeId && selectedLeaveTypeId !== "all") params.set("leave_type_id", selectedLeaveTypeId)
      if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus)

      const endpoint = apiBasePath.includes("/dept/")
        ? `${apiBasePath}/calendar?${params.toString()}`
        : `/api/admin/hr/leave/calendar?${params.toString()}`

      const res = await apiFetch(endpoint, { cache: "no-store" })
      const json = (await res.json().catch(() => null)) as CalendarApiResponse | null

      if (!res.ok) {
        throw new Error((json as unknown as { error?: string })?.error || "Failed to load calendar")
      }

      if (json?.data) {
        const stats = json.data.stats || { total_days: 0, active_leaves: 0, approved_count: 0, pending_count: 0 }
        setCalendarData({
          leaves: Array.isArray(json.data.leaves) ? json.data.leaves : [],
          holidays: Array.isArray(json.data.holidays) ? json.data.holidays : [],
          departments: Array.isArray(json.data.departments) ? json.data.departments : [],
          employees: Array.isArray(json.data.employees) ? json.data.employees : [],
          leave_types: Array.isArray(json.data.leave_types) ? json.data.leave_types : [],
          stats,
        })
        onStatsChange?.(stats)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load leave calendar")
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, calendarMonth, activeDept, selectedUserId, selectedLeaveTypeId, selectedStatus, onStatsChange])

  useEffect(() => {
    void loadCalendar()
  }, [loadCalendar])

  const today = toLocalISODate()
  const cells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth])

  // Map holidays by ISO date
  const holidayByDate = useMemo(() => {
    const map = new Map<string, HolidayItem>()
    const list = Array.isArray(calendarData?.holidays) ? calendarData.holidays : []
    for (const h of list) {
      map.set(h.holiday_date, h)
    }
    return map
  }, [calendarData?.holidays])

  // Map leaves by ISO date (a leave spanning from start_date to end_date applies to all days in between)
  const leavesByDate = useMemo(() => {
    const map = new Map<string, LeaveItem[]>()
    const list = Array.isArray(calendarData?.leaves) ? calendarData.leaves : []
    for (const item of list) {
      if (!item.start_date || !item.end_date) continue
      const start = new Date(`${item.start_date}T00:00:00`)
      const end = new Date(`${item.end_date}T00:00:00`)

      for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
        const iso = toLocalISODate(cur)
        const dayList = map.get(iso) || []
        dayList.push(item)
        map.set(iso, dayList)
      }
    }
    return map
  }, [calendarData?.leaves])

  const hasActiveFilters =
    (!lockedDepartment && selectedDept !== "all") ||
    selectedUserId !== "all" ||
    selectedLeaveTypeId !== "all" ||
    selectedStatus !== "all"

  const handleResetFilters = () => {
    if (!lockedDepartment) setSelectedDept("all")
    setSelectedUserId("all")
    setSelectedLeaveTypeId("all")
    setSelectedStatus("all")
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {/* Controls & Filter Toolbar */}
        <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2.5 shadow-xs">
          {/* Year Select */}
          <Select value={selectedYear} onValueChange={(year) => setCalendarMonth(`${year}-${selectedMonth}`)}>
            <SelectTrigger className="h-8 w-[105px] text-xs font-medium">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Month Select */}
          <Select value={selectedMonth} onValueChange={(month) => setCalendarMonth(`${selectedYear}-${month}`)}>
            <SelectTrigger className="h-8 w-[125px] text-xs font-medium">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Department Filter (if not locked) */}
          {!lockedDepartment && (
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger className="h-8 w-[145px] text-xs">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {(calendarData?.departments || []).map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Employee Filter */}
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="h-8 w-[155px] text-xs">
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {(calendarData?.employees || []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Leave Type Filter */}
          <Select value={selectedLeaveTypeId} onValueChange={setSelectedLeaveTypeId}>
            <SelectTrigger className="h-8 w-[135px] text-xs">
              <SelectValue placeholder="Leave Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {(calendarData?.leave_types || []).map((lt) => (
                <SelectItem key={lt.id} value={lt.id}>
                  {lt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="h-8 w-[115px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>

          {/* Reset Button */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground ml-auto h-8 gap-1 px-2 text-xs"
              onClick={handleResetFilters}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>

        {/* Calendar Grid or Skeleton Loading */}
        <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
          {/* Day of week headers */}
          <div className="bg-muted/60 grid grid-cols-7 border-b text-center">
            {DAY_HEADERS.map((day, idx) => {
              const isWeekend = idx >= 5
              return (
                <div
                  key={day}
                  className={`py-1.5 text-[11px] font-semibold tracking-wider uppercase ${
                    isWeekend ? "text-muted-foreground/80" : "text-foreground"
                  }`}
                >
                  {day}
                </div>
              )
            })}
          </div>

          {/* Grid Content */}
          {loading ? (
            <div className="divide-border/60 grid grid-cols-7 divide-y">
              {Array.from({ length: 35 }).map((_, idx) => {
                const colIndex = idx % 7
                const isLastInRow = colIndex === 6
                return (
                  <div
                    key={`skeleton-${idx}`}
                    className={`flex min-h-[64px] flex-col justify-between p-1.5 sm:min-h-[74px] ${
                      isLastInRow ? "" : "border-border/60 border-r"
                    }`}
                  >
                    <Skeleton className="h-4 w-4 rounded-full" />
                    {idx % 3 === 0 && <Skeleton className="mt-1 h-4 w-full rounded-xs" />}
                    {idx % 5 === 0 && <Skeleton className="mt-1 h-4 w-4/5 rounded-xs" />}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="divide-border/60 grid grid-cols-7 divide-y">
              {cells.map((date, idx) => {
                const colIndex = idx % 7
                const isLastInRow = colIndex === 6
                const isWeekend = colIndex >= 5

                if (!date) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      className={`bg-muted/10 min-h-[64px] p-1 sm:min-h-[74px] ${
                        isLastInRow ? "" : "border-border/60 border-r"
                      }`}
                    />
                  )
                }

                const isToday = date === today
                const dayNum = Number(date.slice(8))
                const holiday = holidayByDate.get(date)
                const dayLeaves = leavesByDate.get(date) || []
                const visibleLeaves = dayLeaves.slice(0, 3)
                const overflowCount = dayLeaves.length - visibleLeaves.length

                return (
                  <div
                    key={date}
                    className={`relative flex min-h-[64px] flex-col p-1 transition-colors sm:min-h-[74px] ${
                      isLastInRow ? "" : "border-border/60 border-r"
                    } ${isWeekend ? "bg-muted/15" : "bg-card"} ${
                      isToday ? "ring-primary bg-primary/5 ring-2 ring-inset" : ""
                    }`}
                  >
                    {/* Cell Header: Date Number + Holiday tag */}
                    <div className="mb-0.5 flex items-center justify-between">
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                          isToday
                            ? "bg-primary text-primary-foreground font-bold shadow-xs"
                            : isWeekend
                              ? "text-muted-foreground"
                              : "text-foreground"
                        }`}
                      >
                        {dayNum}
                      </span>

                      {holiday && (
                        <span
                          className="py-0.2 max-w-[80px] truncate rounded-xs bg-amber-500/15 px-1 text-[8px] font-semibold text-amber-700 dark:text-amber-400"
                          title={holiday.name}
                        >
                          {holiday.name}
                        </span>
                      )}
                    </div>

                    {/* Leave Items Stack */}
                    <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
                      {visibleLeaves.map((leave) => {
                        const colorDef = resolveLeaveTypeColor(leave.leave_type?.name)
                        const isApproved = leave.status === "approved" || leave.status === "completed"
                        const isPending = leave.status === "pending" || leave.status === "pending_evidence"
                        const empName = leave.user?.full_name || resolvePersonName(leave.user) || "Employee"
                        const typeName = leave.leave_type?.name || "Leave"
                        const subtitle = [leave.user?.department, leave.user?.company_email].filter(Boolean).join(" • ")

                        return (
                          <Tooltip key={`${leave.id}-${date}`}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => onSelectLeave?.(leave)}
                                className={`group flex h-4.5 w-full cursor-pointer items-center gap-1 rounded border px-1 py-0 text-left text-[10px] leading-tight transition-all ${
                                  colorDef.bg
                                } ${colorDef.text} ${
                                  isPending
                                    ? "border-dashed border-amber-400/80 dark:border-amber-600/80"
                                    : colorDef.border
                                }`}
                              >
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorDef.dot}`} />
                                <span className="flex-1 truncate font-medium">{empName}</span>
                                {isPending && (
                                  <Clock className="h-2.5 w-2.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="center"
                              className="bg-popover text-popover-foreground max-w-xs space-y-2 border p-3 shadow-lg"
                            >
                              {/* Tooltip Header: Person & Department */}
                              <div className="border-border/40 flex items-start justify-between gap-2 border-b pb-1.5">
                                <div>
                                  <h4 className="text-foreground text-sm leading-tight font-semibold">{empName}</h4>
                                  {subtitle && <p className="text-muted-foreground text-[11px]">{subtitle}</p>}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={`shrink-0 text-[10px] font-medium ${colorDef.badgeClass}`}
                                >
                                  {typeName}
                                </Badge>
                              </div>

                              {/* Tooltip Details */}
                              <div className="space-y-1 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Duration:</span>
                                  <span className="text-foreground font-medium">
                                    {leave.start_date} → {leave.end_date} ({leave.days_count} days)
                                  </span>
                                </div>
                                {leave.resume_date && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Resumes:</span>
                                    <span className="text-foreground font-medium">{leave.resume_date}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between pt-0.5">
                                  <span className="text-muted-foreground">Status:</span>
                                  <div>{getStageBadge(leave)}</div>
                                </div>
                                {leave.reliever && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Reliever:</span>
                                    <span className="text-foreground font-medium">
                                      {resolvePersonName(leave.reliever)}
                                    </span>
                                  </div>
                                )}
                                {leave.reason && (
                                  <div className="text-muted-foreground line-clamp-2 pt-1 text-[11px] italic">
                                    &ldquo;{leave.reason}&rdquo;
                                  </div>
                                )}
                              </div>

                              <div className="border-border/40 text-primary/80 border-t pt-1 text-center text-[10px] font-medium">
                                Click to view complete details & history
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )
                      })}

                      {/* Overflow "+N more" button */}
                      {overflowCount > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedDay({
                              date,
                              leaves: dayLeaves,
                              holiday,
                            })
                          }
                          className="bg-muted/60 py-0.2 text-muted-foreground hover:bg-muted hover:text-foreground mt-auto flex w-full cursor-pointer items-center justify-center rounded-xs text-[9px] font-medium transition-colors"
                        >
                          +{overflowCount} more
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground font-medium">Leave Types:</span>
            {Object.entries(LEAVE_TYPE_COLORS).map(([key, item]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                <span className="text-foreground text-[11px]">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t pt-1.5 sm:border-t-0 sm:pt-0">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs border border-dashed border-amber-500 bg-amber-500/20" />
              <span className="text-muted-foreground text-[11px]">Pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-amber-500/20" />
              <span className="text-muted-foreground text-[11px]">Holiday</span>
            </div>
          </div>
        </div>

        {/* Crowded Day Details Dialog */}
        <Dialog
          open={expandedDay !== null}
          onOpenChange={(open) => {
            if (!open) setExpandedDay(null)
          }}
        >
          <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="text-primary h-4 w-4" />
                Leaves on {expandedDay?.date ? formatWATDate(expandedDay.date) : ""}
              </DialogTitle>
              {expandedDay?.holiday && (
                <DialogDescription className="font-medium text-amber-600">
                  Public Holiday: {expandedDay.holiday.name}
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-2.5 py-2">
              {expandedDay?.leaves.map((leave) => {
                const colorDef = resolveLeaveTypeColor(leave.leave_type?.name)
                return (
                  <div
                    key={leave.id}
                    className={`cursor-pointer rounded-lg border p-3 transition-colors ${colorDef.bg} ${colorDef.border}`}
                    onClick={() => {
                      setExpandedDay(null)
                      onSelectLeave?.(leave)
                    }}
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-foreground text-sm font-semibold">
                          {leave.user?.full_name || resolvePersonName(leave.user)}
                        </h4>
                        <p className="text-muted-foreground text-xs">
                          {leave.user?.department || "No Department"} • {leave.user?.company_email}
                        </p>
                      </div>
                      <Badge variant="outline" className={colorDef.badgeClass}>
                        {leave.leave_type?.name}
                      </Badge>
                    </div>

                    <div className="text-muted-foreground border-border/40 grid grid-cols-2 gap-1 border-t pt-1 text-xs">
                      <div>
                        <span className="text-foreground font-medium">Period:</span> {leave.start_date} to{" "}
                        {leave.end_date}
                      </div>
                      <div>
                        <span className="text-foreground font-medium">Days:</span> {leave.days_count} day(s)
                      </div>
                      <div className="col-span-2 flex items-center gap-1.5 pt-1">
                        <span className="text-foreground font-medium">Stage:</span>
                        {getStageBadge(leave)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
