import { toast } from "sonner"
import { formatName } from "@/lib/utils"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { getDepartmentForOffice } from "@/lib/office-locations"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("assets-export")

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AssetExportRow = Record<string, unknown>
export type EmployeeExportRow = Record<string, unknown>

export interface AssetExportOptions {
  selectedColumns: Record<string, boolean>
  employees: { id: string; department?: string; first_name: string; last_name: string }[]
  getDepartmentForOffice: (loc: string) => string | null
}

export interface AssetForExport {
  unique_code: string
  asset_type: string
  asset_model?: string
  serial_number?: string
  acquisition_year: number
  status: string
  unresolved_issues_count?: number
  assignment_type?: string
  department?: string
  office_location?: string
  current_assignment?: {
    assigned_to?: string
    department?: string
    office_location?: string
    assignment_type?: string
  }
}

export interface EmployeeReportInput {
  employees: { id: string; first_name: string; last_name: string; department?: string }[]
  assets: { asset_type: string; current_assignment?: { assigned_to?: string } }[]
  selectedTypes: Record<string, boolean>
  assetTypeMap: Record<string, { label: string }>
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors component helpers, but pure)
// ---------------------------------------------------------------------------

function effectiveAssignmentType(asset: AssetForExport): string {
  return (asset.current_assignment?.assignment_type || asset.assignment_type || "").toLowerCase()
}

/**
 * Resolve the human-readable "Assigned To" label for a single asset.
 * Pass employees from the export options to look up user names.
 */
export function getAssignedToLabel(
  asset: AssetForExport,
  withStatusSuffix: boolean,
  employees: { id: string; first_name: string; last_name: string }[]
): string {
  const isAssignedLike = asset.status === "assigned" || asset.status === "retired" || asset.status === "maintenance"
  if (!isAssignedLike) return "Unassigned"

  const statusSuffix =
    withStatusSuffix && (asset.status === "retired" || asset.status === "maintenance") ? ` (${asset.status})` : ""

  const assignmentType = effectiveAssignmentType(asset)

  if (assignmentType === "office") {
    return `${asset.current_assignment?.office_location || asset.office_location || "Office"}${statusSuffix}`
  }

  if (assignmentType === "department") {
    return `${asset.current_assignment?.department || asset.department || "Assigned Department"}${statusSuffix}`
  }

  // Individual — look up the name
  const assignedId = asset.current_assignment?.assigned_to
  if (assignedId) {
    const emp = employees.find((e) => e.id === assignedId)
    const firstName = emp?.first_name || ""
    const lastName = emp?.last_name || ""
    const fullName = `${formatName(firstName)} ${formatName(lastName)}`.trim()
    if (fullName) return `${fullName}${statusSuffix}`
  }

  if (asset.current_assignment?.department) {
    return `${asset.current_assignment.department}${statusSuffix}`
  }

  return `Assigned${statusSuffix}`
}

/**
 * Resolve the department for a single asset, following the same logic as the
 * component's export functions.
 */
function resolveAssetDepartment(asset: AssetForExport, employees: { id: string; department?: string }[]): string {
  if (asset.assignment_type === "individual" && asset.current_assignment?.assigned_to) {
    const emp = employees.find((e) => e.id === asset.current_assignment!.assigned_to)
    return emp?.department || "-"
  }

  if (asset.assignment_type === "department") {
    return asset.current_assignment?.department || asset.department || "-"
  }

  if (asset.assignment_type === "office" && asset.office_location) {
    return getDepartmentForOffice(asset.office_location) || "-"
  }

  return asset.current_assignment?.department || asset.department || "-"
}

// ---------------------------------------------------------------------------
// 1. buildAssetExportRows — build the flat row array
// ---------------------------------------------------------------------------

/**
 * Build the flat row array used by Excel / PDF / Word export.
 * The caller must pass the assets already sorted and filtered.
 */
