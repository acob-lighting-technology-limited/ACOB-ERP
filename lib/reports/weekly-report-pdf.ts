/**
 * Weekly Report & Action Points PDF generation — shared Node.js library.
 *
 * This is a direct port of the PDF generation code that previously lived only
 * inside the `send-weekly-report` Supabase Edge Function.  Moving it here lets
 * the Next.js API route pre-generate both PDFs before invoking the edge
 * function, keeping the edge function well inside its 2-second CPU budget.
 */

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib"
import { compareDepartments } from "@/shared/departments"

// ─── Colour palette (mirrors edge function) ────────────────────────────────
const GREEN = rgb(0.102, 0.478, 0.29)
const DARK = rgb(0.059, 0.176, 0.122)
const WHITE = rgb(1, 1, 1)
const SLATE = rgb(0.2, 0.255, 0.333)
const MUTED = rgb(0.392, 0.455, 0.545)
const BLUE = rgb(0.114, 0.416, 0.588)
const RED = rgb(0.725, 0.11, 0.11)

// ─── Department ordering ────────────────────────────────────────────────────

// ─── Row types ──────────────────────────────────────────────────────────────
export type WeeklyReportRow = {
  id: string
  department: string
  week_number: number
  year: number
  work_done: string | null
  tasks_new_week: string | null
  challenges: string | null
  status: string | null
}

export type ActionItemRow = {
  id: string
  title: string | null
  department: string
  status: string
  week_number: number
  year: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function autoNumber(text: string): string {
  if (!text?.trim()) return ""
  const lines = text.split("\n").filter((l) => l.trim())
  if (lines[0]?.match(/^\d+\.\s/)) return lines.join("\n")
  return lines.map((l, i) => `${i + 1}. ${l.trim()}`).join("\n")
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = current ? current + " " + word : word
    }
  }
  if (current) lines.push(current.trim())
  return lines
}

function sanitizeForPdf(text: string, font: PDFFont): string {
  if (!text) return ""
  let out = ""
  for (const ch of text) {
    if (ch === "\r") continue
    if (ch === "\f") continue // Ctrl+L (form feed) — drop
    if (ch === "\n") {
      out += "\n"
      continue
    }
    if (ch === "\t") {
      out += " "
      continue
    }
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      // Drop characters unsupported by Helvetica (e.g. U+2060)
    }
  }
  return out
}

