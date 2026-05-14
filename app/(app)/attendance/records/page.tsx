"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { TableSkeleton, QueryError } from "@/components/ui/query-states"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Calendar, ChevronDown, ChevronUp, TrendingDown } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/patterns"
import { latenessDeduction, formatNaira, monthBounds } from "@/lib/hr/attendance-utils"

interface AttendanceRecord {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
  waived: boolean
  waiver_reason: string | null
}

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7)
}

async function fetchAttendanceRecords(yearMonth: string): Promise<AttendanceRecord[]> {
  const { start, end } = monthBounds(yearMonth)
  const response = await fetch(`/api/hr/attendance/records?start_date=${start}&end_date=${end}`)
  if (!response.ok) throw new Error("Failed to load attendance records")
  const data = await response.json()
  return (data.data || []) as AttendanceRecord[]
}

function formatDayName(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", { weekday: "long" })
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(t: string | null) {
  if (!t) return "-"
  return t.substring(0, 5)
}

function getStatusBadge(status: string) {
  const colors: Record<string, string> = {
    present: "bg-green-100 text-green-800",
    late: "bg-yellow-100 text-yellow-800",
    absent: "bg-red-100 text-red-800",
    half_day: "bg-orange-100 text-orange-800",
    incomplete: "bg-red-100 text-red-700",
  }
  return colors[status] ?? "bg-gray-100 text-gray-800"
}

function recordDeduction(record: AttendanceRecord): number {
  if (record.waived) return 0
  if (record.status === "absent") return 0
  return latenessDeduction(record.clock_in)
}

export default function AttendanceRecordsPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const {
    data: records = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [...QUERY_KEYS.attendance(), yearMonth],
    queryFn: () => fetchAttendanceRecords(yearMonth),
  })

  const totalHours = records.reduce((sum, r) => sum + (r.total_hours ?? 0), 0)
  const presentDays = records.filter((r) => r.status === "present" || r.status === "late").length
  const totalDeduction = records.reduce((sum, r) => sum + recordDeduction(r), 0)

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="My Attendance Records"
        description="Monthly attendance history"
        backLink={{ href: "/attendance", label: "Back to Attendance" }}
        className="mb-6"
      />

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium">Month</label>
        <input
          type="month"
          value={yearMonth}
          max={currentYearMonth()}
          onChange={(e) => {
            setYearMonth(e.target.value)
            setExpandedId(null)
          }}
          className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 md:gap-4">
        <StatCard title="Days Recorded" value={records.length} icon={Calendar} />
        <StatCard title="Days Present" value={presentDays} icon={Calendar} />
        <StatCard title="Hours Worked" value={totalHours.toFixed(1)} icon={Clock} />
        <StatCard
          title="Total Deduction"
          value={formatNaira(totalDeduction)}
          icon={TrendingDown}
          iconBgColor={totalDeduction > 0 ? "bg-red-500/10" : "bg-green-500/10"}
          iconColor={totalDeduction > 0 ? "text-red-500" : "text-green-500"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Attendance History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : isError ? (
            <QueryError message="Could not load attendance records." onRetry={refetch} />
          ) : records.length === 0 ? (
            <EmptyState
              title="No attendance records found"
              description="Attendance entries for the selected month will appear here."
              icon={Calendar}
              className="border-0"
            />
          ) : (
            <div className="space-y-1">
              {records.map((record) => {
                const isExpanded = expandedId === record.id
                const deduction = recordDeduction(record)
                return (
                  <div key={record.id} className="rounded-lg border">
                    <button
                      className="hover:bg-muted/50 grid w-full grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3 text-left transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : record.id)}
                    >
                      <div>
                        <div className="font-medium">{formatDayName(record.date)}</div>
                        <div className="text-muted-foreground text-xs">{formatDate(record.date)}</div>
                      </div>
                      <Badge className={getStatusBadge(record.status)}>{record.status}</Badge>
                      {deduction > 0 ? (
                        <span className="text-xs font-medium text-red-600">-{formatNaira(deduction)}</span>
                      ) : record.waived ? (
                        <span className="text-xs font-medium text-blue-600">Waived</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">₦0</span>
                      )}
                      <div className="text-sm font-medium">{record.total_hours?.toFixed(1) ?? "-"}h</div>
                      {isExpanded ? (
                        <ChevronUp className="text-muted-foreground h-4 w-4" />
                      ) : (
                        <ChevronDown className="text-muted-foreground h-4 w-4" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="bg-muted/30 grid grid-cols-2 gap-4 border-t px-4 py-3 text-sm sm:grid-cols-4">
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs">Clock In</div>
                          <div className="flex items-center gap-1 font-medium">
                            <Clock className="h-3 w-3 text-green-600" />
                            {formatTime(record.clock_in)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs">Clock Out</div>
                          <div className="flex items-center gap-1 font-medium">
                            <Clock className="h-3 w-3 text-red-500" />
                            {formatTime(record.clock_out)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs">Hours Worked</div>
                          <div className="font-medium">{record.total_hours?.toFixed(2) ?? "-"} hrs</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs">Lateness Deduction</div>
                          <div className={deduction > 0 ? "font-medium text-red-600" : "font-medium text-green-600"}>
                            {record.waived
                              ? `Waived${record.waiver_reason ? ` — ${record.waiver_reason}` : ""}`
                              : `-${formatNaira(deduction)}`}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