export function buildAssetExportRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assets: any[],
  opts: AssetExportOptions,
  getAssignedToLabelFn?: (asset: AssetForExport, withStatus: boolean) => string
): AssetExportRow[] {
  const { selectedColumns, employees } = opts

  return assets.map((asset, index) => {
    const row: AssetExportRow = {}

    if (selectedColumns["#"]) row["#"] = index + 1
    if (selectedColumns["Unique Code"]) row["Unique Code"] = asset.unique_code
    if (selectedColumns["Asset Type"]) row["Asset Type"] = ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type
    if (selectedColumns["Model"]) row["Model"] = asset.asset_model || "-"
    if (selectedColumns["Serial Number"]) row["Serial Number"] = asset.serial_number || "-"
    if (selectedColumns["Year"]) row["Year"] = asset.acquisition_year
    if (selectedColumns["Status"]) row["Status"] = asset.status
    if (selectedColumns["Assigned To"]) {
      row["Assigned To"] = getAssignedToLabelFn
        ? getAssignedToLabelFn(asset, true)
        : getAssignedToLabel(asset, true, employees)
    }
    if (selectedColumns["Department"]) {
      row["Department"] = resolveAssetDepartment(asset, employees)
    }
    if (selectedColumns["Office Location"]) {
      row["Office Location"] = asset.current_assignment?.office_location || asset.office_location || "-"
    }
    if (selectedColumns["Issues"]) {
      row["Issues"] = asset.unresolved_issues_count
        ? `${asset.unresolved_issues_count} issue${asset.unresolved_issues_count > 1 ? "s" : ""}`
        : "-"
    }

    return row
  })
}

// ---------------------------------------------------------------------------
// 2. exportAssetsToExcel
// ---------------------------------------------------------------------------

/** Excel export — call with pre-built rows */
export async function exportAssetsToExcel(rows: AssetExportRow[], filename?: string): Promise<void> {
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Assets")

    const maxWidth = 50
    const cols = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.min(Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)), maxWidth),
    }))
    ws["!cols"] = cols

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const data = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    saveAs(data, filename ?? `assets-export-${toLocalISODate()}.xlsx`)
    toast.success("Assets exported to Excel successfully")
  } catch (error: unknown) {
    log.error("Error exporting to Excel:", error)
    toast.error("Failed to export to Excel")
  }
}

// ---------------------------------------------------------------------------
// 3. exportAssetsToPDF
// ---------------------------------------------------------------------------

