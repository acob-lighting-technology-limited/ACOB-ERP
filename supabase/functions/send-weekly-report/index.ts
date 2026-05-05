import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1"
import { writeEdgeAuditLog } from "../_shared/audit.ts"
import { sendEmail } from "../_shared/email.ts"
import { compareDepartments, normalizeDepartmentName } from "../../../shared/departments.ts"
import {
  buildMeetingDocumentFileName,
  formatMeetingDateLabel,
  getAnchorDay,
  getCurrentOfficeWeek,
  initOfficeYearAnchors,
  resolveEffectiveMeetingDateIso,
} from "../_shared/meeting-date.ts"
import { isEdgeSystemEmailEnabled } from "../_shared/notification-gateway.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const GREEN = rgb(0.102, 0.478, 0.29)
const DARK = rgb(0.059, 0.176, 0.122)
const WHITE = rgb(1, 1, 1)
const SLATE = rgb(0.2, 0.255, 0.333)
const MUTED = rgb(0.392, 0.455, 0.545)
const BLUE = rgb(0.114, 0.416, 0.588)
const RED = rgb(0.725, 0.11, 0.11)
const DEFAULT_SENDER_EMAIL = Deno.env.get("NOTIFICATION_SENDER_EMAIL") || "notifications@acoblighting.com"
const DEFAULT_SENDER = `ACOB Internal Systems <${DEFAULT_SENDER_EMAIL}>`
const MEETING_DOCS_BUCKET = "meeting_documents"
// Anchor day is read from _shared/meeting-date.ts (populated by initOfficeYearAnchors).

type AttachmentPayload = {
  filename: string
  content: string
}

type WeeklyReportRow = {
  id: string
  department: string
  week_number: number
  year: number
  work_done: string | null
  tasks_new_week: string | null
  challenges: string | null
  status: string | null
}

type MeetingDocumentRow = {
  id: string
  meeting_week: number
  meeting_year: number
  document_type: string
  department: string | null
  presenter_id: string | null
  file_path: string | null
  file_name: string | null
  mime_type: string | null
}

function getOfficeYearStart(year: number): Date {
  return new Date(year, 0, getAnchorDay(year))
}

function getWeeksInOfficeYear(year: number): number {
  const start = getOfficeYearStart(year)
  const nextStart = getOfficeYearStart(year + 1)
  const diffMs = nextStart.getTime() - start.getTime()
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000))
}

function getNextOfficeWeek(week: number, year: number): { week: number; year: number } {
  const weeksInYear = getWeeksInOfficeYear(year)
  if (week < weeksInYear) {
    return { week: week + 1, year }
  }

  return { week: 1, year: year + 1 }
}

type WeeklyReportRequestBody = {
  testEmail?: string
  recipients?: string[]
  weeklyReportBase64?: string
  actionPointBase64?: string
  meetingWeek?: number
  meetingYear?: number
  forceWeek?: number
  forceYear?: number
  week?: number
  year?: number
  contentChoice?: "weekly_report" | "action_point" | "both"
  skipWeeklyReport?: boolean
  skipActionPoint?: boolean
  weeklyReportFilename?: string
  actionPointFilename?: string
  weeklyReportDocumentId?: string
  actionPointDocumentId?: string
  additionalDocumentIds?: unknown[]
  /** Pre-fetched additional attachments (KSS, Minutes, etc.) — bypasses server-side download */
  additionalDocumentAttachments?: Array<{ base64: string; filename: string }>
  actionPointAttachments?: Array<{ base64: string; filename: string; week: number }>
  meetingWeeks?: number[]
  preparedByName?: string
  preparedByDesignation?: string
  preparedByDepartment?: string
  requestedByUserId?: string
}

type DeliveryResult = {
  to: string
  success: boolean
  emailId?: string | null
  error?: unknown
}

type ProfileRecipientRow = {
  id: string
  company_email: string | null
  additional_email: string | null
}

