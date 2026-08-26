"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { ExportPeriodFields, useExportPeriod } from "./export-period-picker"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("attendance-export-dialog")

type ExportFormat = "csv" | "xlsx" | "pdf"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  department?: string
  monthOptions: { value: string; label: string }[]
}

type AttendanceRow = {
  user_name?: string
  department?: string
  total_days?: number
  early_days?: number
  present_days?: number
  late_days?: number
  lateness_with_permission_days?: number
  incomplete_with_permission_days?: number
  incomplete_days?: number
  exempted_days?: number
  out_of_station_days?: number
  absent_with_permission_days?: number
  leave_days?: number
  holiday_days?: number
  waived_days?: number
  absent_days?: number
  total_hours?: number
  total_missed_hours?: number
}

type LunchRow = {
  full_name: string
  employee_number: string
  department: string | null
  lunch_count: number
  total_deduction: number
}

const LUNCH_HEADERS = ["S/N", "Name", "Employee No", "Department", "Lunch Count", "Grand Total", "Net Deduction"]

const HEADERS = [
  "Name",
  "Department",
  "Hrs Missed",
  "Total Hours",
  "Present",
  "Absent",
  "Early",
  "Late",
  "Incomplete",
  "LWP",
  "IWP",
  "AWP",
  "OOS",
  "Leave",
  "Holiday",
  "Exemption",
  "Waiver",
]

function toRow(r: AttendanceRow): (string | number)[] {
  return [
    r.user_name ?? "",
    r.department ?? "",
    Number(r.total_missed_hours ?? 0).toFixed(1),
    Number(r.total_hours ?? 0).toFixed(1),
    // Present is shown against the workdays available in the period, so the figure
    // reads on its own without a separate Total Days column.
    `${r.present_days ?? 0} / ${r.total_days ?? 0}`,
    r.absent_days ?? 0,
    r.early_days ?? 0,
    r.late_days ?? 0,
    r.incomplete_days ?? 0,
    r.lateness_with_permission_days ?? 0,
    r.incomplete_with_permission_days ?? 0,
    r.absent_with_permission_days ?? 0,
    r.out_of_station_days ?? 0,
    r.leave_days ?? 0,
    r.holiday_days ?? 0,
    r.exempted_days ?? 0,
    r.waived_days ?? 0,
  ]
}

/**
 * Attendance export with a selectable period. Unlike the old month-bound export
 * (which serialised whatever the table happened to be showing), this refetches for
 * the chosen range — so a custom range or a payroll period exports the right days
 * regardless of the month the table is on.
 */
export function AttendanceExportDialog({ open, onOpenChange, department, monthOptions }: Props) {
  const picker = useExportPeriod()
  const [format, setFormat] = useState<ExportFormat>("xlsx")
  const [includeLunch, setIncludeLunch] = useState(false)
  const [exporting, setExporting] = useState(false)

  // The lunch report is a second worksheet, which only Excel can carry — CSV and PDF are
  // single-table formats, so the option is unavailable there rather than silently ignored.
  const lunchAvailable = format === "xlsx"
  const withLunch = includeLunch && lunchAvailable

  async function handleExport() {
    const range = picker.resolve()
    if (!range) {
      toast.error(picker.validationMessage())
      return
    }

    setExporting(true)
    try {
      const params = new URLSearchParams({
        start_date: range.start,
        end_date: range.end,
        department: department || "all",
      })
      const res = await apiFetch(`/api/hr/attendance/reports?${params.toString()}`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: AttendanceRow[] } | null
      if (!res.ok) throw new Error("Failed to load attendance data")

      const rows = (payload?.data ?? []).map(toRow)
      if (rows.length === 0) {
        toast.error("No attendance records in that period")
        return
      }

      if (format === "csv") {
        const escapeCell = (value: string | number) => {
          const str = String(value ?? "")
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
        }
        const csv = [HEADERS, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `attendance_${range.label}.csv`
        a.click()
        URL.revokeObjectURL(url)
      } else if (format === "xlsx") {
        const XLSX = await import("@e965/xlsx")
        // file-saver's CJS export *is* the function, so it arrives on `default` —
        // destructuring `saveAs` off the namespace yields undefined at runtime.
        const { default: saveAs } = await import("file-saver")
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), "Attendance")

        if (withLunch) {
          const lunchParams = new URLSearchParams({ start_date: range.start, end_date: range.end })
          const lunchRes = await apiFetch(`/api/admin/hr/lunch?${lunchParams.toString()}`, { cache: "no-store" })
          const lunchPayload = (await lunchRes.json().catch(() => null)) as {
            summary?: LunchRow[]
            settings?: { subsidy_percent?: number }
          } | null
          if (!lunchRes.ok) throw new Error("Failed to load lunch data")

          const lunchRows = (lunchPayload?.summary ?? []).filter((r) => r.lunch_count > 0)
          const subsidyPercent = Number(lunchPayload?.settings?.subsidy_percent ?? 50)
          const deductionShare = Math.max(0.01, (100 - subsidyPercent) / 100)

          const lunchSheet = XLSX.utils.aoa_to_sheet([
            LUNCH_HEADERS,
            ...lunchRows.map((r, i) => {
              const netDeduction = Number(r.total_deduction ?? 0)
              const grandTotal = Math.round(netDeduction / deductionShare)
              return [
                i + 1,
                r.full_name,
                r.employee_number,
                r.department ?? "",
                r.lunch_count,
                grandTotal,
                netDeduction,
              ]
            }),
          ])
          XLSX.utils.book_append_sheet(workbook, lunchSheet, "Lunch")
        }

        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
        saveAs(
          new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${withLunch ? "attendance_lunch" : "attendance"}_${range.label}.xlsx`
        )
      } else {
        const { jsPDF } = await import("jspdf")
        const autoTable = (await import("jspdf-autotable")).default
        const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
        doc.setFontSize(14)
        doc.text(`Attendance Report — ${range.title}`, 40, 40)
        autoTable(doc, {
          head: [HEADERS],
          body: rows.map((row) => row.map((cell) => String(cell))),
          startY: 56,
          styles: { fontSize: 7, cellPadding: 3 },
          headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
        })
        doc.save(`attendance_${range.label}.pdf`)
      }

      toast.success(withLunch ? "Attendance and lunch report exported" : "Attendance exported")
      onOpenChange(false)
    } catch (err) {
      log.error({ err: String(err) }, "Failed to export attendance report")
      toast.error(err instanceof Error ? err.message : "Failed to export report")
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Attendance Report</DialogTitle>
          <DialogDescription>
            Exports every employee&apos;s attendance summary for the selected period.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <ExportPeriodFields picker={picker} monthOptions={monthOptions} />

          <div className="space-y-2">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                <SelectItem value="csv">CSV (.csv)</SelectItem>
                <SelectItem value="pdf">PDF (.pdf)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-lunch"
                checked={withLunch}
                disabled={!lunchAvailable}
                onCheckedChange={(checked) => setIncludeLunch(checked === true)}
              />
              <Label htmlFor="include-lunch" className={lunchAvailable ? "" : "text-muted-foreground"}>
                Include lunch report
              </Label>
            </div>
            <p className="text-muted-foreground text-xs">
              {lunchAvailable
                ? "Adds a second worksheet with lunch counts and deductions for the same period."
                : "Only available for Excel — CSV and PDF hold a single table."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
