import { Badge } from "@/components/ui/badge"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"

export function StatusBadge({ status, waived }: { status: string; waived?: boolean }) {
  const s = waived ? "waiver" : status
  return (
    <Badge
      className={ATTENDANCE_STATUS_COLORS[s as keyof typeof ATTENDANCE_STATUS_COLORS] ?? "bg-gray-100 text-gray-800"}
    >
      {ATTENDANCE_STATUS_LABELS[s as keyof typeof ATTENDANCE_STATUS_LABELS] ?? s}
    </Badge>
  )
}

export function formatTime(t: string | null | undefined) {
  if (!t) return "—"
  return t.substring(0, 5)
}

export function labelSource(source: string | null | undefined) {
  const value = String(source || "").toLowerCase()
  if (value === "hikvision") return "Automated"
  if (!value) return "Manual"
  return value === "manual" ? "Manual" : value.charAt(0).toUpperCase() + value.slice(1)
}
