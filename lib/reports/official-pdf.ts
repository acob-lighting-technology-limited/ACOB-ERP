import { Buffer } from "node:buffer"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ActionItem } from "@/lib/export-utils"
import { logger } from "@/lib/logger"
import { getOneDriveService } from "@/lib/onedrive"
import { buildGeneratedReportExportPath } from "@/lib/reports/document-storage"
import { formatMeetingDateLabel, resolveEffectiveMeetingDateIso } from "@/lib/reports/meeting-date"
import { generateActionPointsPdfFromDocxBuffer } from "@/lib/reports/action-points-word-pdf"
import { fetchActionTrackerItems } from "@/lib/reports/action-tracker-data"
import { buildWeeklyReportPDF, fetchLogoPair, type WeeklyReportRow } from "@/lib/reports/weekly-report-pdf"
import { generateWeeklyReportDocxBuffer } from "@/lib/reports/weekly-report-docx"

const log = logger("reports-official-pdf")

export type OfficialReportExportType = "weekly_report" | "action_point"
type ReportsPdfClient = Pick<SupabaseClient, "from" | "rpc">
type TimestampedRow = { updated_at?: string | null; created_at?: string | null }
type WeeklyReportTaskSourceRow = {
  id: string
  department: string | null
  tasks_new_week: string | null
}

function getNewestIsoTimestamp(rows: TimestampedRow[]): string | null {
  let newestTime = Number.NEGATIVE_INFINITY
  let newestIso: string | null = null

  for (const row of rows) {
    const candidate = row.updated_at || row.created_at || null
    if (!candidate) continue

    const time = Date.parse(candidate)
    if (Number.isNaN(time) || time <= newestTime) continue

    newestTime = time
    newestIso = candidate
  }

  return newestIso
}

function parseTasksNewWeekLines(tasksNewWeek: string): string[] {
  return tasksNewWeek
    .split(/\r?\n/)
    .map((line) => line.replace(/^(?:\s*(?:\d+[.)]\s*|[-*]\s*))+/, "").trim())
    .filter(Boolean)
}

export async function fetchActionPointRows(supabase: ReportsPdfClient, week: number, year: number) {
  // The official Action Points report is the department-by-department weekly
  // sheet. Management directives are tracked and exported as their own category
  // from the Action Tracker rather than being folded into these rows.
  const actions = await fetchActionTrackerItems(supabase, { week, year, origin: "weekly_report" })
  return actions.map((action) => ({
    id: action.id,
    title: action.title || null,
    department: action.department,
    status: action.status,
    week_number: action.week_number,
    year: action.year,
  }))
}

export async function resolveOfficialReportExportMeta(
  supabase: ReportsPdfClient,
  params: {
    week: number
    year: number
    type: OfficialReportExportType
    department?: string
    extension?: "pdf" | "docx"
  }
) {
  const { week, year, type, department, extension = "pdf" } = params
  const meetingDateIso = await resolveEffectiveMeetingDateIso(supabase, week, year)
  const meetingDateLabel = formatMeetingDateLabel(meetingDateIso)
  const departmentLabel = department ? `${department} - ` : ""
  const filename =
    type === "weekly_report"
      ? `ACOB Weekly Reports - ${departmentLabel}${meetingDateLabel} - W${week}.${extension}`
      : `ACOB Action Points - ${departmentLabel}${meetingDateLabel} - W${week}.${extension}`
  const storagePath = buildGeneratedReportExportPath({
    meetingYear: year,
    meetingWeek: week,
    exportType: type === "weekly_report" ? "weekly-reports" : "action-points",
    department,
    fileName: filename,
  })

  return {
    filename,
    storagePath,
    meetingDateIso,
    meetingDateLabel,
  }
}

export async function resolveOfficialReportSourceUpdatedAt(
  supabase: ReportsPdfClient,
  params: { week: number; year: number; type: OfficialReportExportType; department?: string }
): Promise<string | null> {
  const { week, year, type, department } = params

  if (type === "weekly_report") {
    const reportsQuery = supabase
      .from("weekly_reports")
      .select("updated_at, created_at")
      .eq("week_number", week)
      .eq("year", year)
      .eq("status", "submitted")

    if (department) reportsQuery.eq("department", department)

    const reportsResult = await reportsQuery.returns<TimestampedRow[]>()

    if (reportsResult.error) throw new Error(reportsResult.error.message)
    return getNewestIsoTimestamp(reportsResult.data ?? [])
  }

  const actionItemsResult = await supabase
    .from("action_items")
    .select("updated_at, created_at")
    .eq("week_number", week)
    .eq("year", year)
    .returns<TimestampedRow[]>()

  if (actionItemsResult.error) throw new Error(actionItemsResult.error.message)
  const actionItemsTimestamp = getNewestIsoTimestamp(actionItemsResult.data ?? [])
  if (actionItemsTimestamp) return actionItemsTimestamp

  const weeklyReportsResult = await supabase
    .from("weekly_reports")
    .select("updated_at, created_at")
    .eq("week_number", week)
    .eq("year", year)
    .eq("status", "submitted")
    .returns<TimestampedRow[]>()
  if (weeklyReportsResult.error) throw new Error(weeklyReportsResult.error.message)
  return getNewestIsoTimestamp(weeklyReportsResult.data ?? [])
}

