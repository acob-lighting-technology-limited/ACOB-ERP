"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ExportPeriodFields, useExportPeriod } from "./export-period-picker"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("attendance-lunch-export-dialog")

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  department?: string
  monthOptions: { value: string; label: string }[]
}

type AttendanceRow = Record<string, unknown> & {
  user_name?: string
  employee_no?: string
  department?: string
  total_days?: number
  early_days?: number
  present_days?: number
  late_days?: number
  lateness_with_permission_days?: number
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
  attendance_credits?: number
  attendance_rate?: number
}

type LunchRow = {
  full_name: string
  employee_number: string
  department: string | null
  lunch_count: number
  total_deduction: number
}

const ATTENDANCE_HEADERS = [
  "Name",
  "Employee No",
  "Department",
  "Total Days",
  "Early",
  "Present",
  "Late",
  "LWP",
  "Incomplete",
  "Exempted",
  "OOS",
  "AWP",
  "Leave",
  "Holiday",
  "Waiver",
  "Absent",
  "Total Hours",
  "Hrs Missed",
  "Credit",
  "Attendance Rate",
]

const LUNCH_HEADERS = ["S/N", "Name", "Employee No", "Department", "Lunch Count", "Grand Total", "Net Deduction"]

function attendanceRowToArray(r: AttendanceRow): (string | number)[] {
  return [
    r.user_name ?? "",
    r.employee_no ?? "",
    r.department ?? "",
    r.total_days ?? 0,
    r.early_days ?? 0,
    r.present_days ?? 0,
    r.late_days ?? 0,
    r.lateness_with_permission_days ?? 0,
    r.incomplete_days ?? 0,
    r.exempted_days ?? 0,
    r.out_of_station_days ?? 0,
    r.absent_with_permission_days ?? 0,
    r.leave_days ?? 0,
    r.holiday_days ?? 0,
    r.waived_days ?? 0,
    r.absent_days ?? 0,
    Number(r.total_hours ?? 0).toFixed(1),
    Number(r.total_missed_hours ?? 0).toFixed(1),
    Number(r.attendance_credits ?? 0).toFixed(2),
    `${Number(r.attendance_rate ?? 0).toFixed(2)}%`,
  ]
}

export function AttendanceLunchExportDialog({ open, onOpenChange, department, monthOptions }: Props) {
  const picker = useExportPeriod()
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    const range = picker.resolve()
    if (!range) {
      toast.error(picker.validationMessage())
      return
    }

    setExporting(true)
    try {
      const attendanceParams = new URLSearchParams({
        start_date: range.start,
        end_date: range.end,
        department: department || "all",
      })
      const lunchParams = new URLSearchParams({ start_date: range.start, end_date: range.end })

      const [attendanceRes, lunchRes] = await Promise.all([
        apiFetch(`/api/hr/attendance/reports?${attendanceParams.toString()}`, { cache: "no-store" }),
        apiFetch(`/api/admin/hr/lunch?${lunchParams.toString()}`, { cache: "no-store" }),
      ])

      const attendancePayload = (await attendanceRes.json().catch(() => null)) as { data?: AttendanceRow[] } | null
      const lunchPayload = (await lunchRes.json().catch(() => null)) as {
        summary?: LunchRow[]
        settings?: { subsidy_percent?: number }
      } | null

      if (!attendanceRes.ok) throw new Error("Failed to load attendance data")
      if (!lunchRes.ok) throw new Error("Failed to load lunch data")

      const attendanceRows = attendancePayload?.data ?? []
      const lunchRows = (lunchPayload?.summary ?? []).filter((r) => r.lunch_count > 0)
      const subsidyPercent = Number(lunchPayload?.settings?.subsidy_percent ?? 50)
      const deductionShare = Math.max(0.01, (100 - subsidyPercent) / 100)

      const XLSX = await import("@e965/xlsx")
      const { saveAs } = await import("file-saver")

      const attendanceSheet = XLSX.utils.aoa_to_sheet([ATTENDANCE_HEADERS, ...attendanceRows.map(attendanceRowToArray)])

      const lunchSheet = XLSX.utils.aoa_to_sheet([
        LUNCH_HEADERS,
        ...lunchRows.map((r, i) => {
          const netDeduction = Number(r.total_deduction ?? 0)
          const grandTotal = Math.round(netDeduction / deductionShare)
          return [i + 1, r.full_name, r.employee_number, r.department ?? "", r.lunch_count, grandTotal, netDeduction]
        }),
      ])

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, attendanceSheet, "Attendance")
      XLSX.utils.book_append_sheet(workbook, lunchSheet, "Lunch")

      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Attendance_Lunch_Report_${range.label}.xlsx`
      )

      toast.success("Report exported")
      onOpenChange(false)
    } catch (err) {
      log.error("Failed to export attendance/lunch report", err)
      toast.error(err instanceof Error ? err.message : "Failed to export report")
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Attendance & Lunch Report</DialogTitle>
          <DialogDescription>
            Generates one Excel file with two sheets — Attendance and Lunch — for the period below.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <ExportPeriodFields picker={picker} monthOptions={monthOptions} />
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
