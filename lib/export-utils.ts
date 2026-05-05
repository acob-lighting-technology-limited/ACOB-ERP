import { jsPDF } from "jspdf"
import { saveAs } from "file-saver"
import { DEPT_EXECUTIVE_MANAGEMENT } from "@/config/constants"
import {
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
} from "docx"
import { formatOfficeDateWithOrdinal, getOfficeWeekMonday } from "./meeting-week"
import {
  compareDepartments,
  getActionPointsDepartmentHeading,
  getCanonicalDepartmentOrder,
  getDepartmentAliases,
  normalizeDepartmentName,
} from "@/shared/departments"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"

// Load pptxgenjs from the installed npm package via dynamic import.
// Dynamic import keeps it out of the SSR bundle (it requires browser APIs).
type PptxShapeTypeMap = Record<string, string>

type PptxSlide = {
  background?: { color: string }
  transition?: { type: string; duration: number }
  addShape: (shapeName: string, options: Record<string, unknown>) => void
  addText: (text: string, options: Record<string, unknown>) => void
  addImage: (options: Record<string, unknown>) => void
}

type PptxPresentation = {
  layout: string
  ShapeType?: PptxShapeTypeMap
  addSlide: () => PptxSlide
  writeFile: (options: { fileName: string }) => Promise<string>
}

type PptxConstructor = new () => PptxPresentation

const loadPptxGenJS = async (): Promise<PptxConstructor> => {
  const mod = await import("pptxgenjs")
  return (mod.default ?? mod) as unknown as PptxConstructor
}

type WeeklyReportProfile = {
  first_name?: string | null
  last_name?: string | null
}

export interface WeeklyReport {
  id: string
  department: string
  week_number: number
  year: number
  work_done: string
  tasks_new_week: string
  challenges: string
  status: string
  user_id: string
  created_at: string
  profiles?: WeeklyReportProfile | WeeklyReportProfile[] | null
}

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]+/g
const inFlightActionPointFileExports = new Set<string>()

const sanitizeFilenameSegment = (value: string) =>
  value.replace(INVALID_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim()

const resolveExportMeetingDate = (week: number, year: number, meetingDate?: string) => {
  if (meetingDate) {
    const parsed = new Date(`${meetingDate}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const fallback = getOfficeWeekMonday(week, year)
  fallback.setHours(0, 0, 0, 0)
  return fallback
}

const formatMeetingDateForFilename = (week: number, year: number, meetingDate?: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(resolveExportMeetingDate(week, year, meetingDate))

const formatActionPointsDate = (week: number, year: number, meetingDate?: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(resolveExportMeetingDate(week, year, meetingDate))

const formatMeetingDateWithWeekday = (date: Date): string => {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" })
  return `${weekday}, ${formatOfficeDateWithOrdinal(date)}`
}

const formatExportMeetingDateLabel = (week: number, year: number, meetingDate?: string) =>
  formatMeetingDateWithWeekday(resolveExportMeetingDate(week, year, meetingDate))

const buildWeeklyReportFilename = ({
  week,
  year: _year,
  meetingDate,
  extension,
  department,
  allDepartments = false,
  theme,
}: {
  week: number
  year: number
  meetingDate?: string
  extension: string
  department?: string
  allDepartments?: boolean
  theme?: WeeklyPptxTheme
}) => {
  const parts = [
    allDepartments ? "ACOB Weekly Reports" : "ACOB Weekly Report",
    department ? sanitizeFilenameSegment(department) : null,
    formatMeetingDateForFilename(week, _year, meetingDate),
    `W${week}`,
    theme === "dark" ? "Dark Theme" : null,
  ].filter(Boolean)

  return `${parts.join(" - ")}.${extension}`
}

const buildActionPointFilename = ({
  week,
  year: _year,
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
  const parts = [
    "ACOB Action Points",
    department ? sanitizeFilenameSegment(department) : null,
    formatMeetingDateForFilename(week, _year, meetingDate),
    `W${week}`,
  ].filter(Boolean)

  return `${parts.join(" - ")}.${extension}`
}

// ─── Constants & Sorting ──────────────────────────────────────────────────
export const DEPARTMENT_ORDER = getCanonicalDepartmentOrder().map((department) =>
  department === "Executive Management" ? DEPT_EXECUTIVE_MANAGEMENT : department
)

/**
 * Sorts reports based on the official ACOB department hierarchy.
 * Departments not in the list appear alphabetically at the end.
 */
export const sortReportsByDepartment = (reports: WeeklyReport[]) => {
  return [...reports].sort((a, b) => compareDepartments(a.department, b.department))
}

/**
 * Auto-numbers each non-empty line: "1. line", "2. line", ...
 * If lines are already numbered (including Word-pasted formats), numbering is preserved
 * but normalized to "N. text" to avoid tab-stop spacing issues in PPTX.
 */
/**
 * Strips ALL non-ASCII characters from report text.
 * Uses a whitelist approach: only printable ASCII (0x20-0x7E), newline, and carriage-return
 * are kept. This eliminates every possible Unicode backtick / tick / accent / fancy-quote /
 * zero-width character that copy-paste from Word / Outlook / email can introduce.
 */
export const sanitizeReportText = (s: string): string => s.replace(/[^\x20-\x7E\n\r]/g, "")

/** @deprecated use sanitizeReportText */
const cleanPastedText = sanitizeReportText

export const autoNumberLines = (text: string): string => {
  if (!text?.trim()) return text || ""

  // First pass: strip all stray tick / backtick / accent characters from raw input
  const cleaned = cleanPastedText(text)

  const collapseSpacedLetters = (line: string) =>
    line.replace(/\b(?:[A-Za-z]\s+){3,}[A-Za-z]\b/g, (match) => match.replace(/\s+/g, ""))

  const sanitizeLine = (line: string) => {
    const result = line
      .replace(/\t+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // strip stray punctuation marks that often appear before copied bullet/list text
      .replace(/^['`.,;:!?-]+\s*/, "")

    return collapseSpacedLetters(result)
  }

  const lines = cleaned
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => sanitizeLine(l))
    .filter((l) => l.trim().length > 0)
  const parseNumbered = (line: string) => sanitizeLine(line).match(/^(\d+)[.)]\s*(.+)$/)

  if (parseNumbered(lines[0])) {
    return lines
      .map((line) => {
        const numbered = parseNumbered(line)
        if (numbered) return `${numbered[1]}. ${numbered[2].trim()}`
        return sanitizeLine(line)
      })
      .join("\n")
  }

  return lines.map((l, i) => `${i + 1}. ${sanitizeLine(l)}`).join("\n")
}

/** Returns the office-week start date as a formatted string e.g. "Monday, 17th February, 2026" */
const getWeekMonday = (week: number, year: number): string => {
  const monday = getOfficeWeekMonday(week, year)
  return formatMeetingDateWithWeekday(monday)
}

/**
 * Fetches an image URL and returns a crisp PNG data URL via an offscreen canvas.
 * WebP fed directly to jsPDF renders poorly — converting to PNG via canvas fixes it.
 * Uses 2× scale for retina-quality output.
 */
const fetchImageAsBase64 = (url: string): Promise<string | null> =>
  new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const scale = 2 // 2× for sharpness
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth * scale
        canvas.height = img.naturalHeight * scale
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.scale(scale, scale)
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL("image/png"))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })

// ─── PDF colour helpers ───────────────────────────────────────────────────────
const PDF_GREEN: [number, number, number] = [26, 122, 74]
const PDF_DARK: [number, number, number] = [15, 45, 31]
const PDF_SLATE: [number, number, number] = [51, 65, 85]
const PDF_MUTED: [number, number, number] = [100, 116, 139]
const PDF_WHITE: [number, number, number] = [255, 255, 255]
const PDF_BLUE: [number, number, number] = [29, 106, 150]
const PDF_RED: [number, number, number] = [185, 28, 28]

/** Draws the ACOB PDF cover page (A4: 210×297mm). */
const pdfCoverPage = (
  doc: jsPDF,
  week: number,
  year: number,
  mondayDate: string,
  logoFull: string | null,
  subtitle?: string
) => {
  const W = 210,
    H = 297
  const headerH = 18
  const footerH = 14

  // Dark header bar (blank — no text)
  doc.setFillColor(...PDF_DARK)
  doc.rect(0, 0, W, headerH, "F")
  // Green accent line under header
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, headerH, W, 2, "F")

  // Bottom green footer
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, H - footerH, W, footerH, "F")
  doc.setFontSize(8)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "normal")
  doc.text("Confidential — ACOB Internal Use Only", W / 2, H - 5, { align: "center" })

  // ── Vertically centre all content in the body area ────────────────────────
  const bodyTop = headerH + 2
  const bodyBottom = H - footerH
  const bodyH = bodyBottom - bodyTop

  // Measure total content height:
  // Logo: 22mm, gap: 8mm, divider: 1mm, gap: 10mm,
  // "General Meeting": ~10mm, gap: 6mm, "Weekly Report": ~7mm, gap: 8mm,
  // Pill: 9mm, gap: 8mm, date: ~5mm, [subtitle: 6mm]
  const logoH = 22
  const subtitleExtra = subtitle ? 10 : 0
  const totalContentH = logoH + 8 + 1 + 14 + 10 + 6 + 7 + 8 + 9 + 8 + 5 + subtitleExtra
  const startY = bodyTop + (bodyH - totalContentH) / 2

  // Logo centred
  const logoW = 100
  const logoX = (W - logoW) / 2
  const logoY = startY
  if (logoFull) {
    doc.addImage(logoFull, "PNG", logoX, logoY, logoW, logoH, "LOGO_FULL", "FAST")
  } else {
    doc.setFontSize(14)
    doc.setTextColor(...PDF_DARK)
    doc.setFont("helvetica", "bold")
    doc.text("ACOB LIGHTING TECHNOLOGY LIMITED", W / 2, logoY + 14, { align: "center" })
  }

  // Green divider below logo
  const dividerY = logoY + logoH + 8
  doc.setDrawColor(...PDF_GREEN)
  doc.setLineWidth(0.5)
  doc.line(30, dividerY, W - 30, dividerY)

  // "General Meeting"
  const titleY = dividerY + 14
  doc.setFontSize(28)
  doc.setTextColor(...PDF_DARK)
  doc.setFont("helvetica", "bold")
  doc.text("General Meeting", W / 2, titleY, { align: "center" })

  // "Weekly Report"
  doc.setFontSize(18)
  doc.setTextColor(...PDF_GREEN)
  doc.setFont("helvetica", "normal")
  doc.text("Weekly Report", W / 2, titleY + 10, { align: "center" })

  // Week pill
  const pillW = 36,
    pillH = 9
  const pillX = W / 2 - pillW / 2
  const pillY = titleY + 20
  doc.setFillColor(...PDF_GREEN)
  doc.roundedRect(pillX, pillY, pillW, pillH, 2, 2, "F")
  doc.setFontSize(11)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")
  doc.text(`Week ${week}`, W / 2, pillY + 6.2, { align: "center" })

  // Monday date
  doc.setFontSize(11)
  doc.setTextColor(...PDF_MUTED)
  doc.setFont("helvetica", "normal")
  doc.text(mondayDate, W / 2, pillY + 18, { align: "center" })

  // Optional subtitle (dept name or "Action Points")
  if (subtitle) {
    doc.setFontSize(10)
    doc.setTextColor(...PDF_GREEN)
    doc.setFont("helvetica", "italic")
    doc.text(subtitle, W / 2, pillY + 28, { align: "center" })
  }
}

