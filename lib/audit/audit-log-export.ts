/**
 * Audit log export functions (Excel, PDF, Word).
 * Extracted from admin-audit-logs-content.tsx so the 2000-line component
 * doesn't need to carry three full export implementations inline.
 */

import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { getNormalizedEntityTypeDisplay } from "@/lib/audit/entity-type-display"
import {
  getActionDisplay,
  formatAuditDate,
  getPerformedBy,
  getObjectIdentifier,
  getTargetDescription,
  getDepartmentLocation,
} from "@/lib/audit/audit-log-display"
import type { AuditLog } from "@/app/admin/audit-logs/types"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"

const log = logger("audit-log-export")

function buildExportRows(logs: AuditLog[]) {
  return logs.map((entry, index) => ({
    "#": index + 1,
    Action: getActionDisplay(entry),
    Module: getNormalizedEntityTypeDisplay(entry.entity_type),
    Object: getObjectIdentifier(entry),
    Target: getTargetDescription(entry),
    "Dept/Location": getDepartmentLocation(entry),
    By: getPerformedBy(entry),
    Date: formatAuditDate(entry.created_at),
  }))
}

export async function exportAuditLogsToExcel(logs: AuditLog[]): Promise<void> {
  if (logs.length === 0) {
    toast.error("No audit logs to export")
    return
  }
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")

    const dataToExport = buildExportRows(logs)
    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Audit Logs")

    const maxWidth = 50
    ws["!cols"] = Object.keys(dataToExport[0] || {}).map((key) => ({
      wch: Math.min(
        Math.max(key.length, ...dataToExport.map((row) => String(row[key as keyof typeof row]).length)),
        maxWidth
      ),
    }))

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `audit-logs-export-${toLocalISODate()}.xlsx`
    )
    toast.success("Audit logs exported to Excel successfully")
  } catch (error) {
    log.error("Error exporting to Excel:", error)
    toast.error("Failed to export to Excel")
  }
}

export async function exportAuditLogsToPDF(logs: AuditLog[]): Promise<void> {
  if (logs.length === 0) {
    toast.error("No audit logs to export")
    return
  }
  try {
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default

    const doc = new jsPDF({ orientation: "landscape" })
    doc.setFontSize(16)
    doc.text("Audit Logs Report", 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${formatWATDate(new Date())}`, 14, 22)
    doc.text(`Total Logs: ${logs.length}`, 14, 28)

    const rows = logs.map((entry, index) => [
      index + 1,
      getActionDisplay(entry),
      getNormalizedEntityTypeDisplay(entry.entity_type),
      getObjectIdentifier(entry),
      getTargetDescription(entry),
      getDepartmentLocation(entry),
      getPerformedBy(entry),
      formatAuditDate(entry.created_at),
    ])

    autoTable(doc, {
      head: [["#", "Action", "Module", "Object", "Target", "Dept/Location", "By", "Date"]],
      body: rows,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    doc.save(`audit-logs-export-${toLocalISODate()}.pdf`)
    toast.success("Audit logs exported to PDF successfully")
  } catch (error) {
    log.error("Error exporting to PDF:", error)
    toast.error("Failed to export to PDF")
  }
}

export async function exportAuditLogsToWord(logs: AuditLog[]): Promise<void> {
  if (logs.length === 0) {
    toast.error("No audit logs to export")
    return
  }
  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType, AlignmentType, HeadingLevel } =
      await import("docx")
    const { default: saveAs } = await import("file-saver")

    const headerRow = new TableRow({
      children: ["#", "Action", "Module", "Object", "Target", "Dept/Location", "By", "Date"].map(
        (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
      ),
    })

    const dataRows = logs.map(
      (entry, index) =>
        new TableRow({
          children: [
            String(index + 1),
            getActionDisplay(entry),
            getNormalizedEntityTypeDisplay(entry.entity_type),
            getObjectIdentifier(entry),
            getTargetDescription(entry),
            getDepartmentLocation(entry),
            getPerformedBy(entry),
            formatAuditDate(entry.created_at),
          ].map((text) => new TableCell({ children: [new Paragraph(text)] })),
        })
    )

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "Audit Logs Report",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Generated on: ${formatWATDate(new Date())}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: `Total Logs: ${logs.length}`, alignment: AlignmentType.CENTER }),
            new Paragraph({ text: "" }),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
          ],
        },
      ],
    })

    const blob = await Packer.toBlob(doc)
    saveAs(blob, `audit-logs-export-${toLocalISODate()}.docx`)
    toast.success("Audit logs exported to Word successfully")
  } catch (error) {
    log.error("Error exporting to Word:", error)
    toast.error("Failed to export to Word")
  }
}