async function drawLogoInHeader(
  doc: PDFDocument,
  page: PDFPage,
  logoBytes: Uint8Array | null,
  headerH: number,
  H: number,
  W: number
) {
  if (!logoBytes) return
  try {
    const img = await doc.embedPng(logoBytes)
    const dims = img.scaleToFit(108, 26)
    page.drawImage(img, {
      x: W - dims.width - 17,
      y: H - headerH + (headerH - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    })
  } catch {
    /* skip if embed fails */
  }
}

// ─── Logo fetching ───────────────────────────────────────────────────────────

const STORAGE_BASE = "https://itqegqxeqkeogwrvlzlj.supabase.co/storage/v1/object/public/assets/logos"

export async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function fetchLogoPair(): Promise<{
  coverLogoBytes: Uint8Array | null
  headerLogoBytes: Uint8Array | null
}> {
  const [coverLogoBytes, headerLogoBytes] = await Promise.all([
    fetchLogoBytes(`${STORAGE_BASE}/acob-logo-light.png`),
    fetchLogoBytes(`${STORAGE_BASE}/acob-logo-dark.png`),
  ])
  return { coverLogoBytes, headerLogoBytes }
}

// ─── Cover page ──────────────────────────────────────────────────────────────

async function addCoverPage(
  doc: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
  week: number,
  year: number,
  meetingDateLabel: string,
  subtitle: string,
  secondaryTitle = "Weekly Report",
  coverLogoBytes: Uint8Array | null
) {
  const page = doc.addPage([595, 842])
  const { width: W, height: H } = page.getSize()

  page.drawRectangle({ x: 0, y: H - 60, width: W, height: 60, color: DARK })
  page.drawRectangle({ x: 0, y: H - 66, width: W, height: 6, color: GREEN })

  if (coverLogoBytes) {
    try {
      const img = await doc.embedPng(coverLogoBytes)
      const dims = img.scaleToFit(350, 80)
      page.drawImage(img, {
        x: W / 2 - dims.width / 2,
        y: H / 2 + 80,
        width: dims.width,
        height: dims.height,
      })
    } catch {
      /* skip */
    }
  } else {
    page.drawText("ACOB LIGHTING TECHNOLOGY LIMITED", {
      x: W / 2 - 150,
      y: H / 2 + 90,
      size: 14,
      font: bold,
      color: DARK,
    })
  }

  page.drawRectangle({ x: 80, y: H / 2 + 60, width: W - 160, height: 2, color: GREEN })

  const gmText = "General Meeting"
  const gmWidth = bold.widthOfTextAtSize(gmText, 28)
  page.drawText(gmText, { x: W / 2 - gmWidth / 2, y: H / 2 + 24, size: 28, font: bold, color: DARK })

  const wrText = secondaryTitle
  const wrWidth = regular.widthOfTextAtSize(wrText, 20)
  page.drawText(wrText, { x: W / 2 - wrWidth / 2, y: H / 2 + 2, size: 20, font: regular, color: GREEN })

  const pillLabel = `Week ${week}`
  const pillLabelW = bold.widthOfTextAtSize(pillLabel, 12)
  const pillW = pillLabelW + 36
  const pillH = 24
  const pillX = W / 2 - pillW / 2
  const pillY = H / 2 - 36
  page.drawRectangle({ x: pillX, y: pillY, width: pillW, height: pillH, color: GREEN })
  page.drawText(pillLabel, { x: pillX + 18, y: pillY + 7, size: 12, font: bold, color: WHITE })

  const dateWidth = regular.widthOfTextAtSize(meetingDateLabel, 10)
  page.drawText(meetingDateLabel, { x: W / 2 - dateWidth / 2, y: pillY - 22, size: 10, font: regular, color: MUTED })

  if (subtitle) {
    const stWidth = regular.widthOfTextAtSize(subtitle, 10)
    page.drawText(subtitle, { x: W / 2 - stWidth / 2, y: pillY - 42, size: 10, font: regular, color: GREEN })
  }

  page.drawRectangle({ x: 0, y: 0, width: W, height: 40, color: GREEN })
  page.drawText("Confidential \u2014 ACOB Internal Use Only", {
    x: W / 2 - 110,
    y: 14,
    size: 8,
    font: regular,
    color: WHITE,
  })
}

// ─── TOC page ────────────────────────────────────────────────────────────────

async function addTOCPage(
  doc: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
  title: string,
  entries: string[],
  headerLogoBytes: Uint8Array | null
) {
  const page = doc.addPage([595, 842])
  const { width: W, height: H } = page.getSize()
  const headerH = 52
  const footerH = 40

  page.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: DARK })
  page.drawRectangle({ x: 0, y: H - headerH - 4, width: W, height: 4, color: GREEN })
  page.drawText("Departments in This Report", { x: 22, y: H - 32, size: 9, font: bold, color: WHITE })
  const weekLabel = title.match(/Week\s+\d+,\s*\d+/i)?.[0] ?? ""
  if (weekLabel) {
    const weekW = regular.widthOfTextAtSize(weekLabel, 8)
    page.drawText(weekLabel, { x: W - 22 - weekW, y: H - 32, size: 8, font: regular, color: WHITE })
  }
  await drawLogoInHeader(doc, page, headerLogoBytes, headerH, H, W)

  let y = H - 136
  for (let i = 0; i < entries.length; i++) {
    if (y < footerH + 26) break
    const pageNumber = i + 3
    const label = sanitizeForPdf(entries[i], regular)
    const safe = label.length > 64 ? `${label.slice(0, 61)}...` : label
    page.drawCircle({ x: 20, y: y + 2, size: 7, color: GREEN, borderColor: GREEN, borderWidth: 1 })
    const badge = `${i + 1}`
    const badgeW = bold.widthOfTextAtSize(badge, 8)
    page.drawText(badge, { x: 20 - badgeW / 2, y: y - 1, size: 8, font: bold, color: WHITE })
    page.drawText(safe, { x: 32, y, size: 10, font: regular, color: SLATE })
    page.drawText(String(pageNumber), { x: W - 44, y, size: 10, font: bold, color: GREEN })
    page.drawRectangle({ x: 28, y: y - 6, width: W - 56, height: 0.5, color: rgb(0.886, 0.906, 0.941) })
    y -= 24
  }

  page.drawRectangle({ x: 0, y: 0, width: W, height: footerH, color: GREEN })
  page.drawText("Confidential \u2014 ACOB Internal Use Only", { x: 20, y: 14, size: 8, font: regular, color: WHITE })
}

