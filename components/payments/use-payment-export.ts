"use client"

import { logger } from "@/lib/logger"
import { format, parseISO, isValid } from "date-fns"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "@e965/xlsx"
import { toast } from "sonner"

const log = logger("payment-export")

interface ExportPayment {
  id: string
  title: string
  payment_type: "one-time" | "recurring"
  issuer_name?: string
  amount: number
  amountDue: number
  currency: string
  status: string
  payment_date?: string
  next_payment_due?: string
  recurrence_period?: string
  payment_reference?: string
  department?: { name: string }
  documents?: {
    document_type: string
    applicable_date?: string
  }[]
}

export function usePaymentExport(
  payments: ExportPayment[],
  selectedColumns: Record<string, boolean>,
  onDone: () => void
) {
  const formatDateForExport = (dateStr: string | undefined) => {
    if (!dateStr) return "-"
    const date = parseISO(dateStr)
    if (!isValid(date)) return "-"
    return format(date, "dd-MM-yyyy")
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getExportData = () => {
    return payments.map((p, index) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: Record<string, any> = {}
      const receipts = p.documents?.filter((d) => d.document_type === "receipt" && d.applicable_date) || []

      let firstPaymentDate = "-"
      let numberOfPayments = 0

      if (receipts.length > 0) {
        const sortedReceipts = [...receipts].sort((a, b) => {
          const dateA = a.applicable_date ? new Date(a.applicable_date).getTime() : 0
          const dateB = b.applicable_date ? new Date(b.applicable_date).getTime() : 0
          return dateA - dateB
        })
        firstPaymentDate = formatDateForExport(sortedReceipts[0].applicable_date)
        numberOfPayments = receipts.length
      }

      if (selectedColumns["#"]) row["#"] = index + 1
      if (selectedColumns["Title"]) row["Title"] = p.title
      if (selectedColumns["Issuer"]) row["Issuer"] = p.issuer_name || "-"
      if (selectedColumns["Department"]) row["Department"] = p.department?.name || "-"
      if (selectedColumns["Amount"]) row["Amount"] = p.amount
      if (selectedColumns["Amount Due"]) row["Amount Due"] = p.amountDue
      if (selectedColumns["Currency"]) row["Currency"] = p.currency
      if (selectedColumns["Type"]) row["Type"] = p.payment_type
      if (selectedColumns["Status"]) row["Status"] = p.status
      if (selectedColumns["First Payment Date"]) row["First Payment Date"] = firstPaymentDate
      if (selectedColumns["Number of Payments"]) row["Number of Payments"] = numberOfPayments
      if (selectedColumns["Next Due Date"]) {
        const nextDueDate = p.payment_type === "recurring" ? p.next_payment_due : p.payment_date
        row["Next Due Date"] = formatDateForExport(nextDueDate)
      }
      if (selectedColumns["Recurrence"]) row["Recurrence"] = p.recurrence_period || "-"
      if (selectedColumns["Reference"]) row["Reference"] = p.payment_reference || p.id.substring(0, 8)

      return row
    })
  }

  const exportToExcel = async () => {
    try {
      const dataToExport = getExportData()
      const ws = XLSX.utils.json_to_sheet(dataToExport)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Payments")

      const maxWidth = 50
      const cols = Object.keys(dataToExport[0] || {}).map((key) => ({
        wch: Math.min(
          Math.max(key.length, ...dataToExport.map((row) => String(row[key as keyof typeof row]).length)),
          maxWidth
        ),
      }))
      ws["!cols"] = cols

      XLSX.writeFile(wb, `payments-export-${format(new Date(), "yyyy-MM-dd")}.xlsx`)
      toast.success("Payments exported to Excel successfully")
      onDone()
    } catch (error) {
      log.error("Error exporting to Excel:", error)
      toast.error("Failed to export to Excel")
    }
  }

  const exportToPDF = async () => {
    try {
      const doc = new jsPDF({ orientation: "landscape" })
      doc.setFontSize(16)
      doc.text("Payments Report", 14, 15)
      doc.setFontSize(10)
      doc.text(`Generated on: ${format(new Date(), "dd-MM-yyyy")}`, 14, 22)
      doc.text(`Total Payments: ${payments.length}`, 14, 28)

      const headers: string[] = []
      if (selectedColumns["#"]) headers.push("#")
      if (selectedColumns["Title"]) headers.push("Title")
      if (selectedColumns["Issuer"]) headers.push("Issuer")
      if (selectedColumns["Department"]) headers.push("Department")
      if (selectedColumns["Amount"]) headers.push("Amount")
      if (selectedColumns["Amount Due"]) headers.push("Amount Due")
      if (selectedColumns["Currency"]) headers.push("Currency")
      if (selectedColumns["Type"]) headers.push("Type")
      if (selectedColumns["Status"]) headers.push("Status")
      if (selectedColumns["First Payment Date"]) headers.push("First Payment")
      if (selectedColumns["Number of Payments"]) headers.push("# Payments")
      if (selectedColumns["Next Due Date"]) headers.push("Next Due")
      if (selectedColumns["Recurrence"]) headers.push("Recurrence")
      if (selectedColumns["Reference"]) headers.push("Ref")

      const dataToExport = getExportData()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = dataToExport.map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rowData: any[] = []
        if (selectedColumns["#"]) rowData.push(row["#"])
        if (selectedColumns["Title"]) rowData.push(row["Title"])
        if (selectedColumns["Issuer"]) rowData.push(row["Issuer"])
        if (selectedColumns["Department"]) rowData.push(row["Department"])
        if (selectedColumns["Amount"]) rowData.push(`${row["Currency"]} ${row["Amount"].toLocaleString()}`)
        if (selectedColumns["Amount Due"]) rowData.push(`${row["Currency"]} ${row["Amount Due"].toLocaleString()}`)
        if (selectedColumns["Currency"]) rowData.push(row["Currency"])
        if (selectedColumns["Type"]) rowData.push(row["Type"])
        if (selectedColumns["Status"]) rowData.push(row["Status"])
        if (selectedColumns["First Payment Date"]) rowData.push(row["First Payment Date"])
        if (selectedColumns["Number of Payments"]) rowData.push(row["Number of Payments"])
        if (selectedColumns["Next Due Date"]) rowData.push(row["Next Due Date"])
        if (selectedColumns["Recurrence"]) rowData.push(row["Recurrence"])
        if (selectedColumns["Reference"]) rowData.push(row["Reference"])
        return rowData
      })

      autoTable(doc, {
        head: [headers],
        body: body,
        startY: 35,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [22, 163, 74], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 247, 250] },
      })

      doc.save(`payments-export-${format(new Date(), "yyyy-MM-dd")}.pdf`)
      toast.success("Payments exported to PDF successfully")
      onDone()
    } catch (error) {
      log.error("Error exporting to PDF:", error)
      toast.error("Failed to export to PDF")
    }
  }

  const handleExportConfirm = async (exportType: "excel" | "pdf") => {
    if (exportType === "excel") await exportToExcel()
    else if (exportType === "pdf") await exportToPDF()
  }

  return { handleExportConfirm }
}