/** Draws a dept index page listing all departments with numbers. */
const pdfDeptIndexPage = (doc: jsPDF, departments: string[], week: number, year: number) => {
  const W = 210,
    H = 297

  // Header
  doc.setFillColor(...PDF_DARK)
  doc.rect(0, 0, W, 18, "F")
  doc.setFontSize(11)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")
  doc.text("Departments in This Report", 14, 12)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(`Week ${week}, ${year}`, W - 14, 12, { align: "right" })

  // List
  let y = 36
  departments.forEach((dept, i) => {
    // Circle badge
    doc.setFillColor(...PDF_GREEN)
    doc.circle(20, y - 1.5, 4, "F")
    doc.setFontSize(8)
    doc.setTextColor(...PDF_WHITE)
    doc.setFont("helvetica", "bold")
    doc.text(`${i + 1}`, 20, y + 1, { align: "center" })

    // Dept name
    doc.setFontSize(12)
    doc.setTextColor(...PDF_DARK)
    doc.setFont("helvetica", "normal")
    doc.text(dept, 30, y + 1)
    doc.setFontSize(10)
    doc.setTextColor(...PDF_GREEN)
    doc.setFont("helvetica", "bold")
    doc.text(String(i + 3), W - 14, y + 1, { align: "right" })

    // Separator
    if (i < departments.length - 1) {
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.3)
      doc.line(14, y + 6, W - 14, y + 6)
    }
    y += 14
  })

  // Footer
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, H - 14, W, 14, "F")
  doc.setFontSize(8)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "normal")
  doc.text("Confidential — ACOB Internal Use Only", W / 2, H - 5, { align: "center" })
}

/** Draws a dept section header page (green full-bleed). */
const _pdfDeptHeaderPage = (doc: jsPDF, department: string, _submittedBy: string) => {
  const W = 210,
    H = 297
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, 0, W, H, "F")

  doc.setFontSize(28) // Slightly smaller to accommodate wrapping
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")

  // Split text to fit within page with margins
  const maxW = W - 40
  const lines = doc.splitTextToSize(department.toUpperCase(), maxW)
  const lineHeight = 12
  const totalLinesH = lines.length * lineHeight
  const startY = H / 2 - totalLinesH / 2

  doc.text(lines, 20, startY)

  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(1)
  doc.line(20, startY + totalLinesH + 4, 100, startY + totalLinesH + 4)

  // doc.setFontSize(11)
  // doc.setFont("helvetica", "normal")
  // doc.text(`Submitted by: ${submittedBy}`, 20, H / 2 + 14)
}

/** Draws the content page: 3 rows, 1 column — Work Done / Tasks for New Week / Challenges. */
const pdfContentPage = (
  doc: jsPDF,
  department: string,
  report: WeeklyReport,
  logoDark: string | null,
  pageNumber?: number
) => {
  const W = 210,
    H = 297
  const headerH = 18
  const footerH = 14

  // Dark header bar
  doc.setFillColor(...PDF_DARK)
  doc.rect(0, 0, W, headerH, "F")
  // Green accent line under header
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, headerH, W, 1.5, "F")

  // Dept name — top LEFT in header
  doc.setFontSize(9)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")
  doc.text(department.toUpperCase(), 8, 11)

  // Logo — RIGHT in header, vertically centred
  if (logoDark) {
    const logoH = 9,
      logoW = 38
    const logoY = (headerH - logoH) / 2 // = 4.5mm — perfectly centred
    doc.addImage(logoDark, "PNG", W - logoW - 6, logoY, logoW, logoH, "LOGO_DARK", "FAST")
  }

  // Body: weighted rows — Work Done 50%, Tasks 30%, Challenges 20%
  const bodyStart = headerH + 4
  const footerStart = H - footerH
  const bodyH = footerStart - bodyStart
  const sectionWeights = [0.5, 0.3, 0.2] // Work Done, Tasks, Challenges
  const labelH = 8 // slightly taller label bar
  const padX = 14
  const innerW = W - padX * 2
  const fontSize = 10 // bigger body font
  const sections = [
    { title: "WORK DONE", color: PDF_GREEN, text: autoNumberLines(report.work_done) || "No data provided." },
    {
      title: "TASKS FOR NEW WEEK",
      color: PDF_BLUE,
      text: autoNumberLines(report.tasks_new_week) || "No data provided.",
    },
    { title: "CHALLENGES", color: PDF_RED, text: autoNumberLines(report.challenges) || "No challenges reported." },
  ]

  const drawFittedSectionText = (text: string, x: number, y: number, width: number, availableH: number) => {
    const buildLinesWithIndent = (
      content: string,
      textWidth: number,
      numberIndentMm: number
    ): Array<{ text: string; indent: number }> => {
      const out: Array<{ text: string; indent: number }> = []
      const sourceLines = String(content || "").split("\n")
      sourceLines.forEach((rawLine) => {
        const line = cleanPastedText(rawLine.trim())
        if (!line) {
          out.push({ text: "", indent: 0 })
          return
        }
        const numbered = line.match(/^(\d+\.)\s+(.*)$/)
        if (!numbered) {
          const plainLines = doc.splitTextToSize(line, textWidth)
          plainLines.forEach((pl: string) => out.push({ text: pl, indent: 0 }))
          return
        }
        const numberToken = `${numbered[1]} `
        const bodyText = cleanPastedText(numbered[2] || "")
        const firstLineMaxW = Math.max(8, textWidth - numberIndentMm)
        const bodyLines = doc.splitTextToSize(bodyText, firstLineMaxW)
        if (!bodyLines.length) {
          out.push({ text: numberToken.trim(), indent: 0 })
          return
        }
        out.push({ text: `${numberToken}${bodyLines[0]}`, indent: 0 })
        bodyLines.slice(1).forEach((bl: string) => out.push({ text: bl, indent: numberIndentMm }))
      })
      return out
    }

    const tryConfigs = [
      { fontSize: 10, lineSpacing: 6 },
      { fontSize: 9, lineSpacing: 5.5 },
      { fontSize: 8.5, lineSpacing: 5 },
      { fontSize: 8, lineSpacing: 4.6 },
      { fontSize: 7.5, lineSpacing: 4.2 },
      { fontSize: 7, lineSpacing: 3.9 },
    ]

    for (const cfg of tryConfigs) {
      doc.setFontSize(cfg.fontSize)
      const numberIndentMm = Math.max(5.0, cfg.fontSize * 0.42 - 0.4)
      const lines = buildLinesWithIndent(text, width, numberIndentMm)
      const maxLines = Math.floor(availableH / cfg.lineSpacing)
      if (lines.length <= maxLines) {
        let ty = y
        lines.forEach((line) => {
          doc.text(line.text, x + line.indent, ty)
          ty += cfg.lineSpacing
        })
        return
      }
    }

    // Last fallback: render as many lines as fit at the smallest font size.
    doc.setFontSize(7)
    const lines = buildLinesWithIndent(text, width, 5.0)
    const maxLines = Math.max(1, Math.floor(availableH / 3.9))
    let ty = y
    lines.slice(0, maxLines).forEach((line) => {
      doc.text(line.text, x + line.indent, ty)
      ty += 3.9
    })
  }

  let sectionTop = bodyStart
  sections.forEach((s, i) => {
    const rowH = bodyH * sectionWeights[i]

    // Label bar
    doc.setFillColor(...s.color)
    doc.rect(padX, sectionTop, innerW, labelH, "F")
    doc.setFontSize(9)
    doc.setTextColor(...PDF_WHITE)
    doc.setFont("helvetica", "bold")
    doc.text(s.title, padX + 3, sectionTop + 5.5)

    // Content text — larger font, more spacing
    doc.setFontSize(fontSize)
    doc.setTextColor(...PDF_SLATE)
    doc.setFont("helvetica", "normal")
    drawFittedSectionText(s.text, padX + 3, sectionTop + labelH + 6, innerW - 6, rowH - labelH - 6)

    // Row divider (not after last)
    if (i < 2) {
      doc.setDrawColor(200, 215, 225)
      doc.setLineWidth(0.3)
      doc.line(padX, sectionTop + rowH, W - padX, sectionTop + rowH)
    }

    sectionTop += rowH
  })

  // Footer
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, H - footerH, W, footerH, "F")
  doc.setFontSize(8)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "normal")
  doc.text("Confidential — ACOB Internal Use Only", 14, H - 5)
  if (typeof pageNumber === "number") {
    doc.setFont("helvetica", "bold")
    doc.text(String(pageNumber), W / 2, H - 5, { align: "center" })
  }
}

export const exportToPDF = async (report: WeeklyReport, meetingDate?: string) => {
  const doc = new jsPDF()
  // Cover shows the CURRENT week (week being reported IN = report week + 1)
  const currentWeek = report.week_number + 1
  const currentYear = currentWeek > 52 ? report.year + 1 : report.year
  const meetingDateLabel = formatExportMeetingDateLabel(currentWeek, currentYear, meetingDate)

  const [logoFull, logoDark] = await Promise.all([
    fetchImageAsBase64(getSeasonalLogoPaths("light").full),
    fetchImageAsBase64(getSeasonalLogoPaths("light").icon),
  ])

  // Page 1 — Cover (shows current week / meeting date)
  pdfCoverPage(doc, currentWeek, currentYear, meetingDateLabel, logoFull, report.department)

  // Page 2 — Content (no separate dept header page)
  doc.addPage()
  pdfContentPage(doc, report.department, report, logoDark)

  doc.save(
    buildWeeklyReportFilename({
      week: report.week_number,
      year: report.year,
      meetingDate,
      extension: "pdf",
      department: report.department,
    })
  )
}

