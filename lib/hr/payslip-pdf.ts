/**
 * Payslip PDF generation — Node.js, jsPDF.
 *
 * Mirrors the on-screen / print payslip in lib/hr/payslip-print.ts, from the
 * same PayslipPrintData model, so the emailed document and the printed one
 * cannot drift.
 *
 * jsPDF rather than pdf-lib (which the weekly report uses) for one reason:
 * pdf-lib cannot encrypt, so password protection would otherwise need the
 * external qpdf document service and its two env vars. jsPDF implements the
 * standard security handler in-process, so a protected payslip needs no infra.
 *
 * One limit worth knowing: jsPDF's security handler is RC4 40-bit (algorithm
 * V=1). It deters casual opening; it is not real confidentiality. Fine here —
 * the password is the staff ID, which is printed on the payslip itself and
 * listed in the staff directory.
 *
 * Amounts carry a real ₦ (U+20A6). The PDF standard fonts are WinAnsi/cp1252
 * and have no naira glyph, so Inter (SIL OFL, public/fonts/inter) is embedded
 * instead. jsPDF subsets it — both weights are 670KB on disk but add ~30KB to
 * the finished file.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { jsPDF } from "jspdf"
import {
  formatPayslipAmount,
  PAYSLIP_COMPANY_ADDRESS,
  PAYSLIP_CONTACT_LINE,
  type PayslipLine,
  type PayslipPrintData,
} from "./payslip-types"

type RGB = [number, number, number]

const GREEN: RGB = [4, 120, 87]
const GREEN_DARK: RGB = [5, 150, 105]
const RED: RGB = [220, 38, 38]
const INK: RGB = [31, 41, 55]
const SLATE: RGB = [75, 85, 99]
const MUTED: RGB = [156, 163, 175]
const HAIRLINE: RGB = [229, 231, 235]
const PANEL: RGB = [249, 250, 251]
const WHITE: RGB = [255, 255, 255]
const AMBER: RGB = [217, 119, 6]

const PAGE_W = 595.28 // A4 portrait, points
const MARGIN = 42

export interface PayslipPdfOptions {
  /**
   * When set, the PDF is encrypted and this string is the open password.
   * Omit for an unprotected document.
   */
  password?: string | null
}

const NAIRA = "₦"

/** Amount as it appears on the PDF, e.g. "₦154,559.12". */
function money(value: number): string {
  return `${NAIRA}${formatPayslipAmount(value)}`
}

/**
 * Normalises typographic characters and strips anything the embedded font is
 * not guaranteed to carry, so a stray glyph can never render as mojibake on a
 * salary document. The naira sign is explicitly kept.
 */
function safe(text: unknown): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(new RegExp(`[^\\x20-\\x7E\\xA0-\\xFF${NAIRA}]`, "g"), "")
}

/**
 * Inter, embedded because no PDF standard font has the naira glyph.
 * Read once per process — the files are ~340KB each.
 */
let fontCache: { regular: string; bold: string } | null = null

async function loadFonts(): Promise<{ regular: string; bold: string } | null> {
  if (fontCache) return fontCache
  try {
    const dir = join(process.cwd(), "public", "fonts", "inter")
    const [regular, bold] = await Promise.all([
      readFile(join(dir, "Inter-Regular.ttf")),
      readFile(join(dir, "Inter-Bold.ttf")),
    ])
    fontCache = { regular: regular.toString("base64"), bold: bold.toString("base64") }
    return fontCache
  } catch {
    return null
  }
}

async function loadLogoDataUri(): Promise<string | null> {
  try {
    const bytes = await readFile(join(process.cwd(), "public", "images", "exports", "acob-lighting-full.png"))
    return `data:image/png;base64,${bytes.toString("base64")}`
  } catch {
    // A missing logo must never block payroll — the rest of the slip still renders.
    return null
  }
}

