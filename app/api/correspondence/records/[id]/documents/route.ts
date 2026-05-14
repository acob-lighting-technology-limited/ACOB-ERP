import { NextResponse } from "next/server"
import {
  getAuthContext,
  canAccessRecord,
  appendCorrespondenceEvent,
  appendCorrespondenceAuditLog,
} from "@/lib/correspondence/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { getOneDriveService } from "@/lib/onedrive"
import {
  buildCorrespondenceDocumentPath,
  isOneDriveCorrespondenceDocumentPath,
} from "@/lib/correspondence/document-storage"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-records-documents")

const BUCKET = "correspondence_documents"

type DocumentType = "draft" | "proof" | "supporting"

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function resolveKindFromPath(filePath: string): DocumentType {
  if (filePath.includes("/supporting/")) return "supporting"
  if (filePath.includes("/proof/")) return "proof"
  return "draft"
}

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const requestUrl = new URL(_request.url)
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: record, error: recordError } = await supabase
      .from("correspondence_records")
      .select("*")
      .eq("id", params.id)
      .single()

    if (recordError || !record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 })
    }

    const getScope = await getRequestScope()
    const isGlobalAdmin = getScope?.isAdminLike === true && getScope.scopeMode !== "lead"
    if (!isGlobalAdmin && !canAccessRecord(profile, user.id, record)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const mode = requestUrl.searchParams.get("mode")
    const filePath = requestUrl.searchParams.get("path")

    if (mode === "download" && filePath) {
      if (isOneDriveCorrespondenceDocumentPath(filePath)) {
        const onedrive = getOneDriveService()
        const downloadUrl = await onedrive.getDownloadUrl(filePath)
        return NextResponse.redirect(downloadUrl)
      }

      const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 3600)
      if (signedError || !signed?.signedUrl) {
        return NextResponse.json({ error: signedError?.message || "Failed to create download link" }, { status: 500 })
      }

      return NextResponse.redirect(signed.signedUrl)
    }

    const { data: versions, error: versionError } = await supabase
      .from("correspondence_versions")
      .select("*")
      .eq("correspondence_id", record.id)
      .order("version_no", { ascending: false })

    if (versionError) {
      return NextResponse.json({ error: versionError.message }, { status: 500 })
    }

    const files = [] as Array<Record<string, unknown>>

    for (const version of versions || []) {
      if (!version.file_path) continue

      files.push({
        kind: resolveKindFromPath(version.file_path),
        version_no: version.version_no,
        file_path: version.file_path,
        signed_url: `/api/correspondence/records/${record.id}/documents?mode=download&path=${encodeURIComponent(version.file_path)}`,
        created_at: version.created_at,
      })
    }

    if (record.proof_of_delivery_path) {
      files.push({
        kind: "proof",
        file_path: record.proof_of_delivery_path,
        signed_url: `/api/correspondence/records/${record.id}/documents?mode=download&path=${encodeURIComponent(record.proof_of_delivery_path)}`,
        created_at: record.sent_at || record.updated_at,
      })
    }

    return NextResponse.json({ data: files })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/records/[id]/documents:")
    const message = error instanceof Error ? error.message : "Internal Server Error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`correspondence-records-documents:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: record, error: recordError } = await supabase
      .from("correspondence_records")
      .select("*")
      .eq("id", params.id)
      .single()

    if (recordError || !record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 })
    }

    const postScope = await getRequestScope()
    const isGlobalAdminPost = postScope?.isAdminLike === true && postScope.scopeMode !== "lead"
    if (!isGlobalAdminPost && !canAccessRecord(profile, user.id, record)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const documentType = String(formData.get("document_type") || "draft").toLowerCase() as DocumentType
    const changeSummary = formData.get("change_summary") ? String(formData.get("change_summary")) : null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    if (!["draft", "proof", "supporting"].includes(documentType)) {
      return NextResponse.json({ error: "document_type must be draft, proof, or supporting" }, { status: 400 })
    }

    const safeName = sanitizeName(file.name)
    const onedriveFilePath = buildCorrespondenceDocumentPath(record.id, documentType, safeName)
    let filePath = onedriveFilePath
    const onedrive = getOneDriveService()

    if (onedrive.isEnabled()) {
      try {
        const folderPath = onedriveFilePath.slice(0, onedriveFilePath.lastIndexOf("/"))
        await onedrive.createFolder(folderPath)
        const buffer = await file.arrayBuffer()
        await onedrive.uploadFile(onedriveFilePath, buffer, file.type)
      } catch (uploadError) {
        return NextResponse.json(
          { error: uploadError instanceof Error ? uploadError.message : "Failed to upload file" },
          { status: 500 }
        )
      }
    } else {
      const basePath =
        documentType === "proof"
          ? `${record.id}/proof`
          : documentType === "supporting"
            ? `${record.id}/supporting`
            : `${record.id}/drafts`
      filePath = `${basePath}/${Date.now()}-${safeName}`

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, file)

      if (uploadError) {
        return NextResponse.json({ error: uploadError.message || "Failed to upload file" }, { status: 500 })
      }
    }

    if (documentType === "proof") {
      const { data: updatedRecord, error: updateError } = await supabase
        .from("correspondence_records")
        .update({ proof_of_delivery_path: filePath })
        .eq("id", record.id)
        .select("*")
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      await appendCorrespondenceEvent({
        correspondenceId: record.id,
        actorId: user.id,
        eventType: "proof_uploaded",
        oldStatus: record.status,
        newStatus: updatedRecord.status,
        details: { file_path: filePath },
      })

      await appendCorrespondenceAuditLog({
        actorId: user.id,
        action: "correspondence_proof_uploaded",
        recordId: record.id,
        department: record.department_name || record.assigned_department_name || null,
        route: "/api/correspondence/records/[id]/documents",
        critical: false,
        oldValues: { proof_of_delivery_path: record.proof_of_delivery_path },
        newValues: { proof_of_delivery_path: filePath },
      })

      return NextResponse.json({ data: { file_path: filePath, kind: "proof" } }, { status: 201 })
    }

    const nextVersion = Number(record.current_version || 1) + 1

    const [{ data: versionRow, error: versionError }, { error: recordUpdateError }] = await Promise.all([
      supabase
        .from("correspondence_versions")
        .insert({
          correspondence_id: record.id,
          version_no: nextVersion,
          file_path: filePath,
          change_summary: changeSummary,
          uploaded_by: user.id,
        })
        .select("*")
        .single(),
      supabase.from("correspondence_records").update({ current_version: nextVersion }).eq("id", record.id),
    ])

    if (versionError) {
      return NextResponse.json({ error: versionError.message }, { status: 500 })
    }

    if (recordUpdateError) {
      return NextResponse.json({ error: recordUpdateError.message }, { status: 500 })
    }

    await appendCorrespondenceEvent({
      correspondenceId: record.id,
      actorId: user.id,
      eventType: documentType === "supporting" ? "supporting_document_uploaded" : "draft_version_uploaded",
      oldStatus: record.status,
      newStatus: record.status,
      details: {
        file_path: filePath,
        version_no: nextVersion,
        document_type: documentType,
      },
    })

    await appendCorrespondenceAuditLog({
      actorId: user.id,
      action: "correspondence_version_uploaded",
      recordId: record.id,
      department: record.department_name || record.assigned_department_name || null,
      route: "/api/correspondence/records/[id]/documents",
      critical: false,
      oldValues: { current_version: record.current_version },
      newValues: { current_version: nextVersion, file_path: filePath, document_type: documentType },
    })

    return NextResponse.json({ data: versionRow }, { status: 201 })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error in POST /api/correspondence/records/[id]/documents:")
    const message = error instanceof Error ? error.message : "Internal Server Error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export { POST as PATCH }
