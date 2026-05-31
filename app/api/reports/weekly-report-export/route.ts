import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import {
  buildDocxDownloadResponse,
  buildOfficialReportPdf,
  buildOfficialWeeklyReportDocx,
  buildPdfDownloadResponse,
  persistOfficialPdf,
  tryReadCurrentStoredOfficialPdf,
} from "@/lib/reports/official-pdf"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("api-reports-weekly-report-export")

type RequestBody = {
  week: number
  year: number
  type?: "weekly_report" | "action_point"
  format?: "pdf" | "docx"
  department?: string
  persist?: boolean
  reuseStored?: boolean
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`reports-weekly-report-export:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const body = (await request.json()) as RequestBody
    const {
      week,
      year,
      type = "weekly_report",
      format = "pdf",
      department,
      persist = false,
      reuseStored = false,
    } = body

    if (!week || !year) {
      return NextResponse.json({ error: "week and year are required" }, { status: 400 })
    }

    const supabase = await createClient()

    if (format === "docx") {
      if (type !== "weekly_report") {
        return NextResponse.json({ error: "DOCX export is only supported for weekly reports" }, { status: 400 })
      }

      const { docxBytes, filename } = await buildOfficialWeeklyReportDocx(supabase, { week, year, department })
      return buildDocxDownloadResponse(docxBytes, filename)
    }

    if (persist && reuseStored) {
      const storedPdf = await tryReadCurrentStoredOfficialPdf(supabase, { week, year, type, department })
      if (storedPdf) {
        return buildPdfDownloadResponse(storedPdf.bytes, storedPdf.filename)
      }
    }

    const { pdfBytes, filename, storagePath } = await buildOfficialReportPdf(supabase, { week, year, type, department })

    if (persist) {
      try {
        await persistOfficialPdf(storagePath, pdfBytes)
      } catch (error) {
        log.warn({ err: String(error), storagePath }, "Failed to persist weekly export to SharePoint")
      }
    }

    return buildPdfDownloadResponse(pdfBytes, filename)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate PDF"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