export const exportAllToPDF = async (reports: WeeklyReport[], week: number, year: number, meetingDate?: string) => {
  const doc = new jsPDF()
  const sortedReports = sortReportsByDepartment(reports)
  // Cover shows the CURRENT week (week being reported IN = report week + 1)
  const currentWeek = week + 1
  const currentYear = currentWeek > 52 ? year + 1 : year
  const meetingDateLabel = formatExportMeetingDateLabel(currentWeek, currentYear, meetingDate)
  const departments = sortedReports.map((r) => r.department)

  const [logoFull, logoDark] = await Promise.all([
    fetchImageAsBase64(getSeasonalLogoPaths("light").full),
    fetchImageAsBase64(getSeasonalLogoPaths("light").icon),
  ])

  // Page 1 — Cover (current week / meeting date)
  pdfCoverPage(doc, currentWeek, currentYear, meetingDateLabel, logoFull)

  // Page 2 — Dept index
  doc.addPage()
  pdfDeptIndexPage(doc, departments, week, year)

  sortedReports.forEach((report, idx) => {
    // Content page only — no separate green dept header page
    doc.addPage()
    pdfContentPage(doc, report.department, report, logoDark, idx + 3)
  })

  doc.save(
    buildWeeklyReportFilename({
      week,
      year,
      meetingDate,
      extension: "pdf",
      allDepartments: true,
    })
  )
}

/**
 * Generates the weekly report PDF and returns it as a base64 string (for email attachment).
 */
export const exportAllToPDFBase64 = async (reports: WeeklyReport[], week: number, year: number): Promise<string> => {
  const doc = new jsPDF()
  const sortedReports = sortReportsByDepartment(reports)
  // Cover shows the CURRENT week (week being reported IN = report week + 1)
  const currentWeek = week + 1
  const currentYear = currentWeek > 52 ? year + 1 : year
  const mondayDate = getWeekMonday(currentWeek, currentYear)
  const departments = sortedReports.map((r) => r.department)

  const [logoFull, logoDark] = await Promise.all([
    fetchImageAsBase64(getSeasonalLogoPaths("light").full),
    fetchImageAsBase64(getSeasonalLogoPaths("light").icon),
  ])

  pdfCoverPage(doc, currentWeek, currentYear, mondayDate, logoFull)
  doc.addPage()
  pdfDeptIndexPage(doc, departments, week, year)

  sortedReports.forEach((report, idx) => {
    // No separate dept header page
    doc.addPage()
    pdfContentPage(doc, report.department, report, logoDark, idx + 3)
  })

  return doc.output("datauristring").split(",")[1]
}

// ─── Action Point PDF ───────────────────────────────────────────────────────

export interface ActionItem {
  id: string
  title: string
  description?: string
  status: string
  department: string
  week_number: number
  year: number
  original_week?: number
}

const formatStatusLabel = (status: string) =>
  status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

const groupActionItemsByDepartment = (actions: ActionItem[]) => {
  const grouped: Record<string, ActionItem[]> = {}
  actions.forEach((action) => {
    const department = normalizeDepartmentName(action.department)
    if (!grouped[department]) grouped[department] = []
    grouped[department].push({ ...action, department })
  })

  const departments = DEPARTMENT_ORDER.filter((dept) => grouped[dept])
  Object.keys(grouped).forEach((dept) => {
    if (!departments.includes(dept)) departments.push(dept)
  })

  return { grouped, departments }
}

/** Draws a single Action Point content page for a department. */
const pdfActionPointPage = (
  doc: jsPDF,
  department: string,
  actions: ActionItem[],
  logoDark: string | null,
  week: number,
  year: number,
  pageNumber?: number
) => {
  const W = 210,
    H = 297
  const headerH = 18
  const footerH = 14

  // Dark header bar
  doc.setFillColor(...PDF_DARK)
  doc.rect(0, 0, W, headerH, "F")
  // Green accent line
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, headerH, W, 1.5, "F")

  // Dept name — top LEFT
  doc.setFontSize(9)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")
  doc.text(department.toUpperCase(), 8, 11)

  // Logo — RIGHT, vertically centred
  if (logoDark) {
    const logoH = 9,
      logoW = 38
    const logoY = (headerH - logoH) / 2 // = 4.5mm
    doc.addImage(logoDark, "PNG", W - logoW - 6, logoY, logoW, logoH, "LOGO_DARK", "FAST")
  }

  // Week badge (below header)
  doc.setFillColor(...PDF_GREEN)
  doc.roundedRect(W - 14 - 30, headerH + 4, 30, 7, 1.5, 1.5, "F")
  doc.setFontSize(8)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")
  doc.text(`Week ${week}, ${year}`, W - 14 - 15, headerH + 9, { align: "center" })

  // Section title
  doc.setFontSize(13)
  doc.setTextColor(...PDF_DARK)
  doc.setFont("helvetica", "bold")
  doc.text("ACTION POINTS", 14, headerH + 18)
  doc.setDrawColor(...PDF_GREEN)
  doc.setLineWidth(0.5)
  doc.line(14, headerH + 20, W - 14, headerH + 20)

  // Column headers: S/N | ACTION ITEM | STATUS
  const snX = 14
  const snW = 12
  const actionX = snX + snW
  const statusW = 36
  const statusX = W - 14 - statusW
  const actionW = statusX - actionX
  const headerY = headerH + 28

  doc.setFillColor(...PDF_GREEN)
  doc.rect(14, headerY - 5, W - 28, 8, "F")
  doc.setFontSize(8)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "bold")
  doc.text("S/N", snX + 2, headerY)
  doc.text("ACTION ITEM", actionX + 2, headerY)
  doc.text("STATUS", statusX + 2, headerY)

  // Rows
  let rowTop = headerY + 3
  const minRowH = 10
  const titleLineH = 3.8
  const maxTitleLines = 3
  const statusColors: Record<string, [number, number, number]> = {
    completed: [22, 101, 52],
    in_progress: [29, 78, 216],
    not_started: [180, 83, 9],
    pending: [100, 116, 139],
  }
  const statusLabels: Record<string, string> = {
    completed: "Completed",
    in_progress: "In Progress",
    not_started: "Not Started",
    pending: "Pending",
  }

  actions.forEach((action, i) => {
    const titleLinesRaw = doc.splitTextToSize(action.title || "", actionW - 4)
    const titleLines = titleLinesRaw.slice(0, maxTitleLines)
    if (titleLinesRaw.length > maxTitleLines && titleLines.length > 0) {
      titleLines[titleLines.length - 1] = `${titleLines[titleLines.length - 1]}...`
    }
    const rowH = Math.max(minRowH, titleLines.length * titleLineH + 3)
    if (rowTop + rowH > H - footerH - 4) return // Overflow guard
    const isEven = i % 2 === 0
    if (isEven) {
      doc.setFillColor(248, 250, 252)
      doc.rect(14, rowTop, W - 28, rowH, "F")
    }

    // S/N
    doc.setFontSize(8)
    doc.setTextColor(...PDF_SLATE)
    doc.setFont("helvetica", "bold")
    doc.text(`${i + 1}`, snX + 4, rowTop + 5.5)

    // Action item — wrapped over multiple lines (up to maxTitleLines)
    doc.setFontSize(9)
    doc.setTextColor(...PDF_SLATE)
    doc.setFont("helvetica", "normal")
    titleLines.forEach((line: string, lineIdx: number) => {
      doc.text(line, actionX + 2, rowTop + 4.2 + lineIdx * titleLineH)
    })

    // Status badge
    const statusColor = statusColors[action.status] || statusColors.pending
    const statusLabel = statusLabels[action.status] || action.status
    doc.setFillColor(...statusColor)
    const badgeY = rowTop + Math.max(0.8, (rowH - 6) / 2)
    doc.roundedRect(statusX + 1, badgeY, statusW - 2, 6, 1, 1, "F")
    doc.setTextColor(...PDF_WHITE)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.text(statusLabel, statusX + statusW / 2, badgeY + 4.1, { align: "center" })

    // Separator
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.line(14, rowTop + rowH, W - 14, rowTop + rowH)

    rowTop += rowH
  })

  // Footer
  doc.setFillColor(...PDF_GREEN)
  doc.rect(0, H - footerH, W, footerH, "F")
  doc.setFontSize(8)
  doc.setTextColor(...PDF_WHITE)
  doc.setFont("helvetica", "normal")
  doc.text("Confidential — ACOB Internal Use Only", 14, H - 5)
  if (typeof pageNumber === "number") {
    doc.setFont("helvetica", "bold")
    doc.text(String(pageNumber), W / 2, H - 5, { align: "center" })
  }
}

/**
 * Generates the Action Point PDF and returns it as a base64 string (for email attachment).
 */
export const exportActionPointToPDFBase64 = async (
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string
): Promise<string> => {
  const doc = new jsPDF()
  // Action Point week IS the current week (no +1 needed)
  const meetingDateLabel = formatExportMeetingDateLabel(week, year, meetingDate)

  const [logoFull, logoDark] = await Promise.all([
    fetchImageAsBase64(getSeasonalLogoPaths("light").full),
    fetchImageAsBase64(getSeasonalLogoPaths("light").icon),
  ])

  // Cover page — shows current week with "Action Points" subtitle
  pdfCoverPage(doc, week, year, meetingDateLabel, logoFull, "Action Points")

  // Group actions by department (in DEPARTMENT_ORDER)
  const { grouped, departments } = groupActionItemsByDepartment(actions)

  // Page 2 — Dept index / TOC
  doc.addPage()
  pdfDeptIndexPage(doc, departments, week, year)

  departments.forEach((dept, idx) => {
    const deptActions = grouped[dept] || []
    doc.addPage()
    pdfActionPointPage(doc, dept, deptActions, logoDark, week, year, idx + 3)
  })

  return doc.output("datauristring").split(",")[1]
}

/**
 * Saves the Action Point as a downloadable PDF file.
 */
