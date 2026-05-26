import { PmsTablePage } from "@/app/admin/hr/pms/_components/pms-table-page"
import { formatWATDate } from "@/lib/utils/date"
import { getCurrentUserPmsData } from "../_lib"

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-"
}

export default async function PmsAttendancePage() {
  const { score, attendance } = await getCurrentUserPmsData()
  const getCycleLabel = (dateValue: string) => {
    const date = new Date(dateValue)
    const quarter = Math.floor(date.getMonth() / 3) + 1
    return `Q${quarter} ${date.getFullYear()}`
  }
  const rows = attendance.recent.map((record) => ({
    cycle: getCycleLabel(record.date),
    month: formatWATDate(record.date, { month: "long" }),
    date: formatWATDate(record.date),
    clock_in: record.clock_in || "-",
    clock_out: record.clock_out || "In progress",
    total_hours: record.total_hours !== null ? `${record.total_hours.toFixed(2)} hrs` : "Pending",
    status: record.status || "unknown",
  }))

  return (
    <PmsTablePage
      title="PMS Attendance"
      description={`Attendance score: ${formatPercent(score.attendance_score)}. Present days: ${score.breakdown.attendance.present}. Tracked days: ${score.breakdown.attendance.total}.`}
      backHref="/pms"
      backLabel="Back to PMS"
      icon="attendance"
      summaryCards={[
        { label: "Attendance Score", value: formatPercent(score.attendance_score) },
        { label: "Present Days", value: score.breakdown.attendance.present },
        { label: "Tracked Days", value: score.breakdown.attendance.total },
      ]}
      tableTitle="Recent Attendance"
      tableDescription="Your latest attendance entries counted in PMS."
      rows={rows}
      columns={[
        { key: "cycle", label: "Cycle" },
        { key: "date", label: "Date" },
        { key: "clock_in", label: "Clock In" },
        { key: "clock_out", label: "Clock Out" },
        { key: "total_hours", label: "Total Hours" },
        { key: "status", label: "Status" },
      ]}
      searchPlaceholder="Search attendance records..."
      filterKey="cycle"
      filterLabel="Cycle"
      filterAllLabel="All Cycles"
    />
  )
}
