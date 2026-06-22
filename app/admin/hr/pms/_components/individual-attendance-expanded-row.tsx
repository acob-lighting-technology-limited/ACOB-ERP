"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { StatusBadge, formatTime, labelSource } from "../../attendance/_components/status-badge"

type AttendanceDay = {
  date: string
  record?: {
    id: string
    date: string
    clock_in: string | null
    clock_out: string | null
    status: string
    source: string | null
    clock_in_source: string | null
    clock_out_source: string | null
    waived: boolean
    editor_first_name?: string | null
  } | null
  status: string
  manual_by: string | null
}

function getMonthsInRange(startDateStr: string, endDateStr: string): string[] {
  const start = new Date(startDateStr)
  const end = new Date(endDateStr)
  const months: string[] = []

  const current = new Date(start.getFullYear(), start.getMonth(), 1)
  const endMonthLimit = new Date(end.getFullYear(), end.getMonth(), 1)

  while (current <= endMonthLimit) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, "0")
    months.push(`${year}-${month}`)
    current.setMonth(current.getMonth() + 1)
  }

  return months
}

export function IndividualAttendanceExpandedRow({
  userId,
  cycleId,
  cycles,
}: {
  userId: string
  cycleId: string
  cycles: { id: string; name: string; start_date: string | null; end_date: string | null }[]
}) {
  const [days, setDays] = useState<AttendanceDay[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cycle = cycles.find((c) => c.id === cycleId)
  const startDate = cycle?.start_date
  const endDate = cycle?.end_date

  useEffect(() => {
    if (!userId || !startDate || !endDate) return

    let active = true
    setIsLoading(true)
    setError(null)

    const months = getMonthsInRange(startDate, endDate)

    void (async () => {
      try {
        const promises = months.map(async (month) => {
          const res = await fetch(
            `/api/admin/hr/attendance/employee-days?user_id=${encodeURIComponent(userId)}&year_month=${encodeURIComponent(month)}`,
            { cache: "no-store" }
          )
          if (!res.ok) {
            throw new Error(`Failed to fetch attendance for ${month}`)
          }
          const payload = await res.json()
          return (payload?.data || []) as AttendanceDay[]
        })

        const results = await Promise.all(promises)
        if (!active) return

        // Merge all arrays, filter within cycle range, and sort descending
        const merged = results
          .flat()
          .filter((d) => d.date >= startDate && d.date <= endDate)
          .sort((a, b) => b.date.localeCompare(a.date))

        setDays(merged)
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load logs")
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [userId, startDate, endDate])

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading daily attendance logs...
      </div>
    )
  }

  if (error) {
    return <div className="text-destructive py-2 text-sm">Error: {error}</div>
  }

  if (days.length === 0) {
    return <div className="text-muted-foreground py-2 text-sm">No attendance logs found in this cycle.</div>
  }

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs font-semibold">Daily Attendance logs for {cycle?.name}</div>
      <div className="bg-card overflow-x-auto rounded-md border">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground font-medium">
            <tr>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Clock In</th>
              <th className="px-4 py-2 text-left">Clock Out</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Source/Captured By</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const rec = day.record
              return (
                <tr key={day.date} className="hover:bg-muted/30 border-t transition-colors">
                  <td className="px-4 py-2 font-medium">{day.date}</td>
                  <td className="px-4 py-2">{formatTime(rec?.clock_in)}</td>
                  <td className="px-4 py-2">{formatTime(rec?.clock_out)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={day.status} waived={rec?.waived} />
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">{labelSource(rec)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