export const exportActionPointToPDF = async (
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string,
  department?: string
): Promise<void> => {
  const doc = new jsPDF()
  const pageWidth = 210
  const left = 18
  const contentWidth = 170
  const topMargin = 20
  const nextPageTop = 18
  const bottomLimit = 274
  const meetingDateLabel = formatActionPointsDate(week, year, meetingDate)
  const { grouped, departments } = groupActionItemsByDepartment(actions)

  let pageNumber = 1
  let y = topMargin

  const renderFooter = () => {
    doc.setFillColor(...PDF_GREEN)
    doc.rect(0, 283, pageWidth, 14, "F")
    doc.setFontSize(8)
    doc.setTextColor(...PDF_WHITE)
    doc.setFont("helvetica", "normal")
    doc.text("Confidential - ACOB Internal Use Only", 14, 292)
    doc.setFont("helvetica", "bold")
    doc.text(String(pageNumber), pageWidth / 2, 292, { align: "center" })
  }

  const startPage = (isFirstPage: boolean) => {
    if (!isFirstPage) {
      renderFooter()
      doc.addPage()
      pageNumber += 1
    }

    doc.setTextColor(...PDF_DARK)
    if (isFirstPage) {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(18)
      doc.text("ACTION POINTS", pageWidth / 2, 16, { align: "center" })
      doc.setFont("helvetica", "normal")
      doc.setFontSize(11)
      doc.setTextColor(...PDF_MUTED)
      doc.text(`Date: ${meetingDateLabel}`, left, 26)
      y = 34
      return
    }

    y = nextPageTop
  }

  startPage(true)

  departments.forEach((dept, deptIndex) => {
    const deptHeading = `${deptIndex + 1}. ${getActionPointsDepartmentHeading(dept)}`
    const deptActions = grouped[dept] || []

    if (y > bottomLimit - 12) startPage(false)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(...PDF_DARK)
    doc.text(deptHeading, left, y)
    y += 8

    deptActions.forEach((action) => {
      const lines = doc.splitTextToSize(action.title || "", contentWidth)
      const rowHeight = Math.max(6, lines.length * 5)

      if (y + rowHeight > bottomLimit) startPage(false)

      doc.setFillColor(...PDF_DARK)
      doc.circle(left + 3, y - 1.5, 0.8, "F")
      doc.setFont("helvetica", "normal")
      doc.setFontSize(11)
      doc.setTextColor(...PDF_SLATE)
      doc.text(lines, left + 10, y)
      y += rowHeight + 2
    })

    y += 4
  })

  renderFooter()

  saveAs(doc.output("blob"), buildActionPointFilename({ week, year, meetingDate, extension: "pdf", department }))
}

/**
 * Exports the Action Point as a PPTX presentation.
 */
export const exportActionPointToPPTX = async (
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string,
  department?: string
): Promise<void> => {
  const exportKey = ["pptx", week, year, meetingDate || "", department || "all", actions.length].join(":")
  if (inFlightActionPointFileExports.has(exportKey)) return
  inFlightActionPointFileExports.add(exportKey)

  try {
    const PptxConstructor = await loadPptxGenJS()
    const pres = new PptxConstructor()
    pres.layout = "LAYOUT_WIDE"

    // Cover slide
    addCoverSlide(pres, week, year, "Action Points")

    // Group by department
    const { grouped, departments } = groupActionItemsByDepartment(actions)

    // TOC slide
    addDeptIndexSlide(pres, departments, week, year)

    departments.forEach((dept, idx) => {
      const deptActions = grouped[dept] || []
      const slide = pres.addSlide()
      slide.background = { color: ACOB_OFFWHITE }

      // Header
      slide.addShape(pres.ShapeType?.rect ?? "rect", {
        x: 0,
        y: 0,
        w: "100%",
        h: 0.65,
        fill: { color: ACOB_DARK },
        line: { color: ACOB_DARK },
      })
      slide.addText(dept.toUpperCase(), {
        x: 0.3,
        y: 0,
        w: 9,
        h: 0.65,
        fontSize: 14,
        bold: true,
        color: ACOB_WHITE,
        valign: "middle",
        fontFace: "Calibri",
      })
      try {
        slide.addImage({ path: LOGO_ICON, x: 11.45, y: 0.14, w: 1.7, h: 0.37 })
      } catch {
        /* skip */
      }

      // Week badge
      slide.addText(`Week ${week}, ${year}`, {
        x: 9.5,
        y: 0.7,
        w: 3.5,
        h: 0.35,
        fontSize: 10,
        bold: true,
        color: ACOB_WHITE,
        fill: { color: ACOB_GREEN },
        align: "center",
        valign: "middle",
        fontFace: "Calibri",
      })

      // Table header: S/N | ACTION ITEM | STATUS
      const tableY = 1.2
      const colWidths = [0.8, 9.2, 2.8]
      const headers = ["S/N", "ACTION ITEM", "STATUS"]
      const colX = [0.25, 1.05, 10.25]

      slide.addShape(pres.ShapeType?.rect ?? "rect", {
        x: 0.25,
        y: tableY,
        w: 12.83,
        h: 0.38,
        fill: { color: ACOB_GREEN },
        line: { color: ACOB_GREEN },
      })
      headers.forEach((h, i) => {
        slide.addText(h, {
          x: colX[i] + 0.1,
          y: tableY,
          w: colWidths[i] - 0.1,
          h: 0.38,
          fontSize: 9,
          bold: true,
          color: ACOB_WHITE,
          valign: "middle",
          fontFace: "Calibri",
        })
      })

      const statusColors: Record<string, string> = {
        completed: "166534",
        in_progress: "1D4ED8",
        not_started: "C2410C",
        pending: "64748B",
      }
      const statusLabels: Record<string, string> = {
        completed: "Completed",
        in_progress: "In Progress",
        not_started: "Not Started",
        pending: "Pending",
      }

      let rowY = tableY + 0.38
      const rowH = 0.38
      deptActions.slice(0, 14).forEach((action, i) => {
        const bg = i % 2 === 0 ? "F8FAFB" : ACOB_WHITE
        slide.addShape(pres.ShapeType?.rect ?? "rect", {
          x: 0.25,
          y: rowY,
          w: 12.83,
          h: rowH,
          fill: { color: bg },
          line: { color: "E2E8F0", width: 0.5 },
        })
        // S/N
        slide.addText(`${i + 1}`, {
          x: colX[0] + 0.1,
          y: rowY,
          w: colWidths[0] - 0.1,
          h: rowH,
          fontSize: 10,
          bold: true,
          color: ACOB_SLATE,
          valign: "middle",
          fontFace: "Calibri",
        })
        // Action item — full width, no truncation
        slide.addText(action.title, {
          x: colX[1] + 0.1,
          y: rowY,
          w: colWidths[1] - 0.1,
          h: rowH,
          fontSize: 10,
          color: ACOB_SLATE,
          valign: "middle",
          fontFace: "Calibri",
        })
        const sc = statusColors[action.status] || statusColors.pending
        const sl = statusLabels[action.status] || action.status
        slide.addText(sl, {
          x: colX[2] + 0.1,
          y: rowY + 0.05,
          w: colWidths[2] - 0.2,
          h: rowH - 0.1,
          fontSize: 9,
          bold: true,
          color: ACOB_WHITE,
          fill: { color: sc },
          align: "center",
          valign: "middle",
          fontFace: "Calibri",
        })
        rowY += rowH
      })

      // Footer
      slide.addShape(pres.ShapeType?.rect ?? "rect", {
        x: 0,
        y: 6.9,
        w: "100%",
        h: 0.6,
        fill: { color: ACOB_GREEN },
        line: { color: ACOB_GREEN },
      })
      const nextDept = departments[idx + 1]
      if (nextDept) {
        slide.addText(`NEXT: ${nextDept}`, {
          x: 7,
          y: 6.9,
          w: 6.1,
          h: 0.6,
          fontSize: 10,
          color: ACOB_WHITE,
          align: "right",
          valign: "middle",
          fontFace: "Calibri",
          bold: true,
        })
      }
      slide.addText(String(idx + 3), {
        x: 0,
        y: 6.9,
        w: "100%",
        h: 0.6,
        fontSize: 10,
        color: ACOB_WHITE,
        align: "center",
        valign: "middle",
        fontFace: "Calibri",
        bold: true,
      })
    })

    await pres.writeFile({
      fileName: buildActionPointFilename({ week, year, meetingDate, extension: "pptx", department }),
    })
  } finally {
    inFlightActionPointFileExports.delete(exportKey)
  }
}

// ─── DOCX helpers ─────────────────────────────────────────────────────────────

/** Returns a heading paragraph with coloured text + underline (no shaded background). */
const docxSectionHeading = (title: string, hexBg: string) =>
  new Paragraph({
    children: [
      new TextRun({
        text: title,
        bold: true,
        color: hexBg,
        size: 22,
      }),
    ],
    border: { bottom: { color: hexBg, size: 8, style: "single" } },
    spacing: { before: 200, after: 80 },
  })

/** Converts text to numbered Paragraph array. */
const docxNumberedItems = (text: string, fallback: string) => {
  const lines = text?.split("\n").filter(Boolean) ?? []
  if (lines.length === 0) return [new Paragraph({ text: fallback, spacing: { after: 60 } })]
  return lines.map(
    (l, i) =>
      new Paragraph({
        children: [new TextRun(`${i + 1}. ${l.trim()}`)],
        indent: { left: 480, hanging: 360 },
        spacing: { after: 60 },
      })
  )
}