export async function buildOfficialReportPdf(
  supabase: ReportsPdfClient,
  params: { week: number; year: number; type: OfficialReportExportType; department?: string }
) {
  const { week, year, type, department } = params
  const { filename, storagePath, meetingDateIso, meetingDateLabel } = await resolveOfficialReportExportMeta(
    supabase,
    params
  )

  let pdfBytes: Uint8Array

  if (type === "weekly_report") {
    const reportsQuery = supabase
      .from("weekly_reports")
      .select("id, department, week_number, year, work_done, tasks_new_week, challenges, status")
      .eq("week_number", week)
      .eq("year", year)
      .eq("status", "submitted")
      .order("department", { ascending: true })

    if (department) reportsQuery.eq("department", department)

    const [{ coverLogoBytes, headerLogoBytes }, reportsResult] = await Promise.all([fetchLogoPair(), reportsQuery])

    if (reportsResult.error) throw new Error(reportsResult.error.message)

    const reports = (reportsResult.data ?? []) as WeeklyReportRow[]
    if (reports.length === 0) {
      throw new Error(`No submitted weekly reports found for W${week}/${year}`)
    }

    pdfBytes = await buildWeeklyReportPDF(reports, week, year, meetingDateLabel, coverLogoBytes, headerLogoBytes)
  } else {
    let actions = await fetchActionPointRows(supabase, week, year)
    if (actions.length === 0) {
      const weeklyReportTasksResult = await supabase
        .from("weekly_reports")
        .select("id, department, tasks_new_week")
        .eq("week_number", week)
        .eq("year", year)
        .eq("status", "submitted")
        .returns<WeeklyReportTaskSourceRow[]>()

      if (weeklyReportTasksResult.error) throw new Error(weeklyReportTasksResult.error.message)

      const derivedActions = (weeklyReportTasksResult.data ?? []).flatMap((report) => {
        const lines = parseTasksNewWeekLines(report.tasks_new_week || "")
        return lines.map((title, index) => ({
          id: `${report.id}:${index + 1}`,
          title,
          department: report.department || "",
          status: "pending",
          week_number: week,
          year,
        }))
      })

      actions = derivedActions
    }

    if (actions.length === 0) {
      throw new Error(`No action points found for W${week}/${year}`)
    }

    const normalizedActions: ActionItem[] = actions.map((action) => ({
      id: String(action.id),
      title: typeof action.title === "string" ? action.title : "",
      department: String(action.department || ""),
      status: String(action.status || ""),
      week_number: Number(action.week_number || week),
      year: Number(action.year || year),
    }))
    pdfBytes = await generateActionPointsPdfFromDocxBuffer(normalizedActions, week, year, meetingDateIso)
  }

  return {
    pdfBytes,
    filename,
    storagePath,
  }
}

export async function buildOfficialWeeklyReportDocx(
  supabase: ReportsPdfClient,
  params: { week: number; year: number; department?: string }
) {
  const { week, year, department } = params
  const { filename, meetingDateLabel } = await resolveOfficialReportExportMeta(supabase, {
    week,
    year,
    type: "weekly_report",
    department,
    extension: "docx",
  })
  const reportsQuery = supabase
    .from("weekly_reports")
    .select("id, department, week_number, year, work_done, tasks_new_week, challenges, status")
    .eq("week_number", week)
    .eq("year", year)
    .eq("status", "submitted")
    .order("department", { ascending: true })

  if (department) reportsQuery.eq("department", department)

  const reportsResult = await reportsQuery.returns<WeeklyReportRow[]>()
  if (reportsResult.error) throw new Error(reportsResult.error.message)

  const reports = reportsResult.data ?? []
  if (reports.length === 0) {
    throw new Error(`No submitted weekly reports found for W${week}/${year}`)
  }

  return {
    docxBytes: await generateWeeklyReportDocxBuffer(reports, week, year, meetingDateLabel),
    filename,
  }
}

export async function tryReadStoredOfficialPdf(filePath: string): Promise<Uint8Array | null> {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) return null

  try {
    const downloadUrl = await onedrive.getDownloadUrl(filePath)
    const response = await fetch(downloadUrl)
    if (!response.ok) return null
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    log.warn({ err: String(error), filePath }, "Stored official PDF lookup failed")
    return null
  }
}

export async function tryReadCurrentStoredOfficialPdf(
  supabase: ReportsPdfClient,
  params: { week: number; year: number; type: OfficialReportExportType; department?: string }
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) return null

  const storedMeta = await resolveOfficialReportExportMeta(supabase, params)
  const sourceUpdatedAt = await resolveOfficialReportSourceUpdatedAt(supabase, params)

  try {
    const storedItem = await onedrive.getItem(storedMeta.storagePath)

    if (sourceUpdatedAt) {
      const sourceTime = Date.parse(sourceUpdatedAt)
      const storedTime = Date.parse(storedItem.lastModified || "")

      if (!Number.isNaN(sourceTime) && !Number.isNaN(storedTime) && storedTime < sourceTime) {
        return null
      }
    }

    const storedBytes = await tryReadStoredOfficialPdf(storedMeta.storagePath)
    if (!storedBytes) return null

    return {
      bytes: storedBytes,
      filename: storedMeta.filename,
    }
  } catch (error) {
    log.warn({ err: String(error), filePath: storedMeta.storagePath }, "Stored official PDF freshness check failed")
    return null
  }
}

export async function persistOfficialPdf(filePath: string, pdfBytes: Uint8Array): Promise<void> {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) return

  const folderPath = filePath.slice(0, filePath.lastIndexOf("/"))
  await onedrive.createFolder(folderPath)
  await onedrive.uploadFile(filePath, pdfBytes, "application/pdf")
}

export function buildPdfDownloadResponse(pdfBytes: Uint8Array, filename: string) {
  const safeFilename = encodeURIComponent(filename)
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`,
    },
  })
}

export function buildDocxDownloadResponse(docxBytes: Uint8Array, filename: string) {
  const safeFilename = encodeURIComponent(filename)
  return new NextResponse(Buffer.from(docxBytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`,
    },
  })
}
