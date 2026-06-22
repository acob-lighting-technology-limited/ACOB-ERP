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

type SourceInfo = {
  source?: string | null
  clock_in_source?: string | null
  clock_out_source?: string | null
  clock_in?: string | null
  clock_out?: string | null
  editor_first_name?: string | null
  status?: string | null
  waived?: boolean | null
}

/** Hikvision = device "auto"; everything else (manual, remote_web) = "manual". */
function punchKind(src: string | null | undefined): "auto" | "manual" | null {
  if (!src) return null
  return src.toLowerCase() === "hikvision" ? "auto" : "manual"
}

/**
 * Human label for how a record was captured.
 * - "—": no punches at all (e.g. absent) — source is meaningless, so show nothing
 * - Automated: every present punch came from the device
 * - Manual: every present punch was manual/remote
 * - Mixed: a combination (e.g. device clock-in, manual clock-out)
 * Accepts a record (preferred) or a plain legacy source string for back-compat.
 */
export function labelSource(record: SourceInfo | string | null | undefined): string {
  const info: SourceInfo = typeof record === "string" || record == null ? { source: record ?? null } : record

  const kinds = new Set<"auto" | "manual">()
  const inK = punchKind(info.clock_in_source)
  const outK = punchKind(info.clock_out_source)
  if (inK) kinds.add(inK)
  if (outK) kinds.add(outK)

  let baseLabel = "Manual"
  if (info.source === "manual") {
    baseLabel = "Manual"
  } else if (kinds.size === 0) {
    // No per-punch data. A row with actual punches but missing per-punch source
    // (legacy/un-backfilled) falls back to the single source column; a row with
    // no punches at all (absent) has no source to show.
    const hasPunch = Boolean(info.clock_in || info.clock_out)

    // Check if the record status is a manual overridden status or waived
    const isManualStatus =
      info.status === "waiver" ||
      info.status === "absent_with_permission" ||
      info.status === "lateness_with_permission" ||
      info.status === "out_of_station" ||
      info.waived === true

    if (!hasPunch && !isManualStatus && !info.editor_first_name) return "—"
    baseLabel = punchKind(info.source) === "auto" ? "Automated" : "Manual"
  } else if (kinds.size === 2) {
    baseLabel = "Mixed"
  } else {
    baseLabel = kinds.has("auto") ? "Automated" : "Manual"
  }

  if (baseLabel === "Manual" && info.editor_first_name) {
    return `Manual (${info.editor_first_name})`
  }
  if (baseLabel === "Mixed" && info.editor_first_name) {
    return `Mixed (${info.editor_first_name})`
  }
  return baseLabel
}
