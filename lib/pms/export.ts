import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { formatWATDate } from "@/lib/utils/date"

const log = logger("pms-export")

export type PmsExportRow = Record<string, string | number | null | undefined>

export async function exportPmsRowsToExcel(rows: PmsExportRow[], filename: string) {
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "PMS")
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${filename}.xlsx`
    )
    toast.success("Exported to Excel")
  } catch (error) {
    log.error({ err: String(error) }, "Failed to export PMS rows to Excel")
    toast.error("Failed to export to Excel")
  }
}

export async function exportPmsRowsToPdf(rows: PmsExportRow[], filename: string, title: string) {
  try {
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default
    const doc = new jsPDF({ orientation: "landscape" })
    const headers = Object.keys(rows[0] || {})
    const body = rows.map((row) => headers.map((header) => String(row[header] ?? "-")))

    doc.setFontSize(16)
    doc.text(title, 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${formatWATDate(new Date())}`, 14, 22)

    autoTable(doc, {
      head: [headers],
      body,
      startY: 28,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [22, 101, 52], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    doc.save(`${filename}.pdf`)
    toast.success("Exported to PDF")
  } catch (error) {
    log.error({ err: String(error) }, "Failed to export PMS rows to PDF")
    toast.error("Failed to export to PDF")
  }
}
