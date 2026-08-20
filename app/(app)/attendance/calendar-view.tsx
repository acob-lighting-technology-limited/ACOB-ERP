"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { computeAttendanceDay, attendanceRateFrom } from "@/lib/hr/attendance-ssot"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import type { AttendanceRecord } from "./page"

type DayStatus =
  | "present"
  | "late"
  | "lateness_with_permission"
  | "absent"
  | "absent_with_permission"
  | "out_of_station"
  | "incomplete"
  | "waiver"
  | "exempted"
  | "on_leave"
  | "holiday"
  | "weekend"

interface UnifiedDay {
  date: string
  record: AttendanceRecord | null
  status: DayStatus
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

function formatTime(t: string | null | undefined) {
  if (!t) return ""
  return t.substring(0, 5)
}

const CELL_BG: Record<string, string> = {
  early: "bg-green-50/80 border-green-200 dark:bg-green-950/30 dark:border-green-800",
  present: "bg-blue-50/80 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  late: "bg-yellow-50/80 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
  lateness_with_permission: "bg-amber-50/80 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
  incomplete_with_permission: "bg-teal-50/80 border-teal-200 dark:bg-teal-950/30 dark:border-teal-800",
  early_departure: "bg-orange-50/80 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
  early_departure_with_permission: "bg-orange-50/80 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
  early_closure: "bg-blue-50/80 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  late_resumption: "bg-sky-50/80 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800",
  incomplete: "bg-cyan-50/80 border-cyan-200 dark:bg-cyan-950/30 dark:border-cyan-800",
  absent: "bg-red-50/80 border-red-200 dark:bg-red-950/30 dark:border-red-800",
  absent_with_permission: "bg-rose-50/80 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800",
  out_of_station: "bg-indigo-50/80 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-800",
  waiver: "bg-blue-50/80 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  waived: "bg-blue-50/80 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  exempted: "bg-violet-50/80 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800",
  on_leave: "bg-purple-50/80 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
  holiday: "bg-sky-50/80 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800",
  weekend: "bg-slate-50/60 border-slate-200 dark:bg-slate-900/40 dark:border-slate-800",
  no_record: "bg-gray-50/80 border-gray-200 dark:bg-gray-900/30 dark:border-gray-800",
  half_day: "bg-yellow-50/80 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
}

function shortStatusLabel(status: string, fullLabel: string): string {
  switch (status) {
    case "lateness_with_permission":
      return "LWP"
    case "incomplete_with_permission":
      return "IWP"
    case "absent_with_permission":
      return "AWP"
    case "out_of_station":
      return "Out"
    case "incomplete":
      return "Inc"
    case "on_leave":
      return "Leave"
    default:
      return fullLabel
  }
}

export function EmployeeCalendarView() {
  const [calendarMonth, setCalendarMonth] = useState(toLocalYearMonth())
  const [days, setDays] = useState<UnifiedDay[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setDays(null)
    try {
      const res = await fetch(`/api/hr/attendance/my-days?year_month=${calendarMonth}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load")
      setDays(payload?.data ?? [])
    } catch {
      toast.error("Failed to load calendar data")
      setDays([])
    } finally {
      setLoading(false)
    }
  }, [calendarMonth])

  useEffect(() => {
    void load()
  }, [load])

  const today = toLocalISODate()
  const currentYearMonth = toLocalYearMonth()
  const cells = buildCalendarCells(calendarMonth)
  const daysByDate = new Map<string, UnifiedDay>((days ?? []).map((d) => [d.date, d]))

  // Monthly work & missed hours for the selected calendar month
  const { monthWorkedHours, monthMissedHours } = useMemo(() => {
    if (!days || days.length === 0) return { monthWorkedHours: null, monthMissedHours: null }
    const todayIso = toLocalISODate()
    const scorable = days.filter((d) => {
      const s = d.status
      if (s === "weekend" || s === "holiday" || s === "on_leave" || s === "exempted" || s === "waiver") return false
      // Exclude a day still in progress (clocked in today, not yet clocked out)
      if (d.date === todayIso && d.record?.clock_in && !d.record?.clock_out) return false
      return true
    })
    if (scorable.length === 0) return { monthWorkedHours: null, monthMissedHours: null }
    let workedSum = 0
    let missedSum = 0
    for (const d of scorable) {
      const dayResult = computeAttendanceDay({
        status: d.status,
        clockIn: d.record?.clock_in ?? null,
        clockOut: d.record?.clock_out ?? null,
      })
      workedSum += dayResult.hoursWorked
      missedSum += dayResult.hoursLost
    }
    return {
      monthWorkedHours: Math.round(workedSum * 10) / 10,
      monthMissedHours: Math.round(missedSum * 10) / 10,
    }
  }, [days])

  return (
    <div>
      {/* Month navigator + monthly hour stats */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCalendarMonth((m) => navigateMonth(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">{formatMonthLabel(calendarMonth)}</span>
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
        {!loading && monthWorkedHours !== null && (
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="min-w-[80px] rounded-lg border px-2 py-1 text-center sm:min-w-[90px] sm:px-3 sm:py-1.5">
              <p className="text-muted-foreground mb-0.5 text-[10px] leading-none sm:mb-1 sm:text-[11px]">Work Hours</p>
              <p className="text-xs leading-none font-semibold text-emerald-600 sm:text-sm">{monthWorkedHours} hrs</p>
            </div>
            <div className="min-w-[80px] rounded-lg border px-2 py-1 text-center sm:min-w-[90px] sm:px-3 sm:py-1.5">
              <p className="text-muted-foreground mb-0.5 text-[10px] leading-none sm:mb-1 sm:text-[11px]">
                Missed Hours
              </p>
              <p className="text-xs leading-none font-semibold text-amber-600 sm:text-sm">{monthMissedHours} hrs</p>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-muted-foreground py-16 text-center text-sm">Loading calendar…</div>
      ) : (
        <div className="rounded-lg border">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b">
            {DAY_HEADERS.map((d) => (
              <div
                key={d}
                className="text-muted-foreground py-1.5 text-center text-[11px] font-semibold sm:py-2 sm:text-xs"
              >
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
                    className={`bg-muted/20 min-h-14 border-b p-0.5 sm:min-h-16 sm:p-1 ${isLastInRow ? "" : "border-r"}`}
                  />
                )
              }
              const day = daysByDate.get(date)
              const status = day?.status
              const isFuture = date > today
              const bg = !isFuture && status && CELL_BG[status] ? CELL_BG[status] : ""
              const clockIn = formatTime(day?.record?.clock_in)
              const clockOut = formatTime(day?.record?.clock_out)
              const timeLabel = clockIn ? (clockOut ? `${clockIn} – ${clockOut}` : clockIn) : ""
              const fullLabel = status
                ? (ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status)
                : ""

              return (
                <div
                  key={date}
                  className={`min-h-14 border-b p-1 text-xs sm:min-h-16 sm:p-1.5 ${isLastInRow ? "" : "border-r"} ${bg}`}
                >
                  <div
                    className={`mb-0.5 text-[11px] font-medium sm:text-xs ${date === today ? "text-primary font-bold" : "text-muted-foreground"}`}
                  >
                    {date.slice(8)}
                  </div>
                  {!isFuture && day && status && status !== "weekend" && (
                    <>
                      <Badge
                        className={`max-w-full truncate px-1 py-0 text-[9px] font-medium sm:text-[10px] ${
                          ATTENDANCE_STATUS_COLORS[status as keyof typeof ATTENDANCE_STATUS_COLORS] ??
                          "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                        }`}
                      >
                        <span className="sm:hidden">{shortStatusLabel(status, fullLabel)}</span>
                        <span className="hidden sm:inline">{fullLabel}</span>
                      </Badge>
                      {timeLabel && (
                        <div className="text-muted-foreground mt-0.5 text-[9px] leading-tight sm:text-[10px]">
                          {timeLabel}
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
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(Object.entries(ATTENDANCE_STATUS_LABELS) as [string, string][])
          .filter(([key]) => key !== "waived" && key !== "no_record")
          .map(([key, label]) => (
            <Badge
              key={key}
              className={`text-xs ${ATTENDANCE_STATUS_COLORS[key as keyof typeof ATTENDANCE_STATUS_COLORS] ?? "bg-gray-100 text-gray-800"}`}
            >
              {label}
            </Badge>
          ))}
      </div>
    </div>
  )
}
