import { saveAs } from "file-saver"
import { apiFetch } from "@/lib/api-client"
import type { ActionItem } from "@/lib/export-utils"

const inFlightActionPointDownloads = new Set<string>()

async function downloadActionPointsExport(
  format: "docx" | "pdf",
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string,
  department?: string
) {
  const exportKey = [format, week, year, meetingDate || "", department || "all", actions.length].join(":")

  if (inFlightActionPointDownloads.has(exportKey)) return
  inFlightActionPointDownloads.add(exportKey)

  try {
    const response = await apiFetch("/api/reports/action-points-export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format,
        actions,
        week,
        year,
        meetingDate,
        department,
        persist: format === "pdf",
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      try {
        const parsed = JSON.parse(detail) as { error?: string }
        throw new Error(parsed.error || `Failed to export Action Points as ${format.toUpperCase()}`)
      } catch {
        throw new Error(detail || `Failed to export Action Points as ${format.toUpperCase()}`)
      }
    }

    const blob = await response.blob()
    const disposition = response.headers.get("Content-Disposition") || ""
    const fileNameMatch = disposition.match(/filename="([^"]+)"/i)
    const fileName = fileNameMatch?.[1] || `action-points.${format}`
    saveAs(blob, fileName)
  } finally {
    inFlightActionPointDownloads.delete(exportKey)
  }
}

export const exportActionPointsDocx = (
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string,
  department?: string
) => downloadActionPointsExport("docx", actions, week, year, meetingDate, department)

export const exportActionPointsPdf = (
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string,
  department?: string
) => downloadActionPointsExport("pdf", actions, week, year, meetingDate, department)
