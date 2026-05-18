import { toast } from "sonner"

import { logger } from "@/lib/logger"

const log = logger("lib-hooks-useDataExport")

interface ExportOptions {
  filename: string
  sheetName?: string
}

export function useDataExport<T extends Record<string, unknown>>() {
  const exportToExcel = async (data: T[], options: ExportOptions) => {
    try {
      if (data.length === 0) {
        toast.error("No data to export")
        return
      }

      const XLSX = await import("@e965/xlsx")
      const { default: saveAs } = await import("file-saver")

      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, options.sheetName || "Sheet1")

      // Auto-size columns
      const maxWidth = 50
      const cols = Object.keys(data[0] || {}).map((key) => ({
        wch: Math.min(Math.max(key.length, ...data.map((row) => String(row[key]).length)), maxWidth),
      }))
      ws["!cols"] = cols

      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
      const blob = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      saveAs(blob, `${options.filename}.xlsx`)
      toast.success("Excel file exported successfully")
    } catch (error) {
      log.error("Error exporting to Excel:", error)
      toast.error("Failed to export to Excel")
    }
  }

  const exportToPDF = async (data: T[], columns: { header: string; key: keyof T }[], options: ExportOptions) => {
    try {
      if (data.length === 0) {
        toast.error("No data to export")
        return
      }

      const { jsPDF } = await import("jspdf")
      const autoTable = (await import("jspdf-autotable")).default

      const doc = new jsPDF()

      const tableData = data.map((row) => columns.map((col) => String(row[col.key] || "")))

      autoTable(doc, {
        head: [columns.map((col) => col.header)],
        body: tableData,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [71, 85, 105] },
      })

      doc.save(`${options.filename}.pdf`)
      toast.success("PDF file exported successfully")
    } catch (error) {
      log.error("Error exporting to PDF:", error)
      toast.error("Failed to export to PDF")
    }
  }

  const exportToWord = async (data: T[], columns: { header: string; key: keyof T }[], options: ExportOptions) => {
    try {
      if (data.length === 0) {
        toast.error("No data to export")
        return
      }

      const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType } = await import("docx")
      const { default: saveAs } = await import("file-saver")

      const headerRow = new TableRow({
        children: columns.map(
          (col) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: col.header, bold: true })] })],
              width: { size: 100 / columns.length, type: WidthType.PERCENTAGE },
            })
        ),
      })

      const dataRows = data.map(
        (row) =>
          new TableRow({
            children: columns.map(
              (col) =>
                new TableCell({
                  children: [new Paragraph(String(row[col.key] || ""))],
                  width: { size: 100 / columns.length, type: WidthType.PERCENTAGE },
                })
            ),
          })
      )

      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...dataRows],
      })

      const doc = new Document({
        sections: [{ children: [table] }],
      })

      const blob = await Packer.toBlob(doc)
      saveAs(blob, `${options.filename}.docx`)
      toast.success("Word document exported successfully")
    } catch (error) {
      log.error("Error exporting to Word:", error)
      toast.error("Failed to export to Word")
    }
  }

  return { exportToExcel, exportToPDF, exportToWord }
}
