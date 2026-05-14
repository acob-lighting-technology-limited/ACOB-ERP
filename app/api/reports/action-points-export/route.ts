import { NextRequest, NextResponse } from "next/server"
import { Buffer } from "node:buffer"
import type { ActionItem } from "@/lib/export-utils"
import { logger } from "@/lib/logger"
import { getOneDriveService } from "@/lib/onedrive"
import { buildGeneratedReportExportPath } from "@/lib/reports/document-storage"
import { generateActionPointsDocxBuffer } from "@/lib/reports/action-points-template"
import { generateActionPointsPdfFromDocxBuffer } from "@/lib/reports/action-points-word-pdf"
import { normalizeDepartmentName } from "@/shared/departments"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("api-reports-action-points-export")
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]+/g

const sanitizeFilenameSegment = (value: string) =>
  value.replace(INVALID_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim()

const resolveMeetingDate = (week: number, year: number, meetingDate?: string) => {
  if (meetingDate) {
    const parsed = new Date(`${meetingDate}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  while (simple.getUTCDay() !== 1) simple.setUTCDate(simple.getUTCDate() - 1)
  return simple
}

const buildActionPointsFilename = ({
  week,
  year,
  meetingDate,
  extension,
  department,
}: {
  week: number
  year: number
  meetingDate?: string
  extension: string
  department?: string
}) => {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(resolveMeetingDate(week, year, meetingDate))

  return [
    `ACOB Action Points`,
    department ? sanitizeFilenameSegment(normalizeDepartmentName(department)) : null,
    dateLabel,
    `W${week}`,
  ]
    .filter(Boolean)
    .join(" ")
    .concat(`.${extension}`)
}

type ExportBody = {
  actions: ActionItem[]
  week: number
  year: number
  meetingDate?: string
  department?: string
  format: "docx" | "pdf"
  persist?: boolean
  reuseStored?: boolean
}

async function tryReadStoredPdf(filePath: string): Promise<Uint8Array | null> {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) return null

  try {
    const downloadUrl = await onedrive.getDownloadUrl(filePath)
    const response = await fetch(downloadUrl)
    if (!response.ok) return null
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    log.warn({ err: String(error), filePath }, "Stored action points export unavailable")
    return null
  }
}

async function persistPdf(filePath: string, pdfBuffer: Uint8Array): Promise<void> {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) return

  const folderPath = filePath.slice(0, filePath.lastIndexOf("/"))
  await onedrive.createFolder(folderPath)
  await onedrive.uploadFile(filePath, pdfBuffer, "application/pdf")
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`reports-action-points-export:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const body = (await request.json()) as ExportBody
    const { actions, week, year, meetingDate, department, format, persist = false, reuseStored = false } = body
    const filename = buildActionPointsFilename({ week, year, meetingDate, extension: format, department })

    if (format === "pdf") {
      const storagePath = buildGeneratedReportExportPath({
        meetingYear: year,
        meetingWeek: week,
        exportType: "action-points",
        department,
        fileName: filename,
      })

      if (persist && reuseStored) {
        const storedBytes = await tryReadStoredPdf(storagePath)
        if (storedBytes) {
          return new NextResponse(Buffer.from(storedBytes), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          })
        }
      }

      const normalizedActions: ActionItem[] = (Array.isArray(actions) ? actions : []).map((action) => ({
        id: String(action.id),
        title: typeof action.title === "string" ? action.title : "",
        description: typeof action.description === "string" ? action.description : undefined,
        department: String(action.department || ""),
        status: String(action.status || "pending"),
        week_number: Number(action.week_number || week),
        year: Number(action.year || year),
      }))

      const pdfBuffer = await generateActionPointsPdfFromDocxBuffer(normalizedActions, week, year, meetingDate)

      if (persist) {
        try {
          await persistPdf(storagePath, pdfBuffer)
        } catch (error) {
          log.warn({ err: String(error), storagePath }, "Failed to persist action points export to SharePoint")
        }
      }

      return new NextResponse(new Blob([Buffer.from(pdfBuffer)], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      })
    }

    const docxBuffer = await generateActionPointsDocxBuffer(actions, week, year, meetingDate)

    return new NextResponse(
      new Blob([Buffer.from(docxBuffer)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to export Action Points"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
