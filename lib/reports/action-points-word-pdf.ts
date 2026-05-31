import "server-only"

import { join } from "node:path"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import type { ActionItem } from "@/lib/export-utils"
import { getActionPointsDepartmentHeading, normalizeDepartmentName } from "@/shared/departments"
import { readFile } from "node:fs/promises"

const PAGE_SIZE: [number, number] = [595, 842]
const PAGE_MARGIN_X = 54
const PAGE_MARGIN_TOP = 70
const PAGE_MARGIN_BOTTOM = 60
const LINE_GAP = 16
const BODY_FONT_SIZE = 11
const HEADING_FONT_SIZE = 12
const TITLE_FONT_SIZE = 14
const DATE_FONT_SIZE = 12
const TEXT_COLOR = rgb(0.16, 0.16, 0.16)
const LOGO_FILE = join(process.cwd(), "public", "images", "signature", "acob-10th-anniversary.png")

const wrapText = (text: string, maxWidth: number, font: PDFFontLike, fontSize: number) => {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean)
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate
      continue
    }

    if (currentLine) lines.push(currentLine)
    currentLine = word
  }

  if (currentLine) lines.push(currentLine)
  return lines.length > 0 ? lines : [""]
}

type PDFFontLike = {
  widthOfTextAtSize: (text: string, size: number) => number
}

const formatActionPointsDate = (week: number, year: number, meetingDate?: string) => {
  if (meetingDate) {
    const parsed = new Date(`${meetingDate}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed)
    }
  }

  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  while (simple.getUTCDay() !== 1) simple.setUTCDate(simple.getUTCDate() - 1)
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(simple)
}

const groupActionItemsByDepartment = (actions: ActionItem[]) => {
  const grouped: Record<string, ActionItem[]> = {}

  actions.forEach((action) => {
    const department = normalizeDepartmentName(action.department)
    if (!grouped[department]) grouped[department] = []
    grouped[department].push({ ...action, department })
  })

  const departments = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))

  return { grouped, departments }
}

async function generateHostedSafePdf(actions: ActionItem[], week: number, year: number, meetingDate?: string) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.TimesRoman)
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const { grouped, departments } = groupActionItemsByDepartment(actions)
  const [pageWidth, pageHeight] = PAGE_SIZE
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2
  const bulletIndent = 14
  const textWidth = contentWidth - bulletIndent

  let page = pdf.addPage(PAGE_SIZE)
  let cursorY = pageHeight - PAGE_MARGIN_TOP

  try {
    const logoBytes = await readFile(LOGO_FILE)
    const logo = await pdf.embedPng(logoBytes)
    const scaled = logo.scaleToFit(125, 26)
    page.drawImage(logo, {
      x: pageWidth / 2 - scaled.width / 2,
      y: cursorY - scaled.height,
      width: scaled.width,
      height: scaled.height,
    })
    cursorY -= scaled.height + 18
  } catch {
    // Skip logo when unavailable.
  }

  page.drawText("ACTION POINTS", {
    x: pageWidth / 2 - bold.widthOfTextAtSize("ACTION POINTS", TITLE_FONT_SIZE) / 2,
    y: cursorY,
    size: TITLE_FONT_SIZE,
    font: bold,
    color: TEXT_COLOR,
  })
  cursorY -= 24

  page.drawText(`Date: ${formatActionPointsDate(week, year, meetingDate)}`, {
    x: PAGE_MARGIN_X,
    y: cursorY,
    size: DATE_FONT_SIZE,
    font: bold,
    color: TEXT_COLOR,
  })
  cursorY -= 26

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight >= PAGE_MARGIN_BOTTOM) return
    page = pdf.addPage(PAGE_SIZE)
    cursorY = pageHeight - PAGE_MARGIN_TOP
  }

  for (let departmentIndex = 0; departmentIndex < departments.length; departmentIndex += 1) {
    const department = departments[departmentIndex]
    const heading = `${departmentIndex + 1}. ${getActionPointsDepartmentHeading(department)}`
    ensureSpace(24 + LINE_GAP + 6)
    page.drawText(heading, {
      x: PAGE_MARGIN_X,
      y: cursorY,
      size: HEADING_FONT_SIZE,
      font: bold,
      color: TEXT_COLOR,
    })
    cursorY -= 22

    for (const action of grouped[department] || []) {
      const sanitizedTitle = String(action.title || "")
        .replace(/[\f\v]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      const lines = wrapText(sanitizedTitle, textWidth, regular, BODY_FONT_SIZE)
      const requiredHeight = Math.max(LINE_GAP * lines.length, LINE_GAP) + 6
      ensureSpace(requiredHeight)

      page.drawText("•", {
        x: PAGE_MARGIN_X + 2,
        y: cursorY,
        size: BODY_FONT_SIZE,
        font: regular,
        color: TEXT_COLOR,
      })

      lines.forEach((line, index) => {
        page.drawText(line, {
          x: PAGE_MARGIN_X + bulletIndent,
          y: cursorY - index * LINE_GAP,
          size: BODY_FONT_SIZE,
          font: regular,
          color: TEXT_COLOR,
        })
      })

      cursorY -= requiredHeight
    }

    cursorY -= 8
  }

  return await pdf.save()
}

export async function generateActionPointsPdfFromDocxBuffer(
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string
) {
  return await generateHostedSafePdf(actions, week, year, meetingDate)
}
