/**
 * @deprecated Client-side exports expose sensitive data to the browser.
 * Use the server-side endpoint POST /api/admin/employees/export instead.
 * This file is kept for backwards compatibility during migration.
 */
import { formatName } from "@/lib/utils"
import { getRoleDisplayName } from "@/lib/permissions"
import { logger } from "@/lib/logger"
import { toast } from "sonner"
import type { UserRole, EmploymentStatus } from "@/types/database"
import { toLocalISODate } from "@/lib/utils/date"

export interface Employee {
  id: string
  employee_number: string | null
  first_name: string
  last_name: string
  other_names: string | null
  company_email: string
  additional_email: string | null
  department: string
  designation: string | null
  role: UserRole
  admin_domains?: string[] | null
  phone_number: string | null
  additional_phone: string | null
  residential_address: string | null
  office_location: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  date_of_birth: string | null
  employment_date: string | null
  is_admin: boolean
  is_department_lead: boolean
  lead_departments: string[]
  employment_status: EmploymentStatus
  created_at: string
}

export interface ExportOptions {
  selectedColumns: Record<string, boolean>
}

const log = logger("employees-export")

/** Build flat export rows from employee list + selected columns */
export function buildEmployeeExportRows(employees: Employee[], opts: ExportOptions): Record<string, unknown>[] {
  const { selectedColumns } = opts
  return employees.map((member, index) => {
    const row: Record<string, unknown> = {}
    if (selectedColumns["#"]) row["#"] = index + 1
    if (selectedColumns["Employee No."]) row["Employee No."] = member.employee_number || "-"
    if (selectedColumns["Last Name"]) row["Last Name"] = formatName(member.last_name) || "-"
    if (selectedColumns["First Name"]) row["First Name"] = formatName(member.first_name) || "-"
    if (selectedColumns["Other Names"]) row["Other Names"] = member.other_names || "-"
    if (selectedColumns["Email"]) row["Email"] = member.company_email || "-"
    if (selectedColumns["Additional Email"]) row["Additional Email"] = member.additional_email || "-"
    if (selectedColumns["Department"]) row["Department"] = member.department || "-"
    if (selectedColumns["Role"]) row["Role"] = getRoleDisplayName(member.role)
    if (selectedColumns["Designation"]) row["Designation"] = member.designation || "-"
    if (selectedColumns["Phone Number"]) row["Phone Number"] = member.phone_number || "-"
    if (selectedColumns["Additional Phone"]) row["Additional Phone"] = member.additional_phone || "-"
    if (selectedColumns["Residential Address"]) row["Residential Address"] = member.residential_address || "-"
    if (selectedColumns["Office Location"]) row["Office Location"] = member.office_location || "-"
    if (selectedColumns["Bank Name"]) row["Bank Name"] = member.bank_name || "-"
    if (selectedColumns["Bank Account Number"]) row["Bank Account Number"] = member.bank_account_number || "-"
    if (selectedColumns["Bank Account Name"]) row["Bank Account Name"] = member.bank_account_name || "-"
    if (selectedColumns["Date of Birth"]) row["Date of Birth"] = member.date_of_birth || "-"
    if (selectedColumns["Employment Date"]) row["Employment Date"] = member.employment_date || "-"
    if (selectedColumns["Is Lead"]) row["Is Lead"] = member.is_department_lead ? "Yes" : "No"
    if (selectedColumns["Lead Departments"])
      row["Lead Departments"] = member.lead_departments?.length ? member.lead_departments.join(", ") : "-"
    if (selectedColumns["Created At"])
      row["Created At"] = member.created_at ? new Date(member.created_at).toLocaleDateString() : "-"
    return row
  })
}

/** Excel export */
export async function exportEmployeesToExcel(rows: Record<string, unknown>[], filename?: string): Promise<void> {
  try {
    if (rows.length === 0) {
      toast.error("No employees data to export")
      return
    }

    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Employees")

    const maxWidth = 60
    const cols = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.min(Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)), maxWidth),
    }))
    ws["!cols"] = cols

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const data = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const outputFilename = filename ? `${filename}.xlsx` : `employees-export-${toLocalISODate()}.xlsx`
    saveAs(data, outputFilename)
    toast.success("Employees exported to Excel successfully")
  } catch (error: unknown) {
    log.error({ err: String(error) }, "error exporting to excel")
    toast.error("Failed to export employees to Excel")
  }
}

