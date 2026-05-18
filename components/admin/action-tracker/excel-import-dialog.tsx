"use client"

import { useState } from "react"
import { logger } from "@/lib/logger"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"
import * as XLSX from "@e965/xlsx"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"

const log = logger("action-tracker-excel-import-dialog")

interface ExcelRow {
  [key: string]: string | number | Date | null | undefined
}

interface ExcelImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
}

export function ExcelImportDialog({ isOpen, onClose, onComplete }: ExcelImportDialogProps) {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [week, setWeek] = useState(currentOfficeWeek.week)
  const [year, setYear] = useState(currentOfficeWeek.year)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleImport = async () => {
    if (!file) {
      toast.error("Please select a file first")
      return
    }

    setIsUploading(true)
    const reader = new FileReader()

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array", cellDates: true })
        const firstSheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[firstSheetName]
        const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, { defval: "" })

        if (jsonData.length === 0) {
          toast.error("The selected sheet is empty")
          setIsUploading(false)
          return
        }

        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          toast.error("User not authenticated")
          setIsUploading(false)
          return
        }

        const actionsToInsert = jsonData.map((row) => {
          // Helper to find column by multiple name variants
          const getCol = (names: string[]) => {
            const normalizedNames = names.map((n) => n.toLowerCase())
            const key = Object.keys(row).find((k) => normalizedNames.includes(k.trim().toLowerCase()))
            return key ? row[key] : null
          }

          const title = getCol(["Action Description", "Action", "Description", "Task"]) || "Untitled Action"
          const dept = getCol(["Department", "Dept", "Unit"]) || "Unassigned"
          return {
            title: String(title).substring(0, 255),
            description: String(getCol(["Detailed Description", "Notes", "Details"]) || "").substring(0, 1000) || null,
            department: String(dept).substring(0, 100),
            week_number: week,
            year: year,
            assigned_by: user.id,
            status: "pending",
          }
        })

        const { error } = await supabase.from("action_items").insert(actionsToInsert)

        if (error) throw error

        toast.success(`Successfully imported ${actionsToInsert.length} actions`)
        onComplete()
        onClose()
      } catch (error: unknown) {
        log.error("Import error:", error)
        toast.error(`Failed to import: ${error instanceof Error ? error.message : "Unknown error"}`)
      } finally {
        setIsUploading(false)
      }
    }

    reader.readAsArrayBuffer(file)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            Import Weekly Actions
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file with columns: Department, Action Description, Priority, and Due Date.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Week Number</Label>
              <Input type="number" min="1" max="53" value={week} onChange={(e) => setWeek(parseInt(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Year</Label>
              <Input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Excel File</Label>
            <div className="flex items-center gap-2">
              <Input
                id="file"
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="cursor-pointer"
              />
            </div>
          </div>

          <div className="bg-muted space-y-1 rounded-md p-3 text-xs">
            <p className="text-muted-foreground font-semibold">Supported Column Names:</p>
            <ul className="text-muted-foreground/80 list-inside list-disc">
              <li>Action Description / Action / Description</li>
              <li>Department</li>
              <li>Priority (low, medium, high, urgent)</li>
              <li>Due Date</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!file || isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Start Import
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