// ─── Weekly report content page ──────────────────────────────────────────────

async function addWeeklyReportContentPage(
  doc: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
  department: string,
  report: WeeklyReportRow,
  headerLogoBytes: Uint8Array | null,
  pageNumber: number
) {
  const page = doc.addPage([595, 842])
  const { width: W, height: H } = page.getSize()
  const footerH = 40
  const headerH = 52

  page.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: DARK })
  page.drawRectangle({ x: 0, y: H - headerH - 4, width: W, height: 4, color: GREEN })
  page.drawText(sanitizeForPdf(department.toUpperCase(), bold), { x: 22, y: H - 32, size: 9, font: bold, color: WHITE })
  await drawLogoInHeader(doc, page, headerLogoBytes, headerH, H, W)

  const bodyTop = H - headerH - 8
  const bodyH = bodyTop - footerH
  const rowH = bodyH / 3
  const padX = 20
  const innerW = W - padX * 2
  const labelH = 22

  const sections = [
    {
      label: "WORK DONE",
      color: GREEN,
      text: sanitizeForPdf(autoNumber(report.work_done || "No data provided."), regular),
    },
    {
      label: "TASKS FOR NEW WEEK",
      color: BLUE,
      text: sanitizeForPdf(autoNumber(report.tasks_new_week || "No data provided."), regular),
    },
    {
      label: "CHALLENGES",
      color: RED,
      text: sanitizeForPdf(autoNumber(report.challenges || "No challenges reported."), regular),
    },
  ]

  const drawFittedSectionLines = (linesInput: string[], startX: number, startY: number, bottomLimit: number) => {
    const buildLinesWithIndent = (
      lines: string[],
      firstChars: number,
      continuationChars: number,
      continuationIndentPx: number
    ): Array<{ text: string; indent: number }> => {
      const out: Array<{ text: string; indent: number }> = []
      lines.forEach((raw) => {
        const line = (raw || "").trim()
        if (!line) {
          out.push({ text: "", indent: 0 })
          return
        }
        const numbered = line.match(/^(\d+\.)\s+(.*)$/)
        if (!numbered) {
          wrapText(line, firstChars).forEach((w) => out.push({ text: w, indent: 0 }))
          return
        }
        const prefix = `${numbered[1]} `
        const body = numbered[2] || ""
        const firstBodyLines = wrapText(body, Math.max(10, firstChars - prefix.length))
        if (!firstBodyLines.length) {
          out.push({ text: prefix.trimEnd(), indent: 0 })
          return
        }
        out.push({ text: `${prefix}${firstBodyLines[0]}`, indent: 0 })
        const remainder = firstBodyLines.slice(1).join(" ")
        if (remainder) {
          wrapText(remainder, continuationChars).forEach((w) => out.push({ text: w, indent: continuationIndentPx }))
        }
      })
      return out
    }

    const tryConfigs = [
      { chars: 92, size: 8, lineH: 12 },
      { chars: 100, size: 7.5, lineH: 11 },
      { chars: 110, size: 7, lineH: 10 },
      { chars: 120, size: 6.5, lineH: 9 },
      { chars: 130, size: 6, lineH: 8.5 },
    ]

    for (const cfg of tryConfigs) {
      const wrapped = buildLinesWithIndent(linesInput, cfg.chars, Math.max(10, cfg.chars - 6), 8)
      const availableHeight = startY - bottomLimit
      const maxLines = Math.max(1, Math.floor(availableHeight / cfg.lineH))
      if (wrapped.length <= maxLines) {
        let ty = startY
        for (const line of wrapped) {
          page.drawText(line.text, { x: startX + line.indent, y: ty, size: cfg.size, font: regular, color: SLATE })
          ty -= cfg.lineH
        }
        return
      }
    }

    // Last-resort: clip with "... continued" hint
    let ty = startY
    const wrapped = buildLinesWithIndent(linesInput, 130, 124, 8)
    const maxLines = Math.max(1, Math.floor((startY - bottomLimit) / 8.5) - 1)
    for (const line of wrapped.slice(0, maxLines)) {
      page.drawText(line.text, { x: startX + line.indent, y: ty, size: 6, font: regular, color: SLATE })
      ty -= 8.5
    }
    page.drawText("... continued", { x: startX, y: Math.max(bottomLimit + 1, ty), size: 6, font: bold, color: RED })
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const sectionTop = bodyTop - i * rowH
    page.drawRectangle({ x: padX, y: sectionTop - labelH, width: innerW, height: labelH, color: s.color })
    page.drawText(s.label, { x: padX + 6, y: sectionTop - labelH + 7, size: 8, font: bold, color: WHITE })

    const textStartY = sectionTop - labelH - 14
    const bottomLimit = sectionTop - rowH + 6
    drawFittedSectionLines(s.text.split("\n"), padX + 6, textStartY, bottomLimit)

    if (i < 2) {
      page.drawRectangle({ x: padX, y: sectionTop - rowH, width: innerW, height: 0.5, color: rgb(0.8, 0.85, 0.9) })
    }
  }

  page.drawRectangle({ x: 0, y: 0, width: W, height: footerH, color: GREEN })
  page.drawText("Confidential \u2014 ACOB Internal Use Only", { x: 20, y: 14, size: 8, font: regular, color: WHITE })
  const pn = String(pageNumber)
  const pnW = bold.widthOfTextAtSize(pn, 9)
  page.drawText(pn, { x: W / 2 - pnW / 2, y: 14, size: 9, font: bold, color: WHITE })
}

// ─── Action point page ─────────────────────────────────────────────────────

// ─── Public builders ─────────────────────────────────────────────────────────

export async function buildWeeklyReportPDF(
  reports: WeeklyReportRow[],
  meetingWeek: number,
  meetingYear: number,
  meetingDateLabel: string,
  coverLogoBytes: Uint8Array | null,
  headerLogoBytes: Uint8Array | null
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)

  const sorted = [...reports].sort((a, b) => compareDepartments(a.department, b.department))

  await addCoverPage(
    doc,
    bold,
    regular,
    meetingWeek,
    meetingYear,
    meetingDateLabel,
    "",
    "Weekly Report",
    coverLogoBytes
  )
  await addTOCPage(
    doc,
    bold,
    regular,
    `Weekly Report — Week ${meetingWeek}, ${meetingYear}`,
    sorted.map((r) => r.department),
    headerLogoBytes
  )
  for (let i = 0; i < sorted.length; i++) {
    await addWeeklyReportContentPage(doc, bold, regular, sorted[i].department, sorted[i], headerLogoBytes, i + 3)
  }

  return doc.save()
}
