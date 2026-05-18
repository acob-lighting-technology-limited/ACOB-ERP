"use client"

import { useState } from "react"
import { logger } from "@/lib/logger"

const log = logger("action-tracker-export-dialog")
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Download, Loader2 } from "lucide-react"
import * as XLSX from "@e965/xlsx"
import { createClient } from "@/lib/supabase/client"
import { getCurrentISOWeek } from "@/lib/utils"

interface ExportDialogProps {
  isOpen: boolean
  onClose: () => void
  departments: string[]
}

export function ActionPointExportDialog({ isOpen, onClose, departments }: ExportDialogProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [period, setPeriod] = useState("week") // week, month, quarter, year
  const [deptFilter, setDeptFilter] = useState("all")
  const [year, setYear] = useState(new Date().getFullYear())
  const [value, setValue] = useState(getCurrentISOWeek()) // Current Week or Month

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const supabase = createClient()
      let query = supabase.from("action_items").select("*").eq("year", year)

      // Time range filtering
      if (period === "week") {
        query = query.eq("week_number", value)
      } else if (period === "month") {
        const start = new Date(year, value - 1, 1)
        const end = new Date(year, value, 0)
        const startWeek = getCurrentISOWeek(start)
        const endWeek = getCurrentISOWeek(end)
        query = query.gte("week_number", startWeek).lte("week_number", endWeek)
      } else if (period === "quarter") {
        const start = new Date(year, (value - 1) * 3, 1)
        const end = new Date(year, value * 3, 0)
        const startWeek = getCurrentISOWeek(start)
        const endWeek = getCurrentISOWeek(end)
        query = query.gte("week_number", startWeek).lte("week_number", endWeek)
      }

      if (deptFilter !== "all") {
        query = query.eq("department", deptFilter)
      }

      const { data, error } = await query
      if (error) throw error

      if (!data || data.length === 0) {
        toast.error("No data found for the selected period")
        return
      }

      const exportData = data.map((t, index) => ({
        "#": index + 1,
        Department: t.department,
        Action: t.title,
        Description: t.description || "",
        Status: t.status,
        Week: t.week_number,
        Year: t.year,
      }))

      const worksheet = XLSX.utils.json_to_sheet(exportData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Actions")
      XLSX.writeFile(workbook, `ACOB_Actions_Export_${period}_${value}_${year}.xlsx`)

      toast.success("Export completed")
      onClose()
    } catch (error: unknown) {
      log.error("Export error:", error)
      toast.error("Export failed")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Export Action Tracker Data</DialogTitle>
          <DialogDescription>Select the period and department you want to export.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Time Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Specific Week</SelectItem>
                <SelectItem value="month">Specific Month</SelectItem>
                <SelectItem value="quarter">Specific Quarter</SelectItem>
                <SelectItem value="year">Full Year</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Year</Label>
              <Input
                type="number"
                value={year}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setYear(parseInt(e.target.value))}
              />
            </div>
            {period !== "year" && (
              <div className="space-y-2">
                <Label>{period === "week" ? "Week Number" : period === "month" ? "Month" : "Quarter"}</Label>
                <Input
                  type="number"
                  value={value}
                  min={1}
                  max={period === "week" ? 53 : period === "month" ? 12 : 4}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(parseInt(e.target.value))}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Department</Label>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every Department</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Generate Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