export const exportToDocx = async (report: WeeklyReport, meetingDate?: string) => {
  const p = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
  const name = p ? `${p.first_name} ${p.last_name}` : "Employee"
  const meetingDateLabel = formatExportMeetingDateLabel(report.week_number, report.year, meetingDate)

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "ACOB LIGHTING TECHNOLOGY LIMITED", bold: true, size: 36, color: "1A7A4A" }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [new TextRun({ text: "General Meeting  ·  Weekly Report", size: 26, color: "334155" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Week ${report.week_number}  ·  ${report.year}`,
                bold: true,
                size: 22,
                color: "1A7A4A",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text: meetingDateLabel, size: 20, color: "64748B" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text: report.department, italics: true, size: 20, color: "1A7A4A" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "Department", bold: true })] })],
                    width: { size: 30, type: WidthType.PERCENTAGE },
                  }),
                  new TableCell({ children: [new Paragraph(report.department)] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "Employee", bold: true })] })],
                  }),
                  new TableCell({ children: [new Paragraph(name)] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "Period", bold: true })] })],
                  }),
                  new TableCell({
                    children: [new Paragraph(`Week ${report.week_number}, ${report.year}`)],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: "", spacing: { after: 200 } }),
          docxSectionHeading("WORK DONE", "1A7A4A"),
          ...docxNumberedItems(report.work_done, "No data provided."),
          new Paragraph({ text: "", spacing: { after: 120 } }),
          docxSectionHeading("TASKS FOR NEW WEEK", "1D6A96"),
          ...docxNumberedItems(report.tasks_new_week, "No data provided."),
          new Paragraph({ text: "", spacing: { after: 120 } }),
          docxSectionHeading("CHALLENGES", "B91C1C"),
          ...docxNumberedItems(report.challenges, "No challenges reported."),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(
    blob,
    buildWeeklyReportFilename({
      week: report.week_number,
      year: report.year,
      meetingDate,
      extension: "docx",
      department: report.department,
    })
  )
}

/**
 * Exports the Action Point to a DOCX document.
 */
export const exportActionPointToDocx = async (
  actions: ActionItem[],
  week: number,
  year: number,
  meetingDate?: string,
  department?: string
) => {
  const meetingDateLabel = formatExportMeetingDateLabel(week, year, meetingDate)

  const { grouped, departments } = groupActionItemsByDepartment(actions)

  const pageFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT] })],
      }),
    ],
  })

  const tocRows = departments.map(
    (dept, i) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(dept)] }),
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(String(i + 3))] })],
          }),
        ],
      })
  )

  const deptChildren: Array<Paragraph | Table> = []
  departments.forEach((dept, i) => {
    const deptActions = grouped[dept] || []
    deptChildren.push(
      new Paragraph({
        children: [new TextRun({ text: dept.toUpperCase(), bold: true, size: 28, color: "1A7A4A" })],
        pageBreakBefore: i > 0,
        spacing: { after: 100 },
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({ children: [new TextRun({ text: "ACTION ITEM", bold: true, color: "FFFFFF" })] }),
                ],
                shading: { type: ShadingType.SOLID, color: "1A7A4A", fill: "1A7A4A" },
                width: { size: 75, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: "STATUS", bold: true, color: "FFFFFF" })] })],
                shading: { type: ShadingType.SOLID, color: "1A7A4A", fill: "1A7A4A" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
          ...deptActions.map(
            (a) =>
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(a.title)] }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: a.status.replace("_", " ").toUpperCase(), bold: true })],
                      }),
                    ],
                  }),
                ],
              })
          ),
        ],
      }),
      new Paragraph({ text: "", spacing: { after: 120 } })
    )
  })

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "ACOB LIGHTING TECHNOLOGY LIMITED", bold: true, size: 36, color: "1A7A4A" }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [new TextRun({ text: "General Meeting  ·  Action Points", size: 26, color: "334155" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `Week ${week}  ·  ${year}`, bold: true, size: 22, color: "1A7A4A" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text: meetingDateLabel, size: 20, color: "64748B" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [new TextRun({ text: "Departments in This Report", bold: true, size: 24, color: "0F2D1F" })],
            spacing: { after: 100 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tocRows,
          }),
        ],
      },
      {
        properties: { page: { pageNumbers: { start: 3 } } },
        footers: { default: pageFooter },
        children: deptChildren,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, buildActionPointFilename({ week, year, meetingDate, extension: "docx", department }))
}

export const exportActionPointToXLSX = async (
  actions: ActionItem[],
  week: number,
  year: number,
  department?: string,
  meetingDate?: string
) => {
  const exportKey = ["xlsx", week, year, meetingDate || "", department || "all", actions.length].join(":")
  if (inFlightActionPointFileExports.has(exportKey)) return
  inFlightActionPointFileExports.add(exportKey)

  try {
    const XLSX = await import("xlsx")
    const filteredActions = department
      ? actions.filter((item) => getDepartmentAliases(department).includes(normalizeDepartmentName(item.department)))
      : actions

    const rows = filteredActions.map((item, index) => ({
      "S/N": index + 1,
      Department: normalizeDepartmentName(item.department),
      "Action Item": item.title,
      Description: item.description || "",
      Status: formatStatusLabel(item.status),
      Week: item.week_number || week,
      Year: item.year || year,
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Message: "No action items to export." }])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Action Points")

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      buildActionPointFilename({
        week,
        year,
        meetingDate,
        extension: "xlsx",
        department: department || "All Departments",
      })
    )
  } finally {
    inFlightActionPointFileExports.delete(exportKey)
  }
}

export const exportAllToDocx = async (reports: WeeklyReport[], week: number, year: number, meetingDate?: string) => {
  const sortedReports = sortReportsByDepartment(reports)
  const meetingDateLabel = formatExportMeetingDateLabel(week, year, meetingDate)

  const tocChildren: Array<Paragraph | Table> = [
    new Paragraph({
      children: [new TextRun({ text: "ACOB LIGHTING TECHNOLOGY LIMITED", bold: true, size: 36, color: "1A7A4A" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "General Meeting  ·  Weekly Report", size: 26, color: "334155" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Week ${week}  ·  ${year}`, bold: true, size: 22, color: "1A7A4A" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meetingDateLabel, size: 20, color: "64748B" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Departments in This Report", bold: true, size: 24, color: "0F2D1F" })],
      spacing: { after: 100 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: sortedReports.map(
        (r, i) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(r.department)] }),
              new TableCell({
                width: { size: 15, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(String(i + 3))] })],
              }),
            ],
          })
      ),
    }),
  ]

  const reportChildren: Paragraph[] = []
  sortedReports.forEach((report, idx) => {
    reportChildren.push(
      new Paragraph({
        children: [new TextRun({ text: report.department.toUpperCase(), bold: true, size: 32, color: "FFFFFF" })],
        shading: { type: ShadingType.SOLID, color: "1A7A4A", fill: "1A7A4A" },
        pageBreakBefore: idx > 0,
        spacing: { after: 80 },
      }),
      docxSectionHeading("WORK DONE", "1A7A4A"),
      ...docxNumberedItems(report.work_done, "No data provided."),
      new Paragraph({ text: "", spacing: { after: 120 } }),
      docxSectionHeading("TASKS FOR NEW WEEK", "1D6A96"),
      ...docxNumberedItems(report.tasks_new_week, "No data provided."),
      new Paragraph({ text: "", spacing: { after: 120 } }),
      docxSectionHeading("CHALLENGES", "B91C1C"),
      ...docxNumberedItems(report.challenges, "No challenges reported."),
      new Paragraph({ text: "", spacing: { after: 120 } })
    )
  })

  const pageFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT] })],
      }),
    ],
  })

  const doc = new Document({
    sections: [
      { children: tocChildren },
      {
        properties: { page: { pageNumbers: { start: 3 } } },
        footers: { default: pageFooter },
        children: reportChildren,
      },
    ],
  })
  const blob = await Packer.toBlob(doc)
  saveAs(
    blob,
    buildWeeklyReportFilename({
      week,
      year,
      meetingDate,
      extension: "docx",
      allDepartments: true,
    })
  )
}

export const exportToXLSX = async (report: WeeklyReport, meetingDate?: string) => {
  const buildSectionRows = (section: string, text: string) => {
    const lines = autoNumberLines(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      return [
        {
          Department: report.department,
          Week: report.week_number,
          Year: report.year,
          Section: section,
          "Item #": "",
          Item: "No entry",
        },
      ]
    }

    return lines.map((line, index) => ({
      Department: report.department,
      Week: report.week_number,
      Year: report.year,
      Section: section,
      "Item #": index + 1,
      Item: line.replace(/^\d+[.)]\s*/, "").trim(),
    }))
  }

  const XLSX = await import("xlsx")
  const rows = [
    ...buildSectionRows("Work Done", report.work_done || ""),
    ...buildSectionRows("Tasks for New Week", report.tasks_new_week || ""),
    ...buildSectionRows("Challenges", report.challenges || ""),
  ]

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 20 }, { wch: 8 }, { wch: 90 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Weekly Report")

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  saveAs(
    new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    buildWeeklyReportFilename({
      week: report.week_number,
      year: report.year,
      meetingDate,
      extension: "xlsx",
      department: report.department,
    })
  )
}

export const exportAllToXLSX = async (reports: WeeklyReport[], week: number, year: number, meetingDate?: string) => {
  const buildSectionRows = (report: WeeklyReport, section: string, text: string) => {
    const lines = autoNumberLines(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      return [
        {
          Department: report.department,
          Week: report.week_number,
          Year: report.year,
          Section: section,
          "Item #": "",
          Item: "No entry",
        },
      ]
    }

    return lines.map((line, index) => ({
      Department: report.department,
      Week: report.week_number,
      Year: report.year,
      Section: section,
      "Item #": index + 1,
      Item: line.replace(/^\d+[.)]\s*/, "").trim(),
    }))
  }

  const XLSX = await import("xlsx")
  const sortedReports = sortReportsByDepartment(reports)
  const rows = sortedReports.flatMap((report) => [
    ...buildSectionRows(report, "Work Done", report.work_done || ""),
    ...buildSectionRows(report, "Tasks for New Week", report.tasks_new_week || ""),
    ...buildSectionRows(report, "Challenges", report.challenges || ""),
  ])

  const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Message: "No weekly reports to export." }])
  worksheet["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 20 }, { wch: 8 }, { wch: 90 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Weekly Reports")

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  saveAs(
    new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    buildWeeklyReportFilename({
      week,
      year,
      meetingDate,
      extension: "xlsx",
      allDepartments: true,
    })
  )
}

// ─── ACOB PPTX Design Helpers ────────────────────────────────────────────────
// ACOB brand colours
const ACOB_GREEN = "1A7A4A" // primary green
const ACOB_GREEN_LIGHT = "E8F5EE" // light green tint
const ACOB_DARK = "0F2D1F" // deep dark green
const ACOB_SLATE = "334155"
const ACOB_MUTED = "64748B"
const ACOB_WHITE = "FFFFFF"
const ACOB_OFFWHITE = "F8FAF9"

// Logo URLs
// acob-logo-light.webp = full colour logo (dark text + green) — use on light/white backgrounds
// acob-logo-dark.webp  = green-only minimal logo — use on dark/green backgrounds
const LOGO_FULL = getSeasonalLogoPaths("light").full // full ACOB LIGHTING logo
const LOGO_ICON = getSeasonalLogoPaths("light").icon // green-only icon variant

export type WeeklyPptxTheme = "light" | "dark"
export type WeeklyDeptOrder = "default" | "alpha" | "random"

const getWeeklyPptxThemeColors = (theme: WeeklyPptxTheme = "light") => {
  if (theme === "dark") {
    return {
      canvas: "111111",
      header: "000000",
      accent: ACOB_GREEN,
      footer: ACOB_GREEN,
      textPrimary: "F5F5F5",
      textMuted: "A3A3A3",
      textInverse: ACOB_WHITE,
      card: "1C1C1C",
      cardBorder: "2C2C2C",
      separator: "3A3A3A",
      sectionText: "E5E7EB",
      titleFill: ACOB_GREEN,
    }
  }

  return {
    canvas: ACOB_OFFWHITE,
    header: ACOB_DARK,
    accent: ACOB_GREEN,
    footer: ACOB_GREEN,
    textPrimary: ACOB_DARK,
    textMuted: ACOB_MUTED,
    textInverse: ACOB_WHITE,
    card: ACOB_WHITE,
    cardBorder: "E2E8F0",
    separator: "E2E8F0",
    sectionText: ACOB_SLATE,
    titleFill: ACOB_GREEN,
  }
}

