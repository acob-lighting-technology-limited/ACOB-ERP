import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { resolveAdminScope, getDepartmentScope, normalizeDepartmentName } from "@/lib/admin/rbac"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { REPORT_DOC_MAX_SIZE_BYTES, formatLimitMb } from "@/lib/reports/document-upload-limits"
import { buildMeetingDocumentFileName, resolveEffectiveMeetingDateIso } from "@/lib/reports/meeting-date"
import { convertOfficeDocumentToPdf } from "@/lib/reports/office-pdf"
import { logger } from "@/lib/logger"
import { getOneDriveService } from "@/lib/onedrive"
import { buildReportDocumentPath, isOneDriveReportDocumentPath } from "@/lib/reports/document-storage"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("api-reports-meeting-week-documents")
const BUCKET = "meeting_documents"

type ReportsClient = Awaited<ReturnType<typeof createClient>>

type DocumentType = "knowledge_sharing_session" | "minutes" | "attendance" | "transcript"

const KSS_ALLOWED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const CAN_CONVERT_OFFICE_TO_PDF = process.platform === "win32"

async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Ignore write attempts from server component contexts.
        }
      },
    },
  })
}

function normalizeDepartment(value: string): string {
  return normalizeDepartmentName(String(value || "").trim())
}

function sanitizeName(name: string): string {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_")
}

function resolveExtension(file: File): string {
  const raw = file.name || ""
  const dotIdx = raw.lastIndexOf(".")
  if (dotIdx > -1) return raw.slice(dotIdx + 1).toLowerCase()
  if (file.type === "application/pdf") return "pdf"
  if (file.type === PPTX_MIME) return "pptx"
  if (file.type === DOCX_MIME) return "docx"
  return "bin"
}

function baseNameWithoutExtension(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".")
  return dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName
}

function hasGlobalReportsWriteAccess(scope: NonNullable<Awaited<ReturnType<typeof resolveAdminScope>>>): boolean {
  return getDepartmentScope(scope, "general") === null
}

/**
 * Document types every authenticated staff member may read.
 *
 * These are the two the employee General Meeting surface links to —
 * /reports/kss and /reports/minutes-of-meeting, both rendered read-only.
 * Attendance and transcripts have no employee page and stay admin-only.
 * Writes are gated separately in POST/PATCH/DELETE for all types.
 */
const STAFF_READABLE_DOCUMENT_TYPES: DocumentType[] = ["knowledge_sharing_session", "minutes"]

function isStaffReadableDocumentType(value: unknown): boolean {
  return STAFF_READABLE_DOCUMENT_TYPES.includes(value as DocumentType)
}

function parseDocumentType(value: unknown): DocumentType | null {
  if (
    value === "knowledge_sharing_session" ||
    value === "minutes" ||
    value === "attendance" ||
    value === "transcript"
  ) {
    return value
  }
  return null
}

