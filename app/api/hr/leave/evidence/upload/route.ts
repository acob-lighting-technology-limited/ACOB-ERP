import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getOneDriveService } from "@/lib/onedrive"
import { logger } from "@/lib/logger"

const log = logger("hr-leave-evidence-upload")

function sanitizeFileName(name: string): string {
  const trimmed = String(name || "attachment").trim()
  const cleaned = trimmed.replace(/[^\w.\-]+/g, "_")
  return cleaned || "attachment"
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const fileValue = formData.get("file")
    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const onedrive = getOneDriveService()
    if (!onedrive.isEnabled()) {
      return NextResponse.json({ error: "SharePoint integration is not configured" }, { status: 503 })
    }

    const now = new Date()
    const year = String(now.getUTCFullYear())
    const month = String(now.getUTCMonth() + 1).padStart(2, "0")
    const basePath = `/leave/${year}/${month}`

    try {
      await onedrive.createFolder(basePath)
    } catch {
      // Folder may already exist.
    }

    const safeName = sanitizeFileName(fileValue.name)
    const uniqueName = `${Date.now()}-${safeName}`
    const uploadPath = `${basePath}/${uniqueName}`
    const uploadResult = await onedrive.uploadFile(
      uploadPath,
      new Uint8Array(await fileValue.arrayBuffer()),
      fileValue.type || "application/octet-stream"
    )

    return NextResponse.json({
      data: {
        file_name: uniqueName,
        file_path: uploadPath,
        file_url: uploadResult.webUrl,
        mime_type: uploadResult.file?.mimeType || fileValue.type || "application/octet-stream",
        size: fileValue.size,
      },
      message: "Attachment uploaded successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/leave/evidence/upload:")
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Attachment upload failed" },
      { status: 500 }
    )
  }
}