/** Adds the ACOB cover slide. */
const addCoverSlide = (
  pres: PptxPresentation,
  week: number,
  year: number,
  subtitle?: string,
  theme: WeeklyPptxTheme = "light",
  meetingDate?: string
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const slide = pres.addSlide()

  // White body, dark header/footer only
  slide.background = { color: theme === "dark" ? colors.canvas : ACOB_WHITE }

  // ── Top dark header bar ───────────────────────────────────────────────────
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: 0,
    w: "100%",
    h: 0.55,
    fill: { color: colors.header },
    line: { color: colors.header },
  })
  // thin green accent under header
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: 0.55,
    w: "100%",
    h: 0.06,
    fill: { color: colors.accent },
    line: { color: colors.accent },
  })

  // ── Centred logo (full ACOB LIGHTING logo) ────────────────────────────────
  // Logo natural ratio ≈ 4.6 : 1  →  w=4.6, h=1.0
  // Slide body: y=0.61 → y=6.9  (height = 6.29")
  // Full visual block height:
  //   logo(1.0) + gap(0.25) + divider(0) + gap(0.2) + GM(0.7) + gap(0.12) + WR(0.55) + gap(0.2) + pill(0.42) + gap(0.18) + date(0.45) = 4.07
  //   (+ subtitle 0.5 if present, but centre without it)
  // Block start = bodyCentre - blockH/2 = (0.61 + 6.29/2) - 4.07/2 = 3.755 - 2.035 = 1.72
  const blockStart = 1.72
  const logoW = 4.6
  const logoH = 1.15
  const logoX = (13.33 - logoW) / 2
  try {
    slide.addImage({
      path: theme === "dark" ? LOGO_ICON : LOGO_FULL,
      x: logoX,
      y: blockStart,
      w: logoW,
      h: logoH,
    })
  } catch {
    slide.addText("ACOB LIGHTING TECHNOLOGY LIMITED", {
      x: 0.5,
      y: blockStart,
      w: 12.33,
      h: logoH,
      fontSize: 22,
      bold: true,
      color: colors.textPrimary,
      align: "center",
      fontFace: "Calibri",
    })
  }

  // ── Green divider ─────────────────────────────────────────────────────────
  slide.addShape(pres.ShapeType?.line ?? "line", {
    x: 1.5,
    y: blockStart + 1.35,
    w: 10.33,
    h: 0,
    line: { color: colors.accent, width: 1.5 },
  })

  // ── Main title block ──────────────────────────────────────────────────────
  const titleStart = blockStart + 1.55

  // "General Meeting"
  slide.addText("General Meeting", {
    x: 0.5,
    y: titleStart,
    w: 12.33,
    h: 0.7,
    fontSize: 40,
    bold: true,
    color: colors.textPrimary,
    align: "center",
    fontFace: "Calibri",
  })

  // "Weekly Report"
  slide.addText("Weekly Report", {
    x: 0.5,
    y: titleStart + 0.82,
    w: 12.33,
    h: 0.55,
    fontSize: 26,
    bold: false,
    color: colors.accent,
    align: "center",
    fontFace: "Calibri",
  })

  // "Week N" pill
  const weekLabel = `Week ${week}`
  slide.addText(weekLabel, {
    x: 5.4,
    y: titleStart + 1.57,
    w: 2.53,
    h: 0.42,
    fontSize: 15,
    bold: true,
    color: colors.textInverse,
    fill: { color: colors.accent },
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
  })

  const meetingDateLabel = formatExportMeetingDateLabel(week, year, meetingDate)
  slide.addText(meetingDateLabel, {
    x: 0.5,
    y: titleStart + 2.15,
    w: 12.33,
    h: 0.45,
    fontSize: 16,
    bold: false,
    color: colors.textMuted,
    align: "center",
    fontFace: "Calibri",
  })

  // Optional subtitle (dept name for single-report export)
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5,
      y: titleStart + 2.7,
      w: 12.33,
      h: 0.4,
      fontSize: 14,
      bold: false,
      color: colors.accent,
      align: "center",
      fontFace: "Calibri",
      italic: true,
    })
  }

  // ── Bottom green strip ────────────────────────────────────────────────────
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: 6.9,
    w: "100%",
    h: 0.6,
    fill: { color: colors.footer },
    line: { color: colors.footer },
  })
  slide.addText("Confidential — ACOB Internal Use Only", {
    x: 0,
    y: 6.9,
    w: "100%",
    h: 0.6,
    fontSize: 10,
    color: colors.textInverse,
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
  })

  return slide
}

/**
 * Adds a department title slide (full-bleed green).
 */
const addDeptTitleSlide = (
  pres: PptxPresentation,
  department: string,
  submittedBy: string,
  pageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const slide = pres.addSlide()
  slide.background = { color: colors.titleFill }

  // Subtle top-right circle decoration
  slide.addShape(pres.ShapeType?.ellipse ?? "ellipse", {
    x: 10.5,
    y: -1.2,
    w: 4,
    h: 4,
    fill: { color: colors.header, transparency: 60 },
    line: { color: colors.header, transparency: 60 },
  })

  slide.addText(department.toUpperCase(), {
    x: 0.6,
    y: 2.4,
    w: 12,
    h: 1.2,
    fontSize: 48,
    bold: true,
    color: colors.textInverse,
    fontFace: "Calibri",
    align: "left",
  })

  slide.addShape(pres.ShapeType?.line ?? "line", {
    x: 0.6,
    y: 3.7,
    w: 5,
    h: 0,
    line: { color: colors.textInverse, width: 2, transparency: 40 },
  })

  // slide.addText(`Submitted by: ${submittedBy}`, {
  //     x: 0.6, y: 3.9, w: 12, h: 0.4,
  //     fontSize: 16, color: ACOB_WHITE,
  //     fontFace: "Calibri",
  //     transparency: 20,
  // })

  if (typeof pageNumber === "number") {
    slide.addText(String(pageNumber), {
      x: 0,
      y: 6.9,
      w: "100%",
      h: 0.5,
      fontSize: 10,
      bold: true,
      color: colors.textInverse,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
    })
  }

  return slide
}

/**
 * Adds a numbered department index slide (shown after the cover in bulk export).
 */
const addDeptIndexSlide = (
  pres: PptxPresentation,
  departments: string[],
  week: number,
  year: number,
  pageNumberForDepartment: (index: number) => number = (index) => index + 3,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const slide = pres.addSlide()
  slide.background = { color: colors.canvas }

  // Header
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: 0,
    w: "100%",
    h: 0.65,
    fill: { color: colors.header },
    line: { color: colors.header },
  })
  slide.addText("Departments in This Report", {
    x: 0.3,
    y: 0,
    w: 10,
    h: 0.65,
    fontSize: 16,
    bold: true,
    color: colors.textInverse,
    valign: "middle",
    fontFace: "Calibri",
  })
  slide.addText(`Week ${week}, ${year}`, {
    x: 10,
    y: 0,
    w: 3,
    h: 0.65,
    fontSize: 12,
    color: theme === "dark" ? colors.textMuted : ACOB_GREEN_LIGHT,
    valign: "middle",
    align: "right",
    fontFace: "Calibri",
  })

  // Numbered list
  const startY = 1.0
  const rowH = 0.5
  departments.forEach((dept, i) => {
    const y = startY + i * rowH
    // Number badge
    slide.addShape(pres.ShapeType?.ellipse ?? "ellipse", {
      x: 0.5,
      y: y + 0.05,
      w: 0.38,
      h: 0.38,
      fill: { color: colors.accent },
      line: { color: colors.accent },
    })
    slide.addText(`${i + 1}`, {
      x: 0.5,
      y: y + 0.05,
      w: 0.38,
      h: 0.38,
      fontSize: 11,
      bold: true,
      color: colors.textInverse,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
    })
    slide.addText(dept, {
      x: 1.05,
      y: y,
      w: 10.5,
      h: 0.45,
      fontSize: 16,
      color: colors.textPrimary,
      valign: "middle",
      fontFace: "Calibri",
    })
    slide.addText(String(pageNumberForDepartment(i)), {
      x: 11.5,
      y: y,
      w: 1.3,
      h: 0.45,
      fontSize: 14,
      bold: true,
      color: colors.accent,
      valign: "middle",
      align: "right",
      fontFace: "Calibri",
    })
    // subtle separator line
    if (i < departments.length - 1) {
      slide.addShape(pres.ShapeType?.line ?? "line", {
        x: 0.5,
        y: y + rowH - 0.05,
        w: 12.3,
        h: 0,
        line: { color: colors.separator, width: 0.5 },
      })
    }
  })

  // Bottom strip
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: 6.9,
    w: "100%",
    h: 0.6,
    fill: { color: colors.footer },
    line: { color: colors.footer },
  })
  return slide
}

const PPTX_WEEKLY_BODY_FONT_SIZE = 14
const PPTX_WEEKLY_MIN_BODY_FONT_SIZE = 7
const PPTX_WEEKLY_LINE_HEIGHT_RATIO = 1.15
const PPTX_WEEKLY_AVG_CHAR_WIDTH_RATIO = 0.48
const PPTX_WEEKLY_LINE_SPACING_MULTIPLE = 1.3

const WEEKLY_CONTENT_LAYOUT = {
  headerH: 0.65,
  marginX: 0.25,
  slideW: 13.33,
  footerY: 6.9,
  footerH: 0.6,
}

const applyWeeklySlideTransition = (slide: PptxSlide) => {
  // PptxGenJS transition support varies by viewer/version; keep this guarded.
  try {
    slide.transition = {
      type: "fade",
      duration: 0.4,
    }
  } catch {
    /* no-op */
  }
}

