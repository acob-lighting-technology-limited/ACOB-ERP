import { sanitizeStoragePathSegment } from "@/lib/reports/meeting-date"

const REPORTS_LIBRARY = "reports"
const GENERAL_MEETING_FOLDER = "general-meeting"

type ReportDocumentType = "knowledge_sharing_session" | "minutes" | "attendance" | "transcript"
type GeneratedReportExportType = "weekly-reports" | "action-points"

function sanitizeName(name: string): string {
  return String(name || "document").replace(/[^a-zA-Z0-9._-]/g, "_")
}

function reportDocumentTypeFolder(documentType: ReportDocumentType): string {
  if (documentType === "knowledge_sharing_session") return "kss"
  if (documentType === "attendance") return "attendance"
  if (documentType === "transcript") return "transcript"
  return "minutes"
}

function generatedExportTypeFolder(exportType: GeneratedReportExportType): string {
  return exportType
}

export function buildReportDocumentPath(params: {
  meetingYear: number
  meetingWeek: number
  documentType: ReportDocumentType
  department?: string | null
  fileName: string
}) {
  const deptPath = params.department ? `/${sanitizeName(sanitizeStoragePathSegment(params.department))}` : ""
  const safeName = sanitizeName(sanitizeStoragePathSegment(params.fileName))
  return `/${REPORTS_LIBRARY}/${GENERAL_MEETING_FOLDER}/${params.meetingYear}/week-${params.meetingWeek}/${reportDocumentTypeFolder(params.documentType)}${deptPath}/${Date.now()}-${safeName}`
}

export function buildGeneratedReportExportPath(params: {
  meetingYear: number
  meetingWeek: number
  exportType: GeneratedReportExportType
  department?: string | null
  fileName: string
}) {
  const deptPath = params.department ? `/${sanitizeName(sanitizeStoragePathSegment(params.department))}` : ""
  const safeName = sanitizeName(sanitizeStoragePathSegment(params.fileName))
  return `/${REPORTS_LIBRARY}/${GENERAL_MEETING_FOLDER}/${params.meetingYear}/week-${params.meetingWeek}/${generatedExportTypeFolder(params.exportType)}${deptPath}/${safeName}`
}

export function isOneDriveReportDocumentPath(filePath: string | null | undefined): boolean {
  return String(filePath || "").startsWith(`/${REPORTS_LIBRARY}/`)
}
