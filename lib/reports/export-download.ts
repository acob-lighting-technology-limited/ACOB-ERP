"use client"

import { saveAs } from "file-saver"
import { apiFetch } from "@/lib/api-client"

function readFilenameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const plainMatch = disposition.match(/filename="([^"]+)"/i) || disposition.match(/filename=([^;]+)/i)
  return plainMatch?.[1]?.trim() || fallback
}

async function downloadStoredReportPdf(
  path: string,
  fallbackFilename: string,
  body: Record<string, unknown>,
  formatLabel = "PDF"
): Promise<void> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    try {
      const parsed = JSON.parse(detail) as { error?: string }
      throw new Error(parsed.error || `Failed to export ${formatLabel}`)
    } catch {
      throw new Error(detail || `Failed to export ${formatLabel}`)
    }
  }

  const blob = await response.blob()
  const filename = readFilenameFromDisposition(response.headers.get("Content-Disposition"), fallbackFilename)
  saveAs(blob, filename)
}

export async function downloadWeeklyReportPdf(params: {
  week: number
  year: number
  department?: string
  fallbackFilename?: string
}) {
  return downloadStoredReportPdf(
    "/api/reports/weekly-report-export",
    params.fallbackFilename || `ACOB Weekly Reports - Week ${params.week}.pdf`,
    {
      week: params.week,
      year: params.year,
      type: "weekly_report",
      format: "pdf",
      department: params.department,
      persist: false,
    },
    "PDF"
  )
}

export async function downloadWeeklyReportDocx(params: {
  week: number
  year: number
  department?: string
  fallbackFilename?: string
}) {
  return downloadStoredReportPdf(
    "/api/reports/weekly-report-export",
    params.fallbackFilename || `ACOB Weekly Reports - Week ${params.week}.docx`,
    {
      week: params.week,
      year: params.year,
      type: "weekly_report",
      format: "docx",
      department: params.department,
      persist: false,
    },
    "DOCX"
  )
}

export async function downloadStoredActionPointsPdf(params: {
  actions: Array<Record<string, unknown>>
  week: number
  year: number
  meetingDate?: string
  department?: string
  fallbackFilename?: string
}) {
  return downloadStoredReportPdf(
    "/api/reports/action-points-export",
    params.fallbackFilename || `ACOB Action Points - Week ${params.week}.pdf`,
    {
      format: "pdf",
      actions: params.actions,
      week: params.week,
      year: params.year,
      meetingDate: params.meetingDate,
      department: params.department,
      persist: false,
    }
  )
}