const getWeeklyContentBoxes = () => {
  const { headerH, marginX, slideW, footerY } = WEEKLY_CONTENT_LAYOUT
  // Tuned so the full-page Work Done container is ~15.14cm high.
  const bodyBottomSafety = 0.14
  const textBottomSafety = 0.1
  const usableW = slideW - marginX * 2
  const col1W = usableW * (3 / 5)
  const col2W = usableW * (2 / 5) - 0.15
  const col2X = marginX + col1W + 0.15

  const startY = headerH + 0.15
  const availH = footerY - startY - bodyBottomSafety
  const row1H = availH * (4 / 6)
  const row2H = availH * (2 / 6) - 0.15
  const row1Y = startY
  const row2Y = startY + row1H + 0.15
  const page2Gap = 0.08
  const page2TopH = (availH - page2Gap) * 0.75
  const page2BottomH = (availH - page2Gap) * 0.25

  return {
    row1Left: {
      x: marginX,
      y: row1Y,
      w: col1W,
      h: row1H,
      textW: col1W - 0.3,
      textH: Math.max(0.6, row1H - 0.56 - textBottomSafety),
    },
    row1Right: {
      x: col2X,
      y: row1Y,
      w: col2W,
      h: row1H,
      textW: col2W - 0.3,
      textH: Math.max(0.6, row1H - 0.56 - textBottomSafety),
    },
    row2Full: {
      x: marginX,
      y: row2Y,
      w: usableW,
      h: row2H,
      textW: usableW - 0.3,
      textH: Math.max(0.6, row2H - 0.56 - textBottomSafety),
    },
    continuation: {
      x: marginX,
      y: startY,
      w: usableW,
      h: availH,
      textW: usableW - 0.3,
      textH: Math.max(0.6, availH - 0.56 - textBottomSafety),
    },
    page2Top: {
      x: marginX,
      y: startY,
      w: usableW,
      h: page2TopH,
      textW: usableW - 0.3,
      textH: Math.max(0.6, page2TopH - 0.56 - textBottomSafety),
    },
    page2Bottom: {
      x: marginX,
      y: startY + page2TopH + page2Gap,
      w: usableW,
      h: page2BottomH,
      textW: usableW - 0.3,
      textH: Math.max(0.6, page2BottomH - 0.56 - textBottomSafety),
    },
  }
}

type WeeklySectionPlan = {
  key: "work_done" | "tasks_new_week" | "challenges"
  title: string
  color: string
  text: string
  fontSize: number
  allowAutoShrink: boolean
}

export type WeeklyPptxMode = "compact" | "full"

const withListItemSpacing = (text: string): string => {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return ""
  return lines.join("\n")
}

const countWrappedLines = (text: string, maxCharsPerLine: number): number => {
  const sourceLines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
  let total = 0

  const wrapPlainLineCount = (line: string, limit: number): number => {
    if (!line) return 1
    if (line.length <= limit) return 1
    const words = line.split(/\s+/)
    let lines = 0
    let current = ""
    words.forEach((w) => {
      const candidate = current ? `${current} ${w}` : w
      if (candidate.length <= limit) {
        current = candidate
      } else {
        if (current) lines += 1
        if (w.length > limit) {
          lines += Math.ceil(w.length / limit)
          current = ""
        } else {
          current = w
        }
      }
    })
    if (current) lines += 1
    return Math.max(1, lines)
  }

  sourceLines.forEach((raw) => {
    const line = raw.trimEnd()
    if (!line) {
      total += 1
      return
    }
    const numberedMatch = line.match(/^(\d+\.)\s+(.*)$/)
    if (!numberedMatch) {
      total += wrapPlainLineCount(line, maxCharsPerLine)
      return
    }
    const prefix = `${numberedMatch[1]} `
    const body = numberedMatch[2] || ""
    const bodyLimit = Math.max(10, maxCharsPerLine - prefix.length)
    total += wrapPlainLineCount(body, bodyLimit)
  })

  return total
}

const chooseSectionFontSize = (
  text: string,
  boxWIn: number,
  boxHIn: number,
  preferredFont = PPTX_WEEKLY_BODY_FONT_SIZE,
  minFont = PPTX_WEEKLY_MIN_BODY_FONT_SIZE,
  _strictFit = true
): number => {
  for (let fontSize = preferredFont; fontSize >= minFont; fontSize -= 0.5) {
    const charsPerLine = Math.max(10, Math.floor((boxWIn * 72) / (fontSize * PPTX_WEEKLY_AVG_CHAR_WIDTH_RATIO)))
    const effectiveLineHeight = fontSize * PPTX_WEEKLY_LINE_HEIGHT_RATIO * PPTX_WEEKLY_LINE_SPACING_MULTIPLE
    const maxLines = Math.max(1, Math.floor((boxHIn * 72) / effectiveLineHeight))
    if (countWrappedLines(text, charsPerLine) <= maxLines) return fontSize
  }
  return minFont
}

const buildWeeklySectionPlan = (
  key: WeeklySectionPlan["key"],
  title: string,
  color: string,
  rawText: string,
  fallbackText: string,
  boxWIn: number,
  boxHIn: number,
  minFont = PPTX_WEEKLY_MIN_BODY_FONT_SIZE,
  strictFit = true,
  allowAutoShrink = true
): WeeklySectionPlan => {
  const normalized = autoNumberLines(rawText) || fallbackText
  const text = withListItemSpacing(normalized)
  return {
    key,
    title,
    color,
    text,
    fontSize: chooseSectionFontSize(text, boxWIn, boxHIn, PPTX_WEEKLY_BODY_FONT_SIZE, minFont, strictFit),
    allowAutoShrink,
  }
}

const getReportSectionPlans = (report: WeeklyReport): WeeklySectionPlan[] => {
  const boxes = getWeeklyContentBoxes()
  return [
    buildWeeklySectionPlan(
      "work_done",
      "WORK DONE",
      ACOB_GREEN,
      report.work_done,
      "No data provided.",
      boxes.continuation.textW,
      boxes.continuation.textH
    ),
    buildWeeklySectionPlan(
      "tasks_new_week",
      "TASKS FOR NEW WEEK",
      "1D6A96",
      report.tasks_new_week,
      "No data provided.",
      boxes.page2Top.textW,
      boxes.page2Top.textH
    ),
    buildWeeklySectionPlan(
      "challenges",
      "CHALLENGES",
      "B91C1C",
      report.challenges,
      "No challenges reported.",
      boxes.page2Bottom.textW,
      boxes.page2Bottom.textH
    ),
  ]
}

const addWeeklyHeaderAndFooter = (
  pres: PptxPresentation,
  slide: PptxSlide,
  department: string,
  nextDept?: string,
  pageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const { headerH, footerY, footerH } = WEEKLY_CONTENT_LAYOUT

  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: 0,
    w: "100%",
    h: headerH,
    fill: { color: colors.header },
    line: { color: colors.header },
  })

  slide.addText(department.toUpperCase(), {
    x: 0.3,
    y: 0,
    w: 9,
    h: headerH,
    fontSize: 16,
    bold: true,
    color: colors.textInverse,
    valign: "middle",
    fontFace: "Calibri",
  })

  try {
    slide.addImage({
      path: LOGO_ICON,
      x: 11.45,
      y: 0.14,
      w: 1.7,
      h: 0.45,
    })
  } catch {
    /* skip */
  }

  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: 0,
    y: footerY,
    w: "100%",
    h: footerH,
    fill: { color: colors.footer },
    line: { color: colors.footer },
  })

  if (nextDept) {
    slide.addText(`NEXT: ${nextDept}`, {
      x: 7,
      y: footerY,
      w: 6.1,
      h: footerH,
      fontSize: 10,
      color: colors.textInverse,
      align: "right",
      valign: "middle",
      fontFace: "Calibri",
      bold: true,
    })
  }

  if (typeof pageNumber === "number") {
    slide.addText(String(pageNumber), {
      x: 0,
      y: footerY,
      w: "100%",
      h: footerH,
      fontSize: 10,
      color: colors.textInverse,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      bold: true,
    })
  }
}

const addSectionCard = (
  pres: PptxPresentation,
  slide: PptxSlide,
  box: { x: number; y: number; w: number; h: number; textW: number; textH: number },
  title: string,
  color: string,
  text: string,
  fontSize: number,
  allowAutoShrink = true,
  useManualHangingWrap = false,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fill: { color: colors.card },
    line: { color: colors.cardBorder, width: 1 },
  })
  slide.addShape(pres.ShapeType?.rect ?? "rect", {
    x: box.x + 0.15,
    y: box.y + 0.1,
    w: box.w - 0.3,
    h: 0.3,
    fill: { color },
    line: { color, width: 0 },
  })
  slide.addText(title, {
    x: box.x + 0.2,
    y: box.y + 0.12,
    w: box.w - 0.4,
    h: 0.22,
    fontSize: 8,
    bold: true,
    color: colors.textInverse,
    fontFace: "Calibri",
  })
  const wrappedText =
    useManualHangingWrap && fontSize > 0
      ? wrapTextByCharsCompact(
          text,
          Math.max(10, Math.floor(((box.textW * 72) / (fontSize * PPTX_WEEKLY_AVG_CHAR_WIDTH_RATIO)) * 1.12))
        ).join("\n")
      : text

  slide.addText(wrappedText, {
    x: box.x + 0.15,
    y: box.y + 0.46,
    w: box.textW,
    h: box.textH,
    fontSize,
    color: colors.sectionText,
    valign: "top",
    fontFace: "Calibri",
    breakLine: !useManualHangingWrap,
    lineSpacingMultiple: PPTX_WEEKLY_LINE_SPACING_MULTIPLE,
    fit: allowAutoShrink ? "shrink" : undefined,
  })
}

const wrapTextByCharsCompact = (text: string, maxCharsPerLine: number): string[] => {
  const sourceLines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
  const wrapped: string[] = []

  const wrapPlainLine = (line: string, limit: number): string[] => {
    if (!line) return [""]
    if (line.length <= limit) return [line]
    const words = line.split(/\s+/)
    const out: string[] = []
    let current = ""
    words.forEach((w) => {
      const candidate = current ? `${current} ${w}` : w
      if (candidate.length <= limit) {
        current = candidate
      } else {
        if (current) out.push(current)
        if (w.length > limit) {
          for (let i = 0; i < w.length; i += limit) out.push(w.slice(i, i + limit))
          current = ""
        } else {
          current = w
        }
      }
    })
    if (current) out.push(current)
    return out
  }

  sourceLines.forEach((raw) => {
    const line = raw.trimEnd()
    if (!line) {
      wrapped.push("")
      return
    }
    const numberedMatch = line.match(/^(\d+\.)\s+(.*)$/)
    if (!numberedMatch) {
      wrapped.push(...wrapPlainLine(line, maxCharsPerLine))
      return
    }

    const prefix = `${numberedMatch[1]} `
    const body = numberedMatch[2] || ""
    const bodyLimit = Math.max(10, maxCharsPerLine - prefix.length)
    const bodyLines = wrapPlainLine(body, bodyLimit)
    if (bodyLines.length === 0) {
      wrapped.push(prefix.trimEnd())
      return
    }
    wrapped.push(prefix + bodyLines[0])
    const continuationPad = " ".repeat(prefix.length + 1)
    for (let i = 1; i < bodyLines.length; i++) {
      wrapped.push(continuationPad + bodyLines[i])
    }
  })

  return wrapped
}

