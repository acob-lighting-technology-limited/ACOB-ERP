import { toast } from "sonner"
import { logger } from "@/lib/logger"
import type { CorrespondenceRecord } from "@/types/correspondence"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"
import { formatName } from "@/lib/utils"

const log = logger("correspondence-export")

function getStatusLabel(status: string) {
  return status === "under_review" ? "Sent for review" : formatName(status)
}

function buildExportRows(records: CorrespondenceRecord[]) {
  return records.map((r, index) => ({
    "#": index + 1,
    Reference: ["approved", "sent", "filed"].includes(r.status) ? r.reference_number || "-" : "-",
    Type: formatName(r.letter_type || "external"),
    Status: getStatusLabel(r.status),
    Subject: r.subject || "-",
    Department: r.department_name || r.assigned_department_name || "-",
    Recipient: r.recipient_name ? `${r.recipient_name}${r.recipient_code ? ` (${r.recipient_code})` : ""}` : "-",
    "Created By": r.created_by_name || r.sender_name || "-",
    Date: r.created_at ? formatWATDate(r.created_at, { day: "2-digit", month: "short", year: "numeric" }) : "-",
    "Due Date": r.due_date || "-",
  }))
}

export async function exportCorrespondenceToExcel(records: CorrespondenceRecord[]): Promise<void> {
  if (records.length === 0) {
    toast.error("No records to export")
    return
  }
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")

    const dataToExport = buildExportRows(records)
    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Correspondence")

    const maxWidth = 50
    ws["!cols"] = Object.keys(dataToExport[0] || {}).map((key) => ({
      wch: Math.min(
        Math.max(key.length, ...dataToExport.map((row) => String(row[key as keyof typeof row] ?? "").length)),
        maxWidth
      ),
    }))

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `correspondence-export-${toLocalISODate()}.xlsx`
    )
    toast.success("Correspondence exported to Excel successfully")
  } catch (error) {
    log.error("Error exporting to Excel:", error)
    toast.error("Failed to export to Excel")
  }
}

export async function exportCorrespondenceToPDF(records: CorrespondenceRecord[]): Promise<void> {
  if (records.length === 0) {
    toast.error("No records to export")
    return
  }
  try {
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default

    const doc = new jsPDF({ orientation: "landscape" })
    doc.setFontSize(16)
    doc.text("Correspondence Report", 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${formatWATDate(new Date())}`, 14, 22)
    doc.text(`Total Records: ${records.length}`, 14, 28)

    const dataToExport = buildExportRows(records)
    const headers = Object.keys(dataToExport[0] || {})
    const body = dataToExport.map((row) => headers.map((h) => String(row[h as keyof typeof row] ?? "")))

    autoTable(doc, {
      head: [headers],
      body,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    doc.save(`correspondence-export-${toLocalISODate()}.pdf`)
    toast.success("Correspondence exported to PDF successfully")
  } catch (error) {
    log.error("Error exporting to PDF:", error)
    toast.error("Failed to export to PDF")
  }
}

export async function exportCorrespondenceToWord(records: CorrespondenceRecord[]): Promise<void> {
  if (records.length === 0) {
    toast.error("No records to export")
    return
  }
  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType, AlignmentType, HeadingLevel } =
      await import("docx")
    const { default: saveAs } = await import("file-saver")

    const dataToExport = buildExportRows(records)
    const headers = Object.keys(dataToExport[0] || {})

    const headerRow = new TableRow({
      children: headers.map(
        (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
      ),
    })

    const dataRows = dataToExport.map(
      (row) =>
        new TableRow({
          children: headers.map(
            (h) => new TableCell({ children: [new Paragraph(String(row[h as keyof typeof row] ?? ""))] })
          ),
        })
    )

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "Correspondence Report",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Generated on: ${formatWATDate(new Date())}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: `Total Records: ${records.length}`, alignment: AlignmentType.CENTER }),
            new Paragraph({ text: "" }),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
          ],
        },
      ],
    })

    const blob = await Packer.toBlob(doc)
    saveAs(blob, `correspondence-export-${toLocalISODate()}.docx`)
    toast.success("Correspondence exported to Word successfully")
  } catch (error) {
    log.error("Error exporting to Word:", error)
    toast.error("Failed to export to Word")
  }
}