async function assertWeekIsMutable(supabase: ReportsClient, meetingWeek: number, meetingYear: number) {
  const { data, error } = await supabase.rpc("weekly_report_can_mutate", {
    p_week: meetingWeek,
    p_year: meetingYear,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error(`Week ${meetingWeek}, ${meetingYear} is locked and can no longer be changed`)
  }
}

async function assertWeekAllowsDocumentCreate(
  supabase: ReportsClient,
  params: {
    meetingWeek: number
    meetingYear: number
    documentType: DocumentType
    department: string | null
    departmentId?: string | null
  }
) {
  const { data, error } = await supabase.rpc("weekly_report_can_mutate", {
    p_week: params.meetingWeek,
    p_year: params.meetingYear,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (data) return

  const lockCheckQuery = supabase
    .from("meeting_week_documents")
    .select("id")
    .eq("meeting_week", params.meetingWeek)
    .eq("meeting_year", params.meetingYear)
    .eq("document_type", params.documentType)
    .eq("is_current", true)

  const scopedLockCheckQuery = params.departmentId
    ? lockCheckQuery.eq("department_id", params.departmentId)
    : params.department
      ? lockCheckQuery.eq("department", params.department)
      : lockCheckQuery.is("department", null).is("department_id", null)

  const { data: existingRow, error: existingError } = await scopedLockCheckQuery.maybeSingle()

  if (existingError) {
    throw new Error(existingError.message)
  }

  if (existingRow) {
    throw new Error(`Week ${params.meetingWeek}, ${params.meetingYear} is locked and can no longer be changed`)
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get("id") || "")
    const week = Number(searchParams.get("week") || "")
    const year = Number(searchParams.get("year") || "")
    const docType = parseDocumentType(searchParams.get("documentType"))
    const currentOnly = searchParams.get("currentOnly") === "true"
    const mode = searchParams.get("mode")

    // KSS and Minutes are shown read-only on the employee General Meeting pages,
    // so every authenticated staff member may read them. Attendance and
    // transcripts stay admin-only. Writes are gated in POST/PATCH/DELETE.
    const scope = await resolveAdminScope(supabase as ReportsClient, user.id)
    // Only meaningful when the caller names a type. The id-based download and
    // preview branches pass no documentType — they resolve the row first and
    // check its own document_type below — and the list branch is constrained to
    // STAFF_READABLE_DOCUMENT_TYPES further down. Rejecting a null docType here
    // returned 403 to every non-admin download, which surfaced in the browser as
    // "File wasn't available on site".
    if (!scope && docType && !isStaffReadableDocumentType(docType)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (id && mode === "download") {
      const { data: row, error: rowError } = await supabase
        .from("meeting_week_documents")
        .select("id, file_name, file_path, mime_type, document_type")
        .eq("id", id)
        .single()

      if (rowError || !row) return NextResponse.json({ error: "Document not found" }, { status: 404 })
      if (!scope && !isStaffReadableDocumentType(row.document_type)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      if (isOneDriveReportDocumentPath(row.file_path)) {
        const onedrive = getOneDriveService()
        const downloadUrl = await onedrive.getDownloadUrl(row.file_path)
        const downloadResponse = await fetch(downloadUrl)

        if (!downloadResponse.ok) {
          return NextResponse.json({ error: "Failed to download document" }, { status: 502 })
        }

        const bytes = new Uint8Array(await downloadResponse.arrayBuffer())
        return new NextResponse(bytes, {
          headers: {
            "Content-Type": row.mime_type || downloadResponse.headers.get("Content-Type") || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${sanitizeName(row.file_name || "document.pdf")}"`,
            "Cache-Control": "private, max-age=60",
          },
        })
      }

      const { data: signed, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.file_path, 3600)
      if (signedError || !signed?.signedUrl) {
        return NextResponse.json({ error: signedError?.message || "Failed to create download link" }, { status: 500 })
      }

      return NextResponse.redirect(signed.signedUrl)
    }

    if (id && mode === "preview") {
      const { data: row, error: rowError } = await supabase
        .from("meeting_week_documents")
        .select(
          "id, meeting_week, meeting_year, document_type, department, presenter_id, presenter_name, file_name, file_path, mime_type"
        )
        .eq("id", id)
        .single()

      if (rowError || !row) return NextResponse.json({ error: "Document not found" }, { status: 404 })
      if (!scope && !isStaffReadableDocumentType(row.document_type)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      if (isOneDriveReportDocumentPath(row.file_path)) {
        const onedrive = getOneDriveService()
        const previewUrl = await onedrive.getPreviewUrl(row.file_path).catch(() => null)
        if (previewUrl) {
          return NextResponse.redirect(previewUrl)
        }
        const downloadUrl = await onedrive.getDownloadUrl(row.file_path)
        return NextResponse.redirect(downloadUrl)
      }

      const { data: fileData, error: downloadError } = await supabase.storage.from(BUCKET).download(row.file_path)
      if (downloadError || !fileData) {
        return NextResponse.json({ error: downloadError?.message || "Failed to load preview file" }, { status: 500 })
      }

      const bytes = new Uint8Array(await fileData.arrayBuffer())
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": row.mime_type || "application/pdf",
          "Content-Disposition": `inline; filename="${sanitizeName(row.file_name || "document.pdf")}"`,
          "Cache-Control": "private, max-age=60",
        },
      })
    }

    let query = supabase
      .from("meeting_week_documents")
      .select(
        "id, meeting_week, meeting_year, document_type, department, presenter_id, presenter_name, notes, source_label, file_name, file_path, mime_type, file_size, version_no, is_current, replaced_by, uploaded_by, created_at, updated_at"
      )
      .order("meeting_year", { ascending: false })
      .order("meeting_week", { ascending: false })
      .order("created_at", { ascending: false })

    if (Number.isFinite(week) && week > 0) query = query.eq("meeting_week", week)
    if (Number.isFinite(year) && year > 0) query = query.eq("meeting_year", year)
    if (docType) query = query.eq("document_type", docType)
    // Non-admin staff only ever see the staff-readable types, whatever they ask for.
    if (!scope) query = query.in("document_type", STAFF_READABLE_DOCUMENT_TYPES)
    if (currentOnly) query = query.eq("is_current", true)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = data || []
    const meetingDateByWeekYear = new Map<string, string>()
    await Promise.all(
      Array.from(new Set(rows.map((row) => `${row.meeting_year}-${row.meeting_week}`))).map(async (key) => {
        const [yearText, weekText] = key.split("-")
        const meetingDate = await resolveEffectiveMeetingDateIso(supabase, Number(weekText), Number(yearText))
        meetingDateByWeekYear.set(key, meetingDate)
      })
    )
    const withUrls = await Promise.all(
      rows.map(async (row) => {
        const { data: canMutate } = await supabase.rpc("weekly_report_can_mutate", {
          p_week: row.meeting_week,
          p_year: row.meeting_year,
        })
        return {
          ...row,
          meeting_date: meetingDateByWeekYear.get(`${row.meeting_year}-${row.meeting_week}`) || null,
          is_locked: !Boolean(canMutate),
          signed_url: `/api/reports/meeting-week-documents?id=${row.id}&mode=download`,
        }
      })
    )

    return NextResponse.json({ data: withUrls })
  } catch (error) {
    log.error({ err: String(error) }, "GET /api/reports/meeting-week-documents failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const rl = await rateLimit(`reports-meeting-week-documents:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase as ReportsClient, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can upload meeting documents" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const meetingWeek = Number(formData.get("meetingWeek"))
    const meetingYear = Number(formData.get("meetingYear"))
    const documentType = parseDocumentType(formData.get("documentType"))
    const notes = formData.get("notes") ? String(formData.get("notes")) : null
    const presenterId = formData.get("presenterId") ? String(formData.get("presenterId")) : null
    const presenterNameInput = formData.get("presenterName") ? String(formData.get("presenterName")) : null
    const rawDept = formData.get("department") ? String(formData.get("department")) : ""
    const department = rawDept ? normalizeDepartment(rawDept) : null

    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 })
    if (file.size > REPORT_DOC_MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}` },
        { status: 400 }
      )
    }
    if (!Number.isFinite(meetingWeek) || meetingWeek < 1 || meetingWeek > 53) {
      return NextResponse.json({ error: "meetingWeek must be between 1 and 53" }, { status: 400 })
    }
    if (!Number.isFinite(meetingYear) || meetingYear < 2000 || meetingYear > 2100) {
      return NextResponse.json({ error: "meetingYear must be between 2000 and 2100" }, { status: 400 })
    }
    if (!documentType) return NextResponse.json({ error: "Invalid documentType" }, { status: 400 })

    const { data: deptLookup } = department
      ? await supabase.from("departments").select("id").eq("name", department).single()
      : { data: null }
    const departmentId: string | null = deptLookup?.id ?? null

    await assertWeekAllowsDocumentCreate(supabase, {
      meetingWeek,
      meetingYear,
      documentType,
      department,
      departmentId,
    })

    if (documentType === "knowledge_sharing_session") {
      if (!department) {
        return NextResponse.json(
          { error: "department is required for Knowledge Sharing Session documents" },
          { status: 400 }
        )
      }
      if (!presenterId && !presenterNameInput?.trim()) {
        return NextResponse.json(
          { error: "presenterId or presenterName is required for Knowledge Sharing Session documents" },
          { status: 400 }
        )
      }
      if (!KSS_ALLOWED.has(file.type)) {
        return NextResponse.json(
          { error: "Knowledge Sharing Session file must be PDF, PPTX, or DOCX" },
          { status: 400 }
        )
      }
    } else {
      if (!["application/pdf", DOCX_MIME].includes(file.type)) {
        return NextResponse.json({ error: "Minutes files must be PDF or DOCX" }, { status: 400 })
      }
    }

    const shouldConvertToPdf = file.type === PPTX_MIME || file.type === DOCX_MIME
    const originalExtension = resolveExtension(file)
    let uploadBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(await file.arrayBuffer())
    let uploadMimeType = file.type
    let convertedFrom: "docx" | "pptx" | null = null
    const meetingDate = await resolveEffectiveMeetingDateIso(supabase, meetingWeek, meetingYear)
    let presenterName: string | null = null
    let normalizedFileName = file.name

    if (documentType === "knowledge_sharing_session") {
      if (presenterId) {
        const { data: presenter, error: presenterError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", presenterId)
          .single()
        if (presenterError || !presenter?.full_name) {
          return NextResponse.json({ error: "Presenter not found" }, { status: 400 })
        }
        presenterName = presenter.full_name
      } else {
        const visitorName = presenterNameInput?.trim()
        if (!visitorName) {
          return NextResponse.json({ error: "Visitor presenter name is required" }, { status: 400 })
        }
        presenterName = visitorName
      }
    }

    // On Vercel (Linux), LibreOffice isn't available — upload the original file as-is
    const willConvert = shouldConvertToPdf && CAN_CONVERT_OFFICE_TO_PDF
    normalizedFileName = buildMeetingDocumentFileName({
      documentType,
      meetingDate,
      meetingWeek,
      extension: willConvert ? "pdf" : originalExtension,
      department,
      presenterName,
    })

    if (willConvert) {
      try {
        const converted = await convertOfficeDocumentToPdf(
          uploadBuffer,
          baseNameWithoutExtension(normalizedFileName),
          file.type === PPTX_MIME ? "pptx" : "docx"
        )
        uploadBuffer = converted.buffer
        uploadMimeType = converted.mimeType
        normalizedFileName = buildMeetingDocumentFileName({
          documentType,
          meetingDate,
          meetingWeek,
          extension: "pdf",
          department,
          presenterName,
        })
        convertedFrom = converted.sourceKind
      } catch (conversionError) {
        log.warn({ err: String(conversionError) }, "Document conversion failed")
        return NextResponse.json(
          { error: "We couldn't convert this file to PDF on the server. Please upload a PDF instead." },
          { status: 400 }
        )
      }
    }

    const onedriveFilePath = buildReportDocumentPath({
      meetingYear,
      meetingWeek,
      documentType,
      department,
      fileName: normalizedFileName,
    })
    let filePath = onedriveFilePath

    const onedrive = getOneDriveService()
    if (onedrive.isEnabled()) {
      try {
        const folderPath = onedriveFilePath.slice(0, onedriveFilePath.lastIndexOf("/"))
        await onedrive.createFolder(folderPath)
        await onedrive.uploadFile(onedriveFilePath, uploadBuffer, uploadMimeType)
      } catch (uploadError) {
        return NextResponse.json(
          { error: uploadError instanceof Error ? uploadError.message : "Failed to upload file" },
          { status: 500 }
        )
      }
    } else {
      const legacyFilePath = onedriveFilePath.replace(/^\/reports\//, "")
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(legacyFilePath, uploadBuffer, {
        contentType: uploadMimeType,
        upsert: false,
      })
      if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })
      filePath = legacyFilePath
    }

    const currentRowsQuery = supabase
      .from("meeting_week_documents")
      .select("id, version_no")
      .eq("meeting_week", meetingWeek)
      .eq("meeting_year", meetingYear)
      .eq("document_type", documentType)
      .eq("is_current", true)
      .order("version_no", { ascending: false })

    const scopedCurrentRowsQuery = departmentId
      ? currentRowsQuery.eq("department_id", departmentId)
      : department
        ? currentRowsQuery.eq("department", department)
        : currentRowsQuery.is("department", null).is("department_id", null)

    const { data: currentRows, error: currentError } = await scopedCurrentRowsQuery

    if (currentError) {
      return NextResponse.json({ error: currentError.message }, { status: 500 })
    }

    const current = currentRows?.[0] || null
    const nextVersion = (current?.version_no || 0) + 1

    if (current?.id) {
      const { error: clearCurrentError } = await supabase
        .from("meeting_week_documents")
        .update({ is_current: false })
        .eq("id", current.id)
      if (clearCurrentError) return NextResponse.json({ error: clearCurrentError.message }, { status: 500 })
    }

    const { data: saved, error: saveError } = await supabase
      .from("meeting_week_documents")
      .insert({
        meeting_week: meetingWeek,
        meeting_year: meetingYear,
        document_type: documentType,
        department,
        presenter_id: documentType === "knowledge_sharing_session" ? presenterId : null,
        presenter_name: documentType === "knowledge_sharing_session" ? presenterName : null,
        notes,
        file_name: normalizedFileName,
        file_path: filePath,
        mime_type: uploadMimeType,
        file_size: uploadBuffer.byteLength,
        version_no: nextVersion,
        is_current: true,
        replaced_by: null,
        uploaded_by: user.id,
      })
      .select(
        "id, meeting_week, meeting_year, document_type, department, presenter_id, presenter_name, notes, source_label, file_name, file_path, mime_type, file_size, version_no, is_current, replaced_by, uploaded_by, created_at, updated_at"
      )
      .single()

    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

    if (current?.id) {
      await supabase.from("meeting_week_documents").update({ replaced_by: saved.id }).eq("id", current.id)
    }

    await writeAuditLog(
      supabase as ReportsClient,
      {
        action: "create",
        entityType: "mail_summary",
        entityId: saved.id,
        metadata: {
          event: "meeting_week_document_uploaded",
          meeting_week: meetingWeek,
          meeting_year: meetingYear,
          document_type: documentType,
          department,
          presenter_id: presenterId,
          version_no: nextVersion,
          converted_from: convertedFrom,
          original_file_name: file.name,
          original_mime_type: file.type,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/meeting-week-documents",
          department,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: saved, converted: Boolean(convertedFrom), convertedFrom }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    log.error({ err: String(error) }, "POST /api/reports/meeting-week-documents failed")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const rl = await rateLimit(`reports-meeting-week-documents:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase as ReportsClient, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can update meeting documents" }, { status: 403 })
    }

    const body = await request.json()
    const id = String(body?.id || "")
    const makeCurrent = body?.makeCurrent !== false

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const { data: doc, error: fetchError } = await supabase
      .from("meeting_week_documents")
      .select(
        "id, meeting_week, meeting_year, document_type, department, department_id, presenter_id, notes, file_name, file_path, mime_type, file_size, version_no, is_current, replaced_by, uploaded_by, created_at, updated_at"
      )
      .eq("id", id)
      .single()

    if (fetchError || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

    await assertWeekIsMutable(supabase, doc.meeting_week, doc.meeting_year)

    if (makeCurrent) {
      const clearQuery = supabase
        .from("meeting_week_documents")
        .update({ is_current: false })
        .eq("meeting_week", doc.meeting_week)
        .eq("meeting_year", doc.meeting_year)
        .eq("document_type", doc.document_type)

      const { error: clearError } = await (doc.department_id
        ? clearQuery.eq("department_id", doc.department_id)
        : clearQuery.eq("department", doc.department))

      if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 })
    }

    const patch: Record<string, unknown> = {}
    if (makeCurrent) patch.is_current = true
    if (body?.notes !== undefined) patch.notes = body.notes ? String(body.notes) : null

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No patch fields provided" }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from("meeting_week_documents")
      .update(patch)
      .eq("id", id)
      .select(
        "id, meeting_week, meeting_year, document_type, department, presenter_id, notes, file_name, file_path, mime_type, file_size, version_no, is_current, replaced_by, uploaded_by, created_at, updated_at"
      )
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase as ReportsClient,
      {
        action: "update",
        entityType: "mail_summary",
        entityId: updated.id,
        metadata: {
          event: "meeting_week_document_updated",
          patch,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/meeting-week-documents",
          department: updated.department,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updated })
  } catch (error) {
    log.error({ err: String(error) }, "PATCH /api/reports/meeting-week-documents failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const rl = await rateLimit(`reports-meeting-week-documents:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase as ReportsClient, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can delete meeting documents" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get("id") || "")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const { data: doc, error: fetchError } = await supabase
      .from("meeting_week_documents")
      .select("id, meeting_week, meeting_year, document_type, department, file_path")
      .eq("id", id)
      .single()

    if (fetchError || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

    await assertWeekIsMutable(supabase, doc.meeting_week, doc.meeting_year)

    if (doc.file_path) {
      if (isOneDriveReportDocumentPath(doc.file_path)) {
        const onedrive = getOneDriveService()
        await onedrive.deleteItem(doc.file_path)
      } else {
        await supabase.storage.from(BUCKET).remove([doc.file_path])
      }
    }

    const { error: deleteError } = await supabase.from("meeting_week_documents").delete().eq("id", id)
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    await writeAuditLog(
      supabase as ReportsClient,
      {
        action: "delete",
        entityType: "mail_summary",
        entityId: id,
        metadata: {
          event: "meeting_week_document_deleted",
          meeting_week: doc.meeting_week,
          meeting_year: doc.meeting_year,
          document_type: doc.document_type,
          department: doc.department,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/meeting-week-documents",
          department: doc.department,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "DELETE /api/reports/meeting-week-documents failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