/** PDF export */
export async function exportEmployeesToPDF(
  employees: Employee[],
  opts: ExportOptions,
  filename?: string
): Promise<void> {
  try {
    if (employees.length === 0) {
      toast.error("No employees data to export")
      return
    }

    const { selectedColumns } = opts
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default

    const doc = new jsPDF({ orientation: "landscape" })
    doc.setFontSize(16)
    doc.text("ACOB Employee Report", 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 22)
    doc.text(`Total Employees: ${employees.length}`, 14, 28)

    const dataToExport = employees.map((member, index) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any[] = []
      const headers: string[] = []

      if (selectedColumns["#"]) {
        row.push(index + 1)
        headers.push("#")
      }
      if (selectedColumns["Employee No."]) {
        row.push(member.employee_number || "-")
        headers.push("Employee No.")
      }
      if (selectedColumns["Last Name"]) {
        row.push(formatName(member.last_name) || "-")
        headers.push("Last Name")
      }
      if (selectedColumns["First Name"]) {
        row.push(formatName(member.first_name) || "-")
        headers.push("First Name")
      }
      if (selectedColumns["Other Names"]) {
        row.push(member.other_names || "-")
        headers.push("Other Names")
      }
      if (selectedColumns["Email"]) {
        row.push(member.company_email || "-")
        headers.push("Email")
      }
      if (selectedColumns["Additional Email"]) {
        row.push(member.additional_email || "-")
        headers.push("Additional Email")
      }
      if (selectedColumns["Department"]) {
        row.push(member.department || "-")
        headers.push("Department")
      }
      if (selectedColumns["Role"]) {
        row.push(getRoleDisplayName(member.role))
        headers.push("Role")
      }
      if (selectedColumns["Designation"]) {
        row.push(member.designation || "-")
        headers.push("Designation")
      }
      if (selectedColumns["Phone Number"]) {
        row.push(member.phone_number || "-")
        headers.push("Phone Number")
      }
      if (selectedColumns["Additional Phone"]) {
        row.push(member.additional_phone || "-")
        headers.push("Additional Phone")
      }
      if (selectedColumns["Residential Address"]) {
        row.push(member.residential_address || "-")
        headers.push("Residential Address")
      }
      if (selectedColumns["Office Location"]) {
        row.push(member.office_location || "-")
        headers.push("Office Location")
      }
      if (selectedColumns["Bank Name"]) {
        row.push(member.bank_name || "-")
        headers.push("Bank Name")
      }
      if (selectedColumns["Bank Account Number"]) {
        row.push(member.bank_account_number || "-")
        headers.push("Bank Account Number")
      }
      if (selectedColumns["Bank Account Name"]) {
        row.push(member.bank_account_name || "-")
        headers.push("Bank Account Name")
      }
      if (selectedColumns["Date of Birth"]) {
        row.push(member.date_of_birth || "-")
        headers.push("Date of Birth")
      }
      if (selectedColumns["Employment Date"]) {
        row.push(member.employment_date || "-")
        headers.push("Employment Date")
      }
      if (selectedColumns["Is Lead"]) {
        row.push(member.is_department_lead ? "Yes" : "No")
        headers.push("Is Lead")
      }
      if (selectedColumns["Lead Departments"]) {
        row.push(member.lead_departments?.length ? member.lead_departments.join(", ") : "-")
        headers.push("Lead Departments")
      }
      if (selectedColumns["Created At"]) {
        row.push(member.created_at ? new Date(member.created_at).toLocaleDateString() : "-")
        headers.push("Created At")
      }

      return { row, headers }
    })

    const headers = dataToExport[0]?.headers || []
    const body = dataToExport.map((d) => d.row)

    autoTable(doc, {
      head: [headers],
      body: body,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 197, 94], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    const outputFilename = filename ? `${filename}.pdf` : `acob-employee-report-${toLocalISODate()}.pdf`
    doc.save(outputFilename)
    toast.success("Employees exported to PDF successfully")
  } catch (error: unknown) {
    log.error({ err: String(error) }, "error exporting to pdf")
    toast.error("Failed to export employees to PDF")
  }
}

/** Word export */
export async function exportEmployeesToWord(rows: Record<string, unknown>[], filename?: string): Promise<void> {
  try {
    if (rows.length === 0) {
      toast.error("No employees data to export")
      return
    }

    const {
      Document,
      Packer,
      Paragraph,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Table,
      TableCell,
      TableRow,
      WidthType,
      AlignmentType,
      HeadingLevel,
      TextRun,
    } = await import("docx")
    const { default: saveAs } = await import("file-saver")

    const columnKeys = Object.keys(rows[0] || {})

    // Build header row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headerCells: any[] = columnKeys.map(
      (column) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: column, bold: true })] })],
        })
    )

    const tableRows = [
      new TableRow({ children: headerCells }),
      ...rows.map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rowCells: any[] = columnKeys.map(
          (column) => new TableCell({ children: [new Paragraph(String(row[column] ?? "-"))] })
        )
        return new TableRow({ children: rowCells })
      }),
    ]

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "ACOB Employee Report",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Generated on: ${new Date().toLocaleDateString()}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Total Employees: ${rows.length}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: "" }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: tableRows,
            }),
          ],
        },
      ],
    })

    const blob = await Packer.toBlob(doc)
    const outputFilename = filename ? `${filename}.docx` : `employees-export-${toLocalISODate()}.docx`
    saveAs(blob, outputFilename)
    toast.success("Employee exported to Word successfully")
  } catch (error: unknown) {
    log.error({ err: String(error) }, "error exporting to word")
    toast.error("Failed to export employees to Word")
  }
}
