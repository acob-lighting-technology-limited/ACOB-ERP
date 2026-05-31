import "server-only"

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { AlignmentType, Document, Footer, ImageRun, Packer, PageNumber, Paragraph, TextRun } from "docx"
import { normalizeDepartmentName } from "@/shared/departments"
import type { WeeklyReportRow } from "@/lib/reports/weekly-report-pdf"

const LOGO_FILE = join(process.cwd(), "public", "images", "signature", "acob-10th-anniversary.png")

const sortedReports = (reports: WeeklyReportRow[]) =>
  [...reports].sort((a, b) =>
    normalizeDepartmentName(a.department).localeCompare(normalizeDepartmentName(b.department), "en", {
      sensitivity: "base",
    })
  )

const sectionLines = (text: string | null | undefined, fallback: string) =>
  autoNumberLines(String(text || fallback))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

function autoNumberLines(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return ""
  if (/^\d+[.)]\s/.test(lines[0])) return lines.join("\n")
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
}

async function readLogoRun() {
  try {
    const logo = await readFile(LOGO_FILE)
    return new ImageRun({
      data: logo,
      type: "png",
      transformation: {
        width: 125,
        height: 39,
      },
    })
  } catch {
    return null
  }
}

function addSection(children: Paragraph[], title: string, lines: string[]) {
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 22 })],
      spacing: { before: 160, after: 80 },
    })
  )

  lines.forEach((line) => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: line, size: 22 })],
        spacing: { after: 80 },
      })
    )
  })
}

export async function generateWeeklyReportDocxBuffer(
  reports: WeeklyReportRow[],
  week: number,
  year: number,
  meetingDateLabel: string
) {
  const logoRun = await readLogoRun()
  const children: Paragraph[] = []

  if (logoRun) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [logoRun],
        spacing: { after: 240 },
      })
    )
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "WEEKLY REPORT", bold: true, size: 30 })],
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Date: ${meetingDateLabel}`, bold: true, size: 24 })],
      spacing: { after: 300 },
    })
  )

  sortedReports(reports).forEach((report, index) => {
    const department = normalizeDepartmentName(report.department)
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${index + 1}. ${department.toUpperCase()}:`, bold: true, size: 24 })],
        spacing: { before: index === 0 ? 0 : 240, after: 120 },
      })
    )

    addSection(children, "WORK DONE", sectionLines(report.work_done, "No data provided."))
    addSection(children, "TASKS FOR NEW WEEK", sectionLines(report.tasks_new_week, "No data provided."))
    addSection(children, "CHALLENGES", sectionLines(report.challenges, "No challenges reported."))
  })

  const doc = new Document({
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  return new Uint8Array(await Packer.toBuffer(doc))
}
