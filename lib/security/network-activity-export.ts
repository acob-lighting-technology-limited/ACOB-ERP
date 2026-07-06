import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"
import {
  networkActivityCategoryLabel,
  type NetworkActivityCategory,
} from "@/lib/security/network-activity-classify"

const log = logger("network-activity-export")

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type NetworkActivityExportRow = Record<string, unknown>

export interface NetworkActivityBandwidthForExport {
  bytes_in: number
  bytes_out: number
  snapshot_at: string
}

export interface NetworkActivityRowForExport {
  id: string
  user_id: string | null
  matched_identifier: string
  domain: string
  source_ip: string | null
  visited_at: string
  raw_url: string | null
  device_hostname: string | null
  mac_address: string | null
  device_vendor: string | null
  is_new_device: boolean
  user_agent: string | null
  browser: string | null
  os: string | null
  employee_first_name: string | null
  employee_last_name: string | null
  employee_email: string | null
  employee_department: string | null
  category: NetworkActivityCategory
  bandwidth: NetworkActivityBandwidthForExport | null
}

/** Formats a byte count as a human-readable string (e.g. "12.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

// ---------------------------------------------------------------------------
// 1. buildNetworkActivityExportRows — build the flat row array
// ---------------------------------------------------------------------------

/**
 * Build the flat row array used by Excel / PDF export.
 * The caller must pass the rows already sorted and filtered.
 */
export function buildNetworkActivityExportRows(rows: NetworkActivityRowForExport[]): NetworkActivityExportRow[] {
  return rows.map((r, index) => {
    const name = [r.employee_first_name, r.employee_last_name].filter(Boolean).join(" ")
    return {
      "#": index + 1,
      Who: name || r.matched_identifier,
      Email: r.employee_email || "-",
      Department: r.employee_department || "-",
      Domain: r.domain,
      "Visited At": formatWATDate(r.visited_at, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      "Source IP": r.source_ip || "-",
      Device: r.device_hostname || "-",
      "MAC Address": r.mac_address || "-",
      "Device Vendor": r.device_vendor || "-",
      "New Device": r.is_new_device ? "Yes" : "No",
      Browser: r.browser || "-",
      OS: r.os || "-",
      "User Agent": r.user_agent || "-",
      "Matched Identifier": r.matched_identifier,
      Category: networkActivityCategoryLabel(r.category),
      "Bandwidth In": r.bandwidth ? formatBytes(r.bandwidth.bytes_in) : "-",
      "Bandwidth Out": r.bandwidth ? formatBytes(r.bandwidth.bytes_out) : "-",
      "Bandwidth Snapshot At": r.bandwidth
        ? formatWATDate(r.bandwidth.snapshot_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "-",
    }
  })
}

// ---------------------------------------------------------------------------
// 2. exportNetworkActivityToExcel
// ---------------------------------------------------------------------------

export async function exportNetworkActivityToExcel(rows: NetworkActivityExportRow[], filename?: string): Promise<void> {
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Network Activity")

    const maxWidth = 50
    const cols = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.min(Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)), maxWidth),
    }))
    ws["!cols"] = cols

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const data = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    saveAs(data, filename ?? `network-activity-export-${toLocalISODate()}.xlsx`)
    toast.success("Network activity exported to Excel successfully")
  } catch (error: unknown) {
    log.error("Error exporting to Excel:", error)
    toast.error("Failed to export to Excel")
  }
}

// ---------------------------------------------------------------------------
// 3. exportNetworkActivityToPDF
// ---------------------------------------------------------------------------

export async function exportNetworkActivityToPDF(
  rows: NetworkActivityExportRow[],
  filename?: string,
  extraMeta?: { total: number }
): Promise<void> {
  try {
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default

    const doc = new jsPDF({ orientation: "landscape" })

    doc.setFontSize(16)
    doc.text("Network Activity Report", 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${formatWATDate(new Date())}`, 14, 22)
    doc.text(`Total Records: ${extraMeta?.total ?? rows.length}`, 14, 28)

    const headers = Object.keys(rows[0] || {})
    const body = rows.map((row) => headers.map((h) => String(row[h] ?? "")))

    autoTable(doc, {
      head: [headers],
      body,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 139, 34], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    doc.save(filename ?? `network-activity-export-${toLocalISODate()}.pdf`)
    toast.success("Network activity exported to PDF successfully")
  } catch (error: unknown) {
    log.error("Error exporting to PDF:", error)
    toast.error("Failed to export to PDF")
  }
}