/** PDF export — call with pre-built rows + header labels */
export async function exportAssetsToPDF(
  rows: AssetExportRow[],
  filename?: string,
  extraMeta?: { total: number }
): Promise<void> {
  try {
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default

    const doc = new jsPDF({ orientation: "landscape" })

    doc.setFontSize(16)
    doc.text("Assets Report", 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 22)
    doc.text(`Total Assets: ${extraMeta?.total ?? rows.length}`, 14, 28)

    const headers = Object.keys(rows[0] || {})
    const body = rows.map((row) => headers.map((h) => String(row[h] ?? "")))

    autoTable(doc, {
      head: [headers],
      body,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 139, 34], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    doc.save(filename ?? `assets-export-${toLocalISODate()}.pdf`)
    toast.success("Assets exported to PDF successfully")
  } catch (error: unknown) {
    log.error("Error exporting to PDF:", error)
    toast.error("Failed to export to PDF")
  }
}

// ---------------------------------------------------------------------------
// 4. exportAssetsToWord
// ---------------------------------------------------------------------------

/** Word export */
export async function exportAssetsToWord(rows: AssetExportRow[], filename?: string): Promise<void> {
  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType, AlignmentType, HeadingLevel } =
      await import("docx")
    const { default: saveAs } = await import("file-saver")

    const columnKeys = Object.keys(rows[0] || {})

    // Header row
    const headerCells = columnKeys.map(
      (key) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: key, bold: true })] })],
        })
    )

    const tableRows = [
      new TableRow({ children: headerCells }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: columnKeys.map(
              (key) =>
                new TableCell({
                  children: [new Paragraph(String(row[key] ?? ""))],
                })
            ),
          })
      ),
    ]

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "Assets Report",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Generated on: ${new Date().toLocaleDateString()}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Total Assets: ${rows.length}`,
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
    saveAs(blob, filename ?? `assets-export-${toLocalISODate()}.docx`)
    toast.success("Assets exported to Word successfully")
  } catch (error: unknown) {
    log.error("Error exporting to Word:", error)
    toast.error("Failed to export to Word")
  }
}

// ---------------------------------------------------------------------------
// Internal: build employee report rows
// ---------------------------------------------------------------------------

function buildEmployeeReportRows(input: EmployeeReportInput): {
  rows: EmployeeExportRow[]
  assetTypesInReport: string[]
} {
  const { employees, assets, selectedTypes, assetTypeMap } = input

  const assetTypesInReport = Object.keys(selectedTypes).filter((t) => selectedTypes[t])

  // Initialize employee -> asset type -> list of unique codes
  const employeeAssetMap: Record<string, Record<string, string[]>> = {}
  employees.forEach((emp) => {
    employeeAssetMap[emp.id] = {}
    assetTypesInReport.forEach((type) => {
      employeeAssetMap[emp.id][type] = []
    })
  })

  // Populate
  assets.forEach((asset) => {
    const assigneeId = asset.current_assignment?.assigned_to
    if (assigneeId && employeeAssetMap[assigneeId] && assetTypesInReport.includes(asset.asset_type)) {
      ;(employeeAssetMap[assigneeId][asset.asset_type] as string[]).push(
        (asset as unknown as { unique_code: string }).unique_code
      )
    }
  })

  const rows: EmployeeExportRow[] = employees.map((member, index) => {
    const row: EmployeeExportRow = {
      "#": index + 1,
      "Employee Name": `${formatName(member.last_name)}, ${formatName(member.first_name)}`,
      Department: member.department || "-",
    }

    assetTypesInReport.forEach((typeCode) => {
      const typeName = assetTypeMap[typeCode]?.label || typeCode
      const codes = employeeAssetMap[member.id]?.[typeCode] || []
      row[typeName] = codes.length > 0 ? codes.join(", ") : "-"
    })

    return row
  })

  return { rows, assetTypesInReport }
}

// ---------------------------------------------------------------------------
// 5. exportEmployeeReportToExcel
// ---------------------------------------------------------------------------

export async function exportEmployeeReportToExcel(input: EmployeeReportInput, filename?: string): Promise<void> {
  try {
    const XLSX = await import("@e965/xlsx")
    const { default: saveAs } = await import("file-saver")

    const { rows } = buildEmployeeReportRows(input)

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Employee Assets Report")

    const maxWidth = 50
    const cols = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.min(Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)), maxWidth),
    }))
    ws["!cols"] = cols

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const data = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    saveAs(data, filename ?? `employees-assets-report-${toLocalISODate()}.xlsx`)
    toast.success("Employee Assets Report exported to Excel successfully")
  } catch (error: unknown) {
    log.error("Error exporting Employee Report to Excel:", error)
    toast.error("Failed to export Employee Report to Excel")
  }
}

// ---------------------------------------------------------------------------
// 6. exportEmployeeReportToPDF
// ---------------------------------------------------------------------------

export async function exportEmployeeReportToPDF(input: EmployeeReportInput, filename?: string): Promise<void> {
  try {
    const jsPDF = (await import("jspdf")).default
    const autoTable = (await import("jspdf-autotable")).default

    const { rows, assetTypesInReport } = buildEmployeeReportRows(input)

    const doc = new jsPDF({ orientation: "landscape" })

    doc.setFontSize(16)
    doc.text("Employee Assets Report", 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 22)
    const assetTypesLabel = assetTypesInReport.map((t) => input.assetTypeMap[t]?.label || t).join(", ")
    doc.text(`Asset Types: ${assetTypesLabel}`, 14, 28)
    doc.text(`Total Employee: ${input.employees.length}`, 14, 34)

    const headers = Object.keys(rows[0] || {})
    const body = rows.map((row) => headers.map((h) => String(row[h] ?? "")))

    autoTable(doc, {
      head: [headers],
      body,
      startY: 40,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 139, 34] },
    })

    doc.save(filename ?? `employees-assets-report-${toLocalISODate()}.pdf`)
    toast.success("Employee Assets Report exported to PDF successfully")
  } catch (error: unknown) {
    log.error("Error exporting Employee Report to PDF:", error)
    toast.error("Failed to export Employee Report to PDF")
  }
}

// ---------------------------------------------------------------------------
// 7. exportEmployeeReportToWord
// ---------------------------------------------------------------------------

export async function exportEmployeeReportToWord(input: EmployeeReportInput, filename?: string): Promise<void> {
  try {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType } =
      await import("docx")
    const { default: saveAs } = await import("file-saver")

    const { rows, assetTypesInReport } = buildEmployeeReportRows(input)

    const columnKeys = Object.keys(rows[0] || {})

    const headerCells = columnKeys.map(
      (key) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: key, bold: true })] })],
        })
    )

    const tableRows = [
      new TableRow({ children: headerCells }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: columnKeys.map(
              (key) =>
                new TableCell({
                  children: [new Paragraph(String(row[key] ?? ""))],
                })
            ),
          })
      ),
    ]

    const assetTypesLabel = assetTypesInReport.map((t) => input.assetTypeMap[t]?.label || t).join(", ")

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "Employee Assets Report",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Generated on: ${new Date().toLocaleDateString()}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Asset Types: ${assetTypesLabel}`,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Total Employee: ${input.employees.length}`,
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
    saveAs(blob, filename ?? `employees-assets-report-${toLocalISODate()}.docx`)
    toast.success("Employee Assets Report exported to Word successfully")
  } catch (error: unknown) {
    log.error("Error exporting Employee Report to Word:", error)
    toast.error("Failed to export Employee Report to Word")
  }
}