export async function generatePayslipPdf(data: PayslipPrintData, options: PayslipPdfOptions = {}): Promise<Uint8Array> {
  const password = options.password?.trim()

  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
    orientation: "portrait",
    // jsPDF stores the decoded logo bitmap; without stream compression the file
    // is ~5x larger, which matters when one send is 49 attachments.
    compress: true,
    ...(password
      ? {
          encryption: {
            userPassword: password,
            // Random owner password: nobody needs to change permissions, and a
            // predictable one would let any holder of the staff ID strip them.
            ownerPassword: `owner-${Math.random().toString(36).slice(2)}${Date.now()}`,
            userPermissions: ["print", "copy"] as const,
          },
        }
      : {}),
  })

  doc.setProperties({
    title: `Payslip - ${safe(data.fullName)} - ${safe(data.periodName)}`,
    author: "ACOB Lighting Technology Limited",
    subject: `Payslip for ${safe(data.periodName)}`,
    creator: "ACOB Matrix",
  })

  // Inter carries the naira sign; Helvetica does not. If the font files are
  // somehow unreadable the slip still renders, with amounts marked "NGN".
  const fonts = await loadFonts()
  let family = "helvetica"
  if (fonts) {
    doc.addFileToVFS("Inter-Regular.ttf", fonts.regular)
    doc.addFont("Inter-Regular.ttf", "Inter", "normal")
    doc.addFileToVFS("Inter-Bold.ttf", fonts.bold)
    doc.addFont("Inter-Bold.ttf", "Inter", "bold")
    family = "Inter"
  }
  const currency = (value: string) => (fonts ? value : value.replace(NAIRA, "NGN "))

  const contentRight = PAGE_W - MARGIN
  const contentWidth = contentRight - MARGIN

  // ── local drawing helpers (jsPDF y grows downward from the top edge) ──────
  const prepare = (size: number, bold: boolean, color?: RGB) => {
    doc.setFont(family, bold ? "bold" : "normal")
    doc.setFontSize(size)
    if (color) doc.setTextColor(color[0], color[1], color[2])
  }
  const text = (value: string, x: number, y: number, size: number, bold: boolean, color: RGB) => {
    prepare(size, bold, color)
    doc.text(currency(safe(value)), x, y)
  }
  const textRight = (value: string, right: number, y: number, size: number, bold: boolean, color: RGB) => {
    prepare(size, bold, color)
    doc.text(currency(safe(value)), right, y, { align: "right" })
  }
  const rule = (x1: number, y: number, x2: number, color: RGB, width = 0.6) => {
    doc.setDrawColor(color[0], color[1], color[2])
    doc.setLineWidth(width)
    doc.line(x1, y, x2, y)
  }
  const widthOf = (value: string, size: number, bold: boolean) => {
    prepare(size, bold)
    return doc.getTextWidth(currency(safe(value)))
  }

  let y = MARGIN

  // ── Header ───────────────────────────────────────────────────────────────
  const logo = await loadLogoDataUri()
  let logoBottom = y
  if (logo) {
    const props = doc.getImageProperties(logo)
    const logoW = 168
    const logoH = (props.height / props.width) * logoW
    doc.addImage(logo, "PNG", MARGIN, y, logoW, logoH)
    logoBottom = y + logoH + 14
  } else {
    text("ACOB LIGHTING TECHNOLOGY LIMITED", MARGIN, y + 12, 12, true, GREEN)
    logoBottom = y + 26
  }

  // Right-hand meta block, aligned to the top margin beside the logo.
  let metaY = y + 12
  textRight("PAYSLIP", contentRight, metaY, 13, true, GREEN)
  metaY += 14
  textRight(`Period: ${data.periodName}`, contentRight, metaY, 8.5, false, SLATE)
  metaY += 11
  textRight(`Pay Date: ${data.payDate}`, contentRight, metaY, 8.5, false, SLATE)
  metaY += 12
  textRight(data.statusLabel.toUpperCase(), contentRight, metaY, 8.5, true, data.statusPaid ? GREEN_DARK : AMBER)

  // Address block wraps within the left ~62% so it can never run under the meta.
  y = logoBottom
  prepare(7.5, false)
  for (const line of doc.splitTextToSize(safe(PAYSLIP_COMPANY_ADDRESS), contentWidth * 0.62) as string[]) {
    text(line, MARGIN, y, 7.5, false, MUTED)
    y += 10
  }
  text(PAYSLIP_CONTACT_LINE, MARGIN, y, 7.5, false, MUTED)
  y += 10

  y = Math.max(y, metaY) + 12
  rule(MARGIN, y, contentRight, HAIRLINE, 0.8)
  y += 24

  // ── Employee details panel ───────────────────────────────────────────────
  const panelH = 62
  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2])
  doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2])
  doc.setLineWidth(0.8)
  doc.rect(MARGIN, y, contentWidth, panelH, "FD")

  const cellPad = 14
  const colTwoX = MARGIN + contentWidth / 2
  const details: Array<[string, string, number, number]> = [
    ["EMPLOYEE NAME", data.fullName, MARGIN + cellPad, y + 20],
    ["STAFF ID", data.employeeNumber, colTwoX, y + 20],
    ["DEPARTMENT", data.department || "-", MARGIN + cellPad, y + 46],
    ["DESIGNATION", data.designation || "-", colTwoX, y + 46],
  ]
  for (const [label, value, x, ly] of details) {
    text(label, x, ly, 6.5, true, MUTED)
    text(value, x, ly + 11, 9.5, true, INK)
  }
  y += panelH + 28

  // ── Earnings / deductions ────────────────────────────────────────────────
  const gutter = 26
  const colWidth = (contentWidth - gutter) / 2

  const drawColumn = (opts: {
    x: number
    title: string
    accent: RGB
    lines: PayslipLine[]
    totalLabel: string
    total: number
    amountColor: RGB
  }): number => {
    const { x, title, accent, lines, totalLabel, total, amountColor } = opts
    const right = x + colWidth
    let cy = y

    text(title.toUpperCase(), x, cy, 8, true, accent)
    cy += 5
    rule(x, cy, right, accent, 0.8)
    cy += 14

    for (const line of lines) {
      text(line.label, x, cy, 9, false, SLATE)
      textRight(money(line.amount), right, cy, 9, true, amountColor)
      cy += 6
      rule(x, cy, right, HAIRLINE, 0.5)
      cy += 12
    }

    cy -= 4
    rule(x, cy, right, HAIRLINE, 0.8)
    cy += 14
    text(totalLabel, x, cy, 9.5, true, INK)
    textRight(money(total), right, cy, 9.5, true, amountColor)

    return cy + 14
  }

  const earningsBottom = drawColumn({
    x: MARGIN,
    title: "Earnings",
    accent: GREEN,
    lines: data.earnings,
    totalLabel: data.grossLabel,
    total: data.gross,
    amountColor: INK,
  })

  const deductionsBottom = drawColumn({
    x: MARGIN + colWidth + gutter,
    title: "Deductions",
    accent: RED,
    lines: data.deductions,
    totalLabel: "Total Deductions",
    total: data.totalDeductions,
    amountColor: RED,
  })

  y = Math.max(earningsBottom, deductionsBottom) + 18

  // ── Net pay banner ───────────────────────────────────────────────────────
  const bannerH = 44
  doc.setFillColor(GREEN_DARK[0], GREEN_DARK[1], GREEN_DARK[2])
  doc.rect(MARGIN, y, contentWidth, bannerH, "F")
  text("NET PAY (TAKE HOME)", MARGIN + 18, y + 27, 10, true, WHITE)
  textRight(money(data.netPay), contentRight - 18, y + 29, 15, true, WHITE)
  y += bannerH + 56

  // ── Signatures ───────────────────────────────────────────────────────────
  const sigWidth = 132
  for (const [label, x] of [
    ["Employee Signature", MARGIN],
    ["Authorised Signatory", contentRight - sigWidth],
  ] as Array<[string, number]>) {
    rule(x, y, x + sigWidth, HAIRLINE, 0.8)
    text(label, x + (sigWidth - widthOf(label, 8, false)) / 2, y + 12, 8, false, SLATE)
  }

  const note = "This payslip is computer-generated and valid without a signature."
  text(note, MARGIN + (contentWidth - widthOf(note, 7.5, false)) / 2, y + 12, 7.5, false, MUTED)

  // ── Footer ───────────────────────────────────────────────────────────────
  const footer = "Confidential - issued to the named employee only."
  text(footer, (PAGE_W - widthOf(footer, 7.5, false)) / 2, 812, 7.5, false, MUTED)

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer)
}

/** Filename used for the attachment, e.g. "Payslip_ACOB-2025-038_July_2026.pdf". */
export function payslipFileName(data: PayslipPrintData): string {
  const id = (data.employeeNumber || "employee").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const period = (data.periodName || "period").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")
  return `Payslip_${id}_${period}.pdf`
}