const fitTextToPptxBoxCompact = (
  text: string,
  boxWIn: number,
  boxHIn: number,
  preferredFont = 11,
  minFont = 7
): { text: string; fontSize: number } => {
  const lineHeightRatio = 1.25
  const avgCharWidthRatio = 0.56

  for (let fontSize = preferredFont; fontSize >= minFont; fontSize -= 0.5) {
    const charsPerLine = Math.max(10, Math.floor((boxWIn * 72) / (fontSize * avgCharWidthRatio)))
    const maxLines = Math.max(1, Math.floor((boxHIn * 72) / (fontSize * lineHeightRatio)))
    const lines = wrapTextByCharsCompact(text, charsPerLine)
    if (lines.length <= maxLines) {
      return { text: lines.join("\n"), fontSize }
    }
  }

  const finalSize = minFont
  const charsPerLine = Math.max(10, Math.floor((boxWIn * 72) / (finalSize * avgCharWidthRatio)))
  const maxLines = Math.max(1, Math.floor((boxHIn * 72) / (finalSize * lineHeightRatio)))
  const lines = wrapTextByCharsCompact(text, charsPerLine)
  const clipped = lines.slice(0, Math.max(1, maxLines - 1))
  clipped.push("... continued")
  return { text: clipped.join("\n"), fontSize: finalSize }
}

const addCompactContentSlide = (
  pres: PptxPresentation,
  department: string,
  report: WeeklyReport,
  nextDept?: string,
  pageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const slide = pres.addSlide()
  slide.background = { color: colors.canvas }
  addWeeklyHeaderAndFooter(pres, slide, department, nextDept, pageNumber, theme)

  const boxes = getWeeklyContentBoxes()
  const workDoneText = autoNumberLines(report.work_done) || "No data provided."
  const tasksText = autoNumberLines(report.tasks_new_week) || "No data provided."
  const challengesText = autoNumberLines(report.challenges) || "No challenges reported."

  const workDoneFitted = fitTextToPptxBoxCompact(workDoneText, boxes.row1Left.textW, boxes.row1Left.textH)
  const tasksFitted = fitTextToPptxBoxCompact(tasksText, boxes.row1Right.textW, boxes.row1Right.textH)
  const challengesFitted = fitTextToPptxBoxCompact(challengesText, boxes.row2Full.textW, boxes.row2Full.textH)

  addSectionCard(
    pres,
    slide,
    boxes.row1Left,
    "WORK DONE",
    ACOB_GREEN,
    workDoneFitted.text,
    workDoneFitted.fontSize,
    false,
    false,
    theme
  )
  addSectionCard(
    pres,
    slide,
    boxes.row1Right,
    "TASKS FOR NEW WEEK",
    "1D6A96",
    tasksFitted.text,
    tasksFitted.fontSize,
    false,
    false,
    theme
  )
  addSectionCard(
    pres,
    slide,
    boxes.row2Full,
    "CHALLENGES",
    "B91C1C",
    challengesFitted.text,
    challengesFitted.fontSize,
    false,
    false,
    theme
  )

  return slide
}

const addWorkDoneSlide = (
  pres: PptxPresentation,
  department: string,
  workDonePlan: WeeklySectionPlan,
  nextDept?: string,
  pageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const slide = pres.addSlide()
  slide.background = { color: colors.canvas }
  addWeeklyHeaderAndFooter(pres, slide, department, nextDept, pageNumber, theme)

  const boxes = getWeeklyContentBoxes()
  addSectionCard(
    pres,
    slide,
    boxes.continuation,
    workDonePlan.title,
    workDonePlan.color,
    workDonePlan.text,
    workDonePlan.fontSize,
    true,
    false,
    theme
  )

  return slide
}

const addTasksAndChallengesSlide = (
  pres: PptxPresentation,
  department: string,
  tasksPlan: WeeklySectionPlan,
  challengesPlan: WeeklySectionPlan,
  nextDept?: string,
  pageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const colors = getWeeklyPptxThemeColors(theme)
  const slide = pres.addSlide()
  slide.background = { color: colors.canvas }
  addWeeklyHeaderAndFooter(pres, slide, department, nextDept, pageNumber, theme)

  const boxes = getWeeklyContentBoxes()
  addSectionCard(
    pres,
    slide,
    boxes.page2Top,
    tasksPlan.title,
    tasksPlan.color,
    tasksPlan.text,
    tasksPlan.fontSize,
    true,
    false,
    theme
  )
  addSectionCard(
    pres,
    slide,
    boxes.page2Bottom,
    challengesPlan.title,
    challengesPlan.color,
    challengesPlan.text,
    challengesPlan.fontSize,
    true,
    false,
    theme
  )

  return slide
}

type DepartmentPptxPlan = {
  report: WeeklyReport
  workDone: WeeklySectionPlan
  tasks: WeeklySectionPlan
  challenges: WeeklySectionPlan
  totalSlides: number
  startPage?: number
}

const buildDepartmentPptxPlan = (report: WeeklyReport): DepartmentPptxPlan => {
  const [workDone, tasks, challenges] = getReportSectionPlans(report)
  return {
    report,
    workDone,
    tasks,
    challenges,
    totalSlides: 3, // title + work done page + tasks/challenges page
  }
}

const renderDepartmentWeeklySlides = (
  pres: PptxPresentation,
  departmentPlan: DepartmentPptxPlan,
  nextDepartmentName?: string,
  startPageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const { report, workDone, tasks, challenges } = departmentPlan
  const p = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
  const name = p ? `${p.first_name} ${p.last_name}` : "Employee"

  let pageCursor = startPageNumber
  const titleSlide = addDeptTitleSlide(pres, report.department, name, undefined, theme)
  applyWeeklySlideTransition(titleSlide)
  if (typeof pageCursor === "number") pageCursor += 1

  const secondPageLabel = `${report.department} 2`
  const workDoneSlide = addWorkDoneSlide(pres, report.department, workDone, secondPageLabel, pageCursor, theme)
  applyWeeklySlideTransition(workDoneSlide)
  if (typeof pageCursor === "number") pageCursor += 1

  const tasksChallengesSlide = addTasksAndChallengesSlide(
    pres,
    report.department,
    tasks,
    challenges,
    nextDepartmentName,
    pageCursor,
    theme
  )
  applyWeeklySlideTransition(tasksChallengesSlide)
}

const renderDepartmentCompactSlides = (
  pres: PptxPresentation,
  report: WeeklyReport,
  nextDepartmentName?: string,
  contentPageNumber?: number,
  theme: WeeklyPptxTheme = "light"
) => {
  const p = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
  const name = p ? `${p.first_name} ${p.last_name}` : "Employee"

  const titleSlide = addDeptTitleSlide(pres, report.department, name, undefined, theme)
  applyWeeklySlideTransition(titleSlide)

  const contentSlide = addCompactContentSlide(
    pres,
    report.department,
    report,
    nextDepartmentName,
    contentPageNumber,
    theme
  )
  applyWeeklySlideTransition(contentSlide)
}

// ─── Public Export Functions ──────────────────────────────────────────────────

export const exportToPPTX = async (
  report: WeeklyReport,
  mode: WeeklyPptxMode = "full",
  theme: WeeklyPptxTheme = "light",
  meetingDate?: string
) => {
  const PptxConstructor = await loadPptxGenJS()
  const pres = new PptxConstructor()
  pres.layout = "LAYOUT_WIDE"

  // Slide 1 — Cover
  const coverSlide = addCoverSlide(pres, report.week_number, report.year, report.department, theme, meetingDate)
  applyWeeklySlideTransition(coverSlide)

  if (mode === "compact") {
    renderDepartmentCompactSlides(pres, report, undefined, 3, theme)
  } else {
    const departmentPlan = buildDepartmentPptxPlan(report)
    // Slides 2+ — Department title + full-mode content slides
    renderDepartmentWeeklySlides(pres, departmentPlan, undefined, 2, theme)
  }

  await pres.writeFile({
    fileName: buildWeeklyReportFilename({
      week: report.week_number,
      year: report.year,
      meetingDate,
      extension: "pptx",
      department: report.department,
      theme,
    }),
  })
}

export const exportAllToPPTX = async (
  reports: WeeklyReport[],
  week: number,
  year: number,
  mode: WeeklyPptxMode = "full",
  theme: WeeklyPptxTheme = "light",
  meetingDate?: string,
  order: WeeklyDeptOrder = "default"
) => {
  const PptxConstructor = await loadPptxGenJS()
  const pres = new PptxConstructor()
  pres.layout = "LAYOUT_WIDE"

  const sortedReports =
    order === "alpha"
      ? [...reports].sort((a, b) =>
          normalizeDepartmentName(a.department).localeCompare(normalizeDepartmentName(b.department))
        )
      : order === "random"
        ? [...reports].sort(() => Math.random() - 0.5)
        : sortReportsByDepartment(reports)
  const departments = sortedReports.map((entry) => entry.department)

  // Slide 1 — Cover
  const coverSlide = addCoverSlide(pres, week, year, undefined, theme, meetingDate)
  applyWeeklySlideTransition(coverSlide)

  let pageCursor = 3
  const departmentStartPages: number[] = []
  if (mode === "compact") {
    sortedReports.forEach((_report) => {
      departmentStartPages.push(pageCursor)
      pageCursor += 2
    })
  } else {
    const departmentPlans = sortedReports.map((report) => buildDepartmentPptxPlan(report))
    departmentPlans.forEach((entry) => {
      departmentStartPages.push(pageCursor)
      entry.startPage = pageCursor
      pageCursor += entry.totalSlides
    })
  }

  // Slide 2 — Dept index
  const indexSlide = addDeptIndexSlide(
    pres,
    departments,
    week,
    year,
    (index) => departmentStartPages[index] ?? 3 + index * 2,
    theme
  )
  applyWeeklySlideTransition(indexSlide)

  if (mode === "compact") {
    sortedReports.forEach((report, idx) => {
      renderDepartmentCompactSlides(
        pres,
        report,
        sortedReports[idx + 1]?.department,
        departmentStartPages[idx] + 1,
        theme
      )
    })
  } else {
    const departmentPlans = sortedReports.map((report, idx) => {
      const entry = buildDepartmentPptxPlan(report)
      entry.startPage = departmentStartPages[idx]
      return entry
    })
    departmentPlans.forEach((departmentPlan, idx) => {
      renderDepartmentWeeklySlides(
        pres,
        departmentPlan,
        departmentPlans[idx + 1]?.report.department,
        departmentPlan.startPage,
        theme
      )
    })
  }

  await pres.writeFile({
    fileName: buildWeeklyReportFilename({
      week,
      year,
      meetingDate,
      extension: "pptx",
      allDepartments: true,
      theme,
    }),
  })
}
