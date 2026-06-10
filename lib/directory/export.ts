import { toast } from "sonner"
import { logger } from "@/lib/logger"

const log = logger("directory-export")

export interface DirectoryExportRow {
  Name: string
  Designation: string
  Department: string
  "Department Lead": string
  "Company Email": string
  "Additional Email": string
  Phone: string
  "Additional Phone": string
  Office: string
}

export async function exportDirectoryToExcel(rows: DirectoryExportRow[], filename: string): Promise<void> {
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Directory")
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${filename}.xlsx`
    )
    toast.success("Exported to Excel")
  } catch (error) {
    log.error({ err: String(error) }, "Failed to export directory to Excel")
    toast.error("Failed to export to Excel")
  }
}

export function exportDirectoryToCsv(rows: DirectoryExportRow[], filename: string): void {
  try {
    const headers = Object.keys(rows[0] ?? {})
    const escape = (cell: string) => `"${String(cell ?? "").replace(/"/g, '""')}"`
    const lines = [headers, ...rows.map((r) => headers.map((h) => (r as unknown as Record<string, string>)[h]))].map(
      (line) => line.map(escape).join(",")
    )
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${filename}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success("Exported to CSV")
  } catch (error) {
    log.error({ err: String(error) }, "Failed to export directory to CSV")
    toast.error("Failed to export to CSV")
  }
}