const DELIVERY_BATCH_SIZE = 2

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Unknown error"
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(2)}s`
}

function estimateBase64Bytes(base64: string): number {
  const sanitized = String(base64 || "").replace(/=+$/, "")
  return Math.floor((sanitized.length * 3) / 4)
}

function logWeeklyReportEvent(startedAt: number, stage: string, details: Record<string, unknown> = {}) {
  console.log(
    `[weekly-report] ${stage}`,
    JSON.stringify({
      elapsed_ms: Date.now() - startedAt,
      ...details,
    })
  )
}

async function processRecipientBatch<TInput, TResult>(
  items: TInput[],
  batchSize: number,
  worker: (item: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    const batchResults = await Promise.all(batch.map((item, batchIndex) => worker(item, index + batchIndex)))
    results.push(...batchResults)
  }

  return results
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
}

async function createInAppWeeklyReportNotifications(params: {
  supabase: ReturnType<typeof createClient>
  recipients: string[]
  successfulResults: DeliveryResult[]
  subject: string
  meetingWeek: number
  meetingYear: number
  requestedByUserId?: string
  preparedByName?: string
}) {
  const {
    supabase,
    recipients,
    successfulResults,
    subject,
    meetingWeek,
    meetingYear,
    requestedByUserId,
    preparedByName,
  } = params
  if (successfulResults.length === 0 || recipients.length === 0) return

  const normalizedRecipients = Array.from(new Set(recipients.map((email) => normalizeEmail(email)).filter(Boolean)))
  if (normalizedRecipients.length === 0) return

  const successfulEmailSet = new Set(successfulResults.map((result) => normalizeEmail(result.to)).filter(Boolean))
  if (successfulEmailSet.size === 0) return

  const [companyMatchResult, additionalMatchResult] = await Promise.all([
    supabase.from("profiles").select("id, company_email, additional_email").in("company_email", normalizedRecipients),
    supabase
      .from("profiles")
      .select("id, company_email, additional_email")
      .in("additional_email", normalizedRecipients),
  ])

  if (companyMatchResult.error) {
    throw new Error(`Failed to resolve company_email recipients: ${companyMatchResult.error.message}`)
  }
  if (additionalMatchResult.error) {
    throw new Error(`Failed to resolve additional_email recipients: ${additionalMatchResult.error.message}`)
  }

  const rows = [
    ...((companyMatchResult.data || []) as ProfileRecipientRow[]),
    ...((additionalMatchResult.data || []) as ProfileRecipientRow[]),
  ]

  const userIds = new Set<string>()
  for (const row of rows) {
    const companyEmail = normalizeEmail(row.company_email)
    const additionalEmail = normalizeEmail(row.additional_email)
    if (successfulEmailSet.has(companyEmail) || successfulEmailSet.has(additionalEmail)) {
      userIds.add(row.id)
    }
  }

  if (userIds.size === 0) return

  const notificationRows = Array.from(userIds).map((userId) => ({
    user_id: userId,
    type: "system",
    category: "reports",
    priority: "normal",
    title: "General Meeting Documents Shared",
    message: subject,
    action_url: "/notifications",
    actor_id: requestedByUserId || null,
    data: {
      module: "weekly_report",
      event: "weekly_report_mail",
      meeting_week: meetingWeek,
      meeting_year: meetingYear,
      prepared_by: preparedByName || null,
      recipient_email_count: successfulEmailSet.size,
      sent_at: new Date().toISOString(),
    },
  }))

  const { error: insertError } = await supabase.from("notifications").insert(notificationRows)
  if (insertError) {
    throw new Error(`Failed to create in-app notifications: ${insertError.message}`)
  }
}

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
      // Drop unsupported characters (e.g. U+2060 WORD JOINER).
    }
  }
  return out
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let binary = ""

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }

  return btoa(binary)
}

function withSubjectPrefix(moduleName: string, subject: string): string {
  return String(subject || "").trim() || "Notification"
}

const STORAGE_BASE = "https://itqegqxeqkeogwrvlzlj.supabase.co/storage/v1/object/public/assets/logos"

async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function resolveStoredMeetingDocument(
  supabase: ReturnType<typeof createClient>,
  documentId: string
): Promise<{ base64: string; filename: string } | null> {
  const attachments = await resolveStoredMeetingDocuments(supabase, [documentId])
  return attachments.get(documentId) || null
}

async function resolveStoredMeetingDocuments(
  supabase: ReturnType<typeof createClient>,
  documentIds: string[]
): Promise<Map<string, { base64: string; filename: string }>> {
  const uniqueDocumentIds = Array.from(new Set(documentIds.filter(Boolean)))
  const attachments = new Map<string, { base64: string; filename: string }>()

  if (uniqueDocumentIds.length === 0) return attachments

  // Note: no .eq("is_current", true) filter here — we look up by specific ID so
  // is_current is irrelevant. Filtering by it caused non-current KSS docs to silently fail.
  const { data: docs, error } = await supabase
    .from("meeting_week_documents")
    .select("id, meeting_week, meeting_year, document_type, department, presenter_id, file_path, file_name, mime_type")
    .in("id", uniqueDocumentIds)

  if (error || !docs?.length) return attachments

  const docRows = (docs || []).filter((doc): doc is MeetingDocumentRow => Boolean(doc?.id && doc?.file_path))
  const presenterIds = Array.from(
    new Set(
      docRows
        .filter((doc) => doc.document_type === "knowledge_sharing_session" && doc.presenter_id)
        .map((doc) => doc.presenter_id as string)
    )
  )
  const presenterMap = new Map<string, string>()

  if (presenterIds.length > 0) {
    const { data: presenters } = await supabase.from("profiles").select("id, full_name").in("id", presenterIds)

    for (const presenter of presenters || []) {
      if (presenter?.id && presenter?.full_name) {
        presenterMap.set(presenter.id, presenter.full_name)
      }
    }
  }

  for (const doc of docRows) {
    const presenterName =
      doc.document_type === "knowledge_sharing_session" && doc.presenter_id
        ? presenterMap.get(doc.presenter_id) || null
        : null

    const meetingDate = await resolveEffectiveMeetingDateIso(supabase, doc.meeting_week, doc.meeting_year)

    const { data: blob, error: downloadError } = await supabase.storage
      .from(MEETING_DOCS_BUCKET)
      .download(doc.file_path)
    if (downloadError || !blob) continue

    const bytes = new Uint8Array(await blob.arrayBuffer())
    attachments.set(doc.id, {
      base64: encodeBytesToBase64(bytes),
      filename: buildAttachmentFilename(doc, meetingDate, presenterName),
    })
  }

  return attachments
}

function extensionFromDocument(fileName: string | null | undefined, mimeType: string | null | undefined): string {
  const lower = String(fileName || "").toLowerCase()
  if (lower.endsWith(".pdf")) return "pdf"
  if (lower.endsWith(".docx")) return "docx"
  if (lower.endsWith(".pptx")) return "pptx"
  if (mimeType === "application/pdf") return "pdf"
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx"
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx"
  return "pdf"
}

function buildAttachmentFilename(
  doc: {
    meeting_week?: number
    meeting_year?: number
    document_type?: string
    department?: string | null
    file_name?: string | null
    mime_type?: string | null
  },
  meetingDate: string,
  presenterName?: string | null
): string {
  const extension = extensionFromDocument(doc.file_name, doc.mime_type)
  const week = Number(doc.meeting_week || 0)

  if (
    doc.document_type === "knowledge_sharing_session" ||
    doc.document_type === "minutes" ||
    doc.document_type === "action_points"
  ) {
    return buildMeetingDocumentFileName({
      documentType: doc.document_type,
      meetingDate,
      meetingWeek: week,
      extension,
      department: doc.department,
      presenterName,
    })
  }

  return doc.file_name || "meeting-document.pdf"
}

function buildWeeklyReportAttachmentName(meetingDateLabel: string, meetingWeek: number): string {
  return `ACOB Weekly Reports - ${meetingDateLabel} - W${meetingWeek}.pdf`
}

function buildActionPointAttachmentName(meetingDateLabel: string, meetingWeek: number): string {
  return `ACOB Action Points - ${meetingDateLabel} - W${meetingWeek}.pdf`
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

// ─── Cover page ───────────────────────────────────────────────────────────────
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

  // Dark header bar
  page.drawRectangle({ x: 0, y: H - 60, width: W, height: 60, color: DARK })
  page.drawRectangle({ x: 0, y: H - 66, width: W, height: 6, color: GREEN })

  // Large centred LIGHT logo in body area
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

  // Green divider below logo
  page.drawRectangle({ x: 80, y: H / 2 + 60, width: W - 160, height: 2, color: GREEN })

  // Centre content
  const gmText = "General Meeting"
  const gmWidth = bold.widthOfTextAtSize(gmText, 28)
  page.drawText(gmText, { x: W / 2 - gmWidth / 2, y: H / 2 + 24, size: 28, font: bold, color: DARK })

  const wrText = secondaryTitle
  const wrWidth = regular.widthOfTextAtSize(wrText, 20)
  page.drawText(wrText, { x: W / 2 - wrWidth / 2, y: H / 2 + 2, size: 20, font: regular, color: GREEN })

  // Week pill
  const pillLabel = `Week ${week}`
  const pillLabelW = bold.widthOfTextAtSize(pillLabel, 12)
  const pillW = pillLabelW + 36,
    pillH = 24
  const pillX = W / 2 - pillW / 2,
    pillY = H / 2 - 36
  page.drawRectangle({ x: pillX, y: pillY, width: pillW, height: pillH, color: GREEN })
  page.drawText(pillLabel, { x: pillX + 18, y: pillY + 7, size: 12, font: bold, color: WHITE })

  // Monday date — properly centred
  const dateWidth = regular.widthOfTextAtSize(meetingDateLabel, 10)
  page.drawText(meetingDateLabel, { x: W / 2 - dateWidth / 2, y: pillY - 22, size: 10, font: regular, color: MUTED })

  if (subtitle) {
    const stWidth = regular.widthOfTextAtSize(subtitle, 10)
    page.drawText(subtitle, { x: W / 2 - stWidth / 2, y: pillY - 42, size: 10, font: regular, color: GREEN })
  }

  // Footer
  page.drawRectangle({ x: 0, y: 0, width: W, height: 40, color: GREEN })
  page.drawText("Confidential \u2014 ACOB Internal Use Only", {
    x: W / 2 - 110,
    y: 14,
    size: 8,
    font: regular,
    color: WHITE,
  })
}

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
    const pageNumber = i + 3 // cover + toc before content pages
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
  page.drawText("Confidential — ACOB Internal Use Only", { x: 20, y: 14, size: 8, font: regular, color: WHITE })
}

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

    // Last fallback: clipped + continuation hint.
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

async function buildWeeklyReportPDF(
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

  const sorted = [...reports]
    .map((report) => ({ ...report, department: normalizeDepartmentName(report.department) }))
    .sort((a, b) => compareDepartments(a.department, b.department))

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

type EmailContentContext = {
  includeWeeklyReport: boolean
  includeActionPoint: boolean
  includeKss: boolean
  includeMinutes: boolean
  weekLabels: string[] // e.g. ["Week 3", "Week 4"]
}

// Formats ["Week 7"] → "Week 7"
// ["Week 7", "Week 8"] → "Week 7 and Week 8"
// ["Week 7", "Week 8", "Week 9"] → "Week 7, Week 8, and Week 9"
function oxfordWeekList(weekLabels: string[]): string {
  if (weekLabels.length === 0) return ""
  if (weekLabels.length === 1) return weekLabels[0]
  if (weekLabels.length === 2) return `${weekLabels[0]} and ${weekLabels[1]}`
  const last = weekLabels[weekLabels.length - 1]
  return weekLabels.slice(0, -1).join(", ") + ", and " + last
}

function buildEmailSubject(ctx: EmailContentContext): string {
  const parts: string[] = []
  if (ctx.includeMinutes) parts.push("Minutes of Meeting")
  if (ctx.includeActionPoint) parts.push("Action Points")
  if (ctx.includeWeeklyReport) parts.push(ctx.weekLabels.length > 1 ? "Weekly Reports" : "Weekly Report")
  if (ctx.includeKss) parts.push(ctx.weekLabels.length > 1 ? "Knowledge Sharing Sessions" : "Knowledge Sharing Session")

  const contentLabel = parts.length > 0 ? parts.join(" & ") : "General Meeting Documents"
  const weekLabel = oxfordWeekList(ctx.weekLabels)
  return withSubjectPrefix("Reports", `${contentLabel} — ${weekLabel}`)
}

function buildEmailTitle(ctx: EmailContentContext): string {
  const parts: string[] = []
  if (ctx.includeMinutes) parts.push("Minutes of Meeting")
  if (ctx.includeActionPoint) parts.push("Action Points")
  if (ctx.includeWeeklyReport) parts.push(ctx.weekLabels.length > 1 ? "Weekly Reports" : "Weekly Report")
  if (ctx.includeKss) parts.push(ctx.weekLabels.length > 1 ? "Knowledge Sharing Sessions" : "Knowledge Sharing Session")
  if (parts.length === 0) return "General Meeting Documents"
  if (parts.length === 1) return parts[0]
  const last = parts.pop()!
  return parts.join(", ") + " &amp; " + escapeHtml(last)
}

function buildEmailBody(meetingDate: string, nextMeetingDate: string, ctx: EmailContentContext): string {
  const isMultiWeek = ctx.weekLabels.length > 1
  const weekPhrase = `<strong>${escapeHtml(oxfordWeekList(ctx.weekLabels))}</strong>`

  const attachedParts: string[] = []
  if (ctx.includeMinutes) attachedParts.push(isMultiWeek ? "the Minutes of Meeting" : "the Minutes of Meeting")
  if (ctx.includeActionPoint) attachedParts.push("the Action Points")
  if (ctx.includeWeeklyReport) attachedParts.push(isMultiWeek ? "the Weekly Reports" : "the Weekly Report")
  if (ctx.includeKss) {
    attachedParts.push(
      isMultiWeek ? "the Knowledge Sharing Session documents" : "the Knowledge Sharing Session document"
    )
  }

  let attachedPhrase: string
  if (attachedParts.length === 0) {
    attachedPhrase = "the meeting documents"
  } else if (attachedParts.length === 1) {
    attachedPhrase = attachedParts[0]
  } else {
    const last = attachedParts.pop()!
    attachedPhrase = attachedParts.join(", ") + " and " + last
  }

  const lines: string[] = []

  if (isMultiWeek) {
    lines.push(`Please find attached ${attachedPhrase} for ${weekPhrase}.`)
  } else {
    if (ctx.includeMinutes || ctx.includeActionPoint) {
      lines.push(
        `Please find attached ${attachedPhrase} for ${weekPhrase} of the General Meeting held on <strong>${meetingDate}</strong>.`
      )
      lines.push(
        `Kindly review and share any observations or questions you may have ahead of the next General Meeting on <strong>${nextMeetingDate}</strong>.`
      )
    } else {
      lines.push(`Please find attached ${attachedPhrase} for ${weekPhrase}.`)
    }
  }

  lines.push("Thank you.")
  return lines.map((line) => `    <p class="text">${line}</p>`).join("\n")
}

function buildEmailHtml(
  meetingYear: number,
  meetingDate: string,
  nextMeetingDate: string,
  preparedByName: string,
  preparedByDesignation: string | null | undefined,
  preparedByDepartment: string | null | undefined,
  ctx: EmailContentContext
): string {
  const safePreparedBy = escapeHtml((preparedByName || "").trim() || "Terna")
  const safeDesignation = escapeHtml((preparedByDesignation || "").trim())
  const safeDepartment = escapeHtml((preparedByDepartment || "").trim() || "Admin & HR Department")
  const title = buildEmailTitle(ctx)
  const weekBadge =
    ctx.weekLabels.length <= 3
      ? ctx.weekLabels.map(escapeHtml).join(" &bull; ") + ` &bull; ${meetingYear}`
      : `${ctx.weekLabels.length} Weeks &bull; ${meetingYear}`
  const bodyHtml = buildEmailBody(meetingDate, nextMeetingDate, ctx)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
    .email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }
    .outer-header { background: #000; padding: 20px 0; text-align: center; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }
    .week-badge { display: inline-block; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; margin-bottom: 16px; }
    .title { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 14px; }
    .text { font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 18px 0; }
    .footer { background: #000; padding: 20px; text-align: center; font-size: 11px; color: #d1d5db; border-top: 3px solid #16a34a; border-bottom: 3px solid #16a34a; }
    .footer strong { color: #fff; }
    .footer-system { color: #16a34a; font-weight: 600; }
    .footer-note { color: #9ca3af; font-style: italic; }
  </style>
</head>
<body>
  <div class="email-shell">
  <div class="outer-header" style="background-color:#000;">
    <img src="https://erp.acoblighting.com/images/acob-logo-dark.png" height="65" alt="ACOB Lighting">
  </div>
  <div class="wrapper">
    <span class="week-badge">${weekBadge}</span>
    <div class="title">${title}</div>
    <p class="text">Dear All,</p>
${bodyHtml}
  </div>
  <div class="footer" style="background:#000 !important;background-color:#000 !important;background-image:linear-gradient(#000,#000) !important;color:#d1d5db;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;">
    <span style="color:#f3f4f6;">Prepared by ${safePreparedBy}</span><br>
    ${safeDesignation ? `${safeDesignation}<br>` : ""}${safeDepartment}<br>
    <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
    <span style="color:#16a34a;font-weight:600;">Reports Management System</span>
    <br><br>
    <i style="color:#9ca3af;">This is an automated system notification. Please do not reply directly to this email.</i>
  </div>
  </div>
</body>
</html>`
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const requestStartedAt = Date.now()
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return new Response("Unauthorized", { status: 401 })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    await initOfficeYearAnchors(supabase)
    const reportsMailEnabled = await isEdgeSystemEmailEnabled(supabase, "reports")
    if (!reportsMailEnabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "reports_email_disabled" }), {
        status: 200,
      })
    }

    let body: WeeklyReportRequestBody = {}
    try {
      body = await req.json()
    } catch {
      /* cron sends no body */
    }

    const {
      testEmail,
      recipients: bodyRecipients,
      weeklyReportBase64,
      actionPointBase64,
      actionPointAttachments: bodyActionPointAttachments,
      // NEW: meetingWeek is the week of the meeting (what shows on cover page)
      meetingWeek: bodyMeetingWeek,
      meetingYear: bodyMeetingYear,
      meetingWeeks: bodyMeetingWeeks,
      // LEGACY: forceWeek (kept for backwards compat with old callers)
      forceWeek,
      forceYear,
      week: bodyWeek,
      year: bodyYear,
      contentChoice,
      skipWeeklyReport: bodySkipWeeklyReport,
      skipActionPoint: bodySkipActionPoint,
      weeklyReportFilename,
      actionPointFilename,
      weeklyReportDocumentId,
      actionPointDocumentId,
      additionalDocumentIds,
      additionalDocumentAttachments: bodyAdditionalDocumentAttachments,
      preparedByName,
      preparedByDesignation,
      preparedByDepartment,
      requestedByUserId,
    } = body

    logWeeklyReportEvent(requestStartedAt, "request received", {
      requested_recipient_count: Array.isArray(bodyRecipients) ? bodyRecipients.length : testEmail ? 1 : 0,
      has_weekly_report_base64: Boolean(weeklyReportBase64),
      has_action_point_base64: Boolean(actionPointBase64),
      action_point_attachment_count: Array.isArray(bodyActionPointAttachments) ? bodyActionPointAttachments.length : 0,
      additional_document_id_count: Array.isArray(additionalDocumentIds) ? additionalDocumentIds.length : 0,
      additional_attachment_count: Array.isArray(bodyAdditionalDocumentAttachments)
        ? bodyAdditionalDocumentAttachments.length
        : 0,
      content_choice: contentChoice || "auto",
    })

    const { week: currentWeek, year: currentYear } = getCurrentOfficeWeek()

    // ── Determine meeting week (the week everything is labelled as) ──────
    let meetingWeek: number
    let meetingYear: number

    if (bodyMeetingWeek) {
      meetingWeek = bodyMeetingWeek
      meetingYear = bodyMeetingYear || currentYear
    } else if (forceWeek) {
      // Legacy: use the week as-is (no offset)
      meetingWeek = forceWeek
      meetingYear = forceYear || currentYear
    } else if (bodyWeek) {
      // Legacy: use the week as-is (no offset)
      meetingWeek = bodyWeek
      meetingYear = bodyYear || currentYear
    } else {
      // Auto: current week
      meetingWeek = currentWeek
      meetingYear = currentYear
    }

    const meetingDateIso = await resolveEffectiveMeetingDateIso(supabase, meetingWeek, meetingYear)
    const meetingDateLabel = formatMeetingDateLabel(meetingDateIso)
    const nextOfficeWeek = getNextOfficeWeek(meetingWeek, meetingYear)
    const nextMeetingDateIso = await resolveEffectiveMeetingDateIso(supabase, nextOfficeWeek.week, nextOfficeWeek.year)
    const nextMeetingDateLabel = formatMeetingDateLabel(nextMeetingDateIso)
    logWeeklyReportEvent(requestStartedAt, "meeting dates resolved", {
      meeting_week: meetingWeek,
      meeting_year: meetingYear,
      meeting_date: meetingDateIso,
      next_meeting_date: nextMeetingDateIso,
    })

    // ── Data weeks ──────────────────────────────────────────────────────
    // Everything uses the same meeting week — no previous-week offset
    const reportDataWeek = meetingWeek
    const reportDataYear = meetingYear
    const atWeek = meetingWeek
    const atYear = meetingYear

    console.log(
      `[weekly-report] Meeting: W${meetingWeek}/${meetingYear} | ReportData: W${reportDataWeek}/${reportDataYear} | Tracker: W${atWeek}/${atYear}`
    )

    let includeWeeklyReport = !bodySkipWeeklyReport
    let includeActionPoint = !bodySkipActionPoint

    if (contentChoice === "weekly_report") includeActionPoint = false
    if (contentChoice === "action_point") includeWeeklyReport = false

    // If caller provides a specific attachment, include it by default.
    if (weeklyReportBase64) includeWeeklyReport = true
    if (actionPointBase64) includeActionPoint = true

    const requestedAdditionalDocumentIds = Array.isArray(additionalDocumentIds)
      ? additionalDocumentIds.map((id: unknown) => String(id)).filter(Boolean)
      : []

    const hasPrefetchedAttachments =
      Array.isArray(bodyAdditionalDocumentAttachments) && bodyAdditionalDocumentAttachments.length > 0

    if (
      !includeWeeklyReport &&
      !includeActionPoint &&
      requestedAdditionalDocumentIds.length === 0 &&
      !hasPrefetchedAttachments
    ) {
      throw new Error("No attachments selected")
    }

    let reportPdfBase64: string | undefined
    let trackerPdfBase64: string | undefined

    if (weeklyReportBase64) {
      console.log("[weekly-report] Using client-provided weekly report PDF")
      reportPdfBase64 = weeklyReportBase64
    }

    if (actionPointBase64) {
      console.log("[weekly-report] Using client-provided action point PDF")
      trackerPdfBase64 = actionPointBase64
    }

    let resolvedWeeklyReportFilename = weeklyReportFilename
    let resolvedActionPointFilename = actionPointFilename

    if (!reportPdfBase64 && weeklyReportDocumentId) {
      const stored = await resolveStoredMeetingDocument(supabase, String(weeklyReportDocumentId))
      if (stored) {
        reportPdfBase64 = stored.base64
        resolvedWeeklyReportFilename = resolvedWeeklyReportFilename || stored.filename
        includeWeeklyReport = true
        console.log("[weekly-report] Using stored weekly report document", weeklyReportDocumentId)
        logWeeklyReportEvent(requestStartedAt, "stored weekly report resolved", {
          weekly_report_document_id: weeklyReportDocumentId,
          filename: resolvedWeeklyReportFilename,
          approx_bytes: estimateBase64Bytes(stored.base64),
        })
      }
    }

    if (!trackerPdfBase64 && actionPointDocumentId) {
      const stored = await resolveStoredMeetingDocument(supabase, String(actionPointDocumentId))
      if (stored) {
        trackerPdfBase64 = stored.base64
        resolvedActionPointFilename = resolvedActionPointFilename || stored.filename
        includeActionPoint = true
        console.log("[weekly-report] Using stored action point document", actionPointDocumentId)
        logWeeklyReportEvent(requestStartedAt, "stored action point resolved", {
          action_point_document_id: actionPointDocumentId,
          filename: resolvedActionPointFilename,
          approx_bytes: estimateBase64Bytes(stored.base64),
        })
      }
    }

    const additionalAttachments: AttachmentPayload[] = []

    // Use client-pre-fetched attachments when available (avoids CPU-heavy
    // server-side download + base64 conversion for large KSS/Minutes files).
    if (Array.isArray(bodyAdditionalDocumentAttachments) && bodyAdditionalDocumentAttachments.length > 0) {
      for (const att of bodyAdditionalDocumentAttachments) {
        if (att?.base64 && att?.filename) {
          additionalAttachments.push({ filename: att.filename, content: att.base64 })
        }
      }
      logWeeklyReportEvent(requestStartedAt, "using prefetched additional attachments", {
        additional_attachment_count: additionalAttachments.length,
        filenames: additionalAttachments.map((attachment) => attachment.filename),
      })
    } else if (requestedAdditionalDocumentIds.length > 0) {
      // Fallback: download server-side (legacy path, used if signed_url was unavailable)
      const uniqueDocumentIds = Array.from(new Set(requestedAdditionalDocumentIds))
      const storedAttachments = await resolveStoredMeetingDocuments(supabase, uniqueDocumentIds)
      for (const docId of uniqueDocumentIds) {
        const stored = storedAttachments.get(docId)
        if (stored) {
          additionalAttachments.push({
            filename: stored.filename || `meeting-document-${docId}.pdf`,
            content: stored.base64,
          })
        }
      }
      logWeeklyReportEvent(requestStartedAt, "server-side additional attachments resolved", {
        requested_document_count: uniqueDocumentIds.length,
        resolved_attachment_count: additionalAttachments.length,
        filenames: additionalAttachments.map((attachment) => attachment.filename),
      })
    }

    const hasPrefetchedActionPointAttachments =
      Array.isArray(bodyActionPointAttachments) && bodyActionPointAttachments.length > 0

    if (includeActionPoint && !trackerPdfBase64 && !hasPrefetchedActionPointAttachments) {
      throw new Error(
        "Action Points PDF must be pre-generated by the app export route or provided as a stored meeting document"
      )
    }

    if (includeWeeklyReport && !reportPdfBase64) {
      console.log("[weekly-report] Generating weekly report PDF server-side")

      // Fetch reports from the PREVIOUS week (work done data)
      const { data: reports, error: reportsError } = await supabase
        .from("weekly_reports")
        .select("id, department, week_number, year, work_done, tasks_new_week, challenges, status")
        .eq("week_number", reportDataWeek)
        .eq("year", reportDataYear)
        .eq("status", "submitted")

      if (reportsError) throw reportsError

      if (!reports || reports.length === 0) {
        console.log(`[weekly-report] No submitted reports for W${reportDataWeek}/${reportDataYear}. Skipping.`)
        return new Response(
          JSON.stringify({ skipped: true, reason: `No submitted reports for W${reportDataWeek}/${reportDataYear}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        )
      }

      // Fetch BOTH logos: light for cover page, dark for headers
      const [coverLogoBytes, headerLogoBytes] = await Promise.all([
        fetchLogoBytes(`${STORAGE_BASE}/acob-logo-light.png`),
        fetchLogoBytes(`${STORAGE_BASE}/acob-logo-dark.png`),
      ])

      const reportRows = (reports || []) as WeeklyReportRow[]
      console.log(`[weekly-report] Generating weekly report PDF: ${reportRows.length} reports`)
      logWeeklyReportEvent(requestStartedAt, "weekly report data fetched", {
        report_row_count: reportRows.length,
        report_data_week: reportDataWeek,
        report_data_year: reportDataYear,
      })

      const reportPdfBytes = await buildWeeklyReportPDF(
        reportRows,
        meetingWeek,
        meetingYear,
        meetingDateLabel,
        coverLogoBytes,
        headerLogoBytes
      )

      reportPdfBase64 = encodeBytesToBase64(reportPdfBytes)
      logWeeklyReportEvent(requestStartedAt, "weekly report pdf generated", {
        weekly_report_pdf_bytes: reportPdfBytes.length,
      })
    }

    const recipients =
      Array.isArray(bodyRecipients) && bodyRecipients.length > 0
        ? bodyRecipients
        : testEmail
          ? [testEmail]
          : ["i.chibuikem@org.acoblighting.com"]

    const attachments: AttachmentPayload[] = []
    if (includeWeeklyReport && reportPdfBase64) {
      attachments.push({
        filename: resolvedWeeklyReportFilename || buildWeeklyReportAttachmentName(meetingDateLabel, meetingWeek),
        content: reportPdfBase64,
      })
    }

    // Support multi-week action point attachments (one per week)
    if (Array.isArray(bodyActionPointAttachments) && bodyActionPointAttachments.length > 0) {
      for (const att of bodyActionPointAttachments) {
        if (att?.base64 && att?.filename) {
          attachments.push({ filename: att.filename, content: att.base64 })
        }
      }
    } else if (includeActionPoint && trackerPdfBase64) {
      attachments.push({
        filename: resolvedActionPointFilename || buildActionPointAttachmentName(meetingDateLabel, meetingWeek),
        content: trackerPdfBase64,
      })
    }
    for (const attachment of additionalAttachments) {
      attachments.push(attachment)
    }
    if (attachments.length === 0) throw new Error("No attachments to send")
    logWeeklyReportEvent(requestStartedAt, "attachments assembled", {
      recipient_count: recipients.length,
      attachment_count: attachments.length,
      attachment_filenames: attachments.map((attachment) => attachment.filename),
      approx_attachment_total_bytes: attachments.reduce(
        (total, attachment) => total + estimateBase64Bytes(attachment.content),
        0
      ),
    })

    // ── Build dynamic email context ──────────────────────────────────────
    const hasKss = additionalAttachments.some(
      (a) => a.filename?.toLowerCase().includes("kss") || a.filename?.toLowerCase().includes("knowledge")
    )
    const hasMinutes = additionalAttachments.some((a) => a.filename?.toLowerCase().includes("minutes"))
    const allWeeks: number[] =
      Array.isArray(bodyMeetingWeeks) && bodyMeetingWeeks.length > 0 ? bodyMeetingWeeks : [meetingWeek]
    const weekLabels = allWeeks.map((w) => `Week ${w}`)

    const emailCtx: EmailContentContext = {
      includeWeeklyReport,
      includeActionPoint:
        includeActionPoint || (Array.isArray(bodyActionPointAttachments) && bodyActionPointAttachments.length > 0),
      includeKss: hasKss,
      includeMinutes: hasMinutes,
      weekLabels,
    }

    const subject = buildEmailSubject(emailCtx)
    const html = buildEmailHtml(
      meetingYear,
      meetingDateLabel,
      nextMeetingDateLabel,
      preparedByName || "Terna",
      preparedByDesignation || null,
      preparedByDepartment || "Admin & HR Department",
      emailCtx
    )
    logWeeklyReportEvent(requestStartedAt, "email html built", {
      subject,
      html_length: html.length,
      include_weekly_report: includeWeeklyReport,
      include_action_point: emailCtx.includeActionPoint,
      include_kss: hasKss,
      include_minutes: hasMinutes,
    })

    const results = await processRecipientBatch(
      recipients,
      DELIVERY_BATCH_SIZE,
      async (to, index): Promise<DeliveryResult> => {
        const recipientStartedAt = Date.now()
        logWeeklyReportEvent(requestStartedAt, "recipient send started", {
          recipient: to,
          recipient_index: index + 1,
          recipient_count: recipients.length,
        })

        try {
          const data = await sendEmail({
            from: DEFAULT_SENDER,
            to,
            subject,
            html,
            attachments,
            traceLabel: `weekly-report:${index + 1}/${recipients.length}:${to}`,
          })
          console.log(`[weekly-report] Sent to ${to}. ID: ${data.id}`)
          logWeeklyReportEvent(requestStartedAt, "recipient send completed", {
            recipient: to,
            recipient_index: index + 1,
            email_id: data.id,
            recipient_elapsed_ms: Date.now() - recipientStartedAt,
            send_attempts: data.attempts,
            send_total_duration_ms: data.totalDurationMs,
            rate_limit_wait_ms: data.rateLimitWaitMs,
            resend_api_duration_ms: data.resendApiDurationMs,
            retry_backoff_ms: data.retryBackoffMs,
          })
          return { to, success: true, emailId: data.id }
        } catch (error) {
          console.error(`[weekly-report] Failed to send to ${to}:`, JSON.stringify(error))
          logWeeklyReportEvent(requestStartedAt, "recipient send failed", {
            recipient: to,
            recipient_index: index + 1,
            recipient_elapsed_ms: Date.now() - recipientStartedAt,
            error: getErrorMessage(error),
          })
          return { to, success: false, error }
        }
      }
    )

    logWeeklyReportEvent(requestStartedAt, "send cycle completed", {
      recipient_count: recipients.length,
      success_count: results.filter((result) => result.success).length,
      failure_count: results.filter((result) => !result.success).length,
      total_duration_ms: Date.now() - requestStartedAt,
      total_duration_human: formatDurationMs(Date.now() - requestStartedAt),
    })

    const successfulResults = results.filter((result) => result.success)
    try {
      await createInAppWeeklyReportNotifications({
        supabase,
        recipients,
        successfulResults,
        subject,
        meetingWeek,
        meetingYear,
        requestedByUserId,
        preparedByName,
      })
    } catch (notificationError) {
      console.error("[weekly-report] Failed to create in-app notifications:", notificationError)
    }

    try {
      const successCount = successfulResults.length
      const failureCount = results.length - successCount
      const auditEntityId = crypto.randomUUID()
      await writeEdgeAuditLog(supabase, {
        action: "weekly_report_sent",
        entityType: "mail_summary",
        entityId: auditEntityId,
        actorId: requestedByUserId || null,
        department: "Admin & HR",
        source: "edge",
        route: "/functions/send-weekly-report",
        metadata: {
          meeting_week: meetingWeek,
          meeting_year: meetingYear,
          report_data_week: reportDataWeek,
          report_data_year: reportDataYear,
          tracker_week: atWeek,
          tracker_year: atYear,
          recipient_count: recipients.length,
          success_count: successCount,
          failure_count: failureCount,
          prepared_by: preparedByName || "Terna",
          prepared_by_designation: preparedByDesignation || null,
          prepared_by_department: preparedByDepartment || "Admin & HR Department",
          attachments: attachments.map((a) => a.filename),
          failed_recipients: results.filter((r) => !r.success).map((r) => r.to),
          delivery_results: results.map((r) => ({ to: r.to, success: r.success, emailId: r.emailId ?? null })),
        },
      })
    } catch (auditErr) {
      console.error("[weekly-report] Failed to write audit log:", auditErr)
    }

    return new Response(
      JSON.stringify({
        success: true,
        meetingWeek,
        meetingYear,
        reportDataWeek,
        reportDataYear,
        atWeek,
        atYear,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )
  } catch (err: unknown) {
    console.error("[send-weekly-report] Error:", err)
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
