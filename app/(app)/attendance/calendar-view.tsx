"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import type { AttendanceRecord } from "./page"

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

  const today = new Date().toISOString().slice(0, 10)
  const currentYearMonth = toLocalYearMonth()
  const cells = buildCalendarCells(calendarMonth)
  const daysByDate = new Map<string, UnifiedDay>((days ?? []).map((d) => [d.date, d]))

  return (
    <div>
      {/* Month navigator */}
      <div className="mb-4 flex items-center gap-1">
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

      {loading ? (
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
              const bg = !isFuture && status && CELL_BG[status] ? CELL_BG[status] : ""
              const clockIn = formatTime(day?.record?.clock_in)
              const clockOut = formatTime(day?.record?.clock_out)
              const timeLabel = clockIn ? (clockOut ? `${clockIn} – ${clockOut}` : clockIn) : ""

              return (
                <div key={date} className={`min-h-16 border-b p-1.5 text-xs ${isLastInRow ? "" : "border-r"} ${bg}`}>
                  <div
                    className={`mb-1 font-medium ${date === today ? "text-primary font-bold" : "text-muted-foreground"}`}
                  >
                    {date.slice(8)}
                  </div>
                  {!isFuture && day && status && status !== "weekend" && (
                    <>
                      <div className="truncate leading-tight font-medium" style={{ fontSize: "10px" }}>
                        {ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status}
                      </div>
                      {timeLabel && (
                        <div className="text-muted-foreground leading-tight" style={{ fontSize: "10px" }}>
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
    </div>
  )
}
