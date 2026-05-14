import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getOneDriveService } from "@/lib/onedrive"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import {
  buildDocumentationFolderPath,
  buildDocumentationTextBackup,
  buildEmployeeFolderName,
  mergeDocumentationAttachments,
  normalizeDocumentationTags,
  sanitizeSharePointFileName,
  type DocumentationAttachment,
} from "@/lib/documentation/sharepoint"

type DocumentationInsertPayload = {
  id: string
  user_id: string
  title: string
  content: string
  category: string | null
  tags: string[]
  is_draft: boolean
  sharepoint_folder_path: string
  sharepoint_text_file_path: string
  sharepoint_attachments: DocumentationAttachment[]
  created_at: string
}

type UserDocumentationRow = DocumentationInsertPayload & {
  created_at: string
  updated_at: string
}

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
          // Ignore errors
        }
      },
    },
  })
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  return String(value || "false").toLowerCase() === "true"
}

function parseString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : ""
}

function getUploadedFiles(formData: FormData): File[] {
  return formData
    .getAll("attachments")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0)
}

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null }
  }

  return { supabase, user }
}

async function getEmployeeDisplayName(userId: string, fallbackEmail?: string) {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: profile } = await dataClient
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", userId)
    .maybeSingle()

  const fullName =
    profile?.full_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    fallbackEmail?.split("@")[0] ||
    "Unknown Employee"

  return buildEmployeeFolderName(fullName)
}

async function uploadDocumentationAssets(params: {
  folderPath: string
  title: string
  category: string | null
  tags: string[]
  content: string
  isDraft: boolean
  updatedAt: string
  employeeName: string
  files: File[]
  existingAttachments?: DocumentationAttachment[]
}) {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) {
    throw new Error("SharePoint integration is not configured")
  }

  await onedrive.createFolder(params.folderPath)

  const textFilePath = `${params.folderPath}/documentation.txt`
  const textContent = buildDocumentationTextBackup({
    title: params.title,
    category: params.category,
    tags: params.tags,
    content: params.content,
    isDraft: params.isDraft,
    updatedAt: params.updatedAt,
    employeeName: params.employeeName,
  })

  await onedrive.uploadFile(textFilePath, new TextEncoder().encode(textContent), "text/plain; charset=utf-8")

  const uploadedAttachments: DocumentationAttachment[] = []
  for (const file of params.files) {
    const safeName = sanitizeSharePointFileName(file.name)
    const filePath = `${params.folderPath}/${safeName}`
    await onedrive.uploadFile(filePath, await file.arrayBuffer(), file.type || "application/octet-stream")
    uploadedAttachments.push({
      id: crypto.randomUUID(),
      name: safeName,
      file_path: filePath,
      mime_type: file.type || null,
      size: file.size,
      uploaded_at: new Date().toISOString(),
    })
  }

  return {
    textFilePath,
    attachments: mergeDocumentationAttachments(params.existingAttachments || [], uploadedAttachments),
  }
}

export async function POST(request: Request) {
  try {
    const rl = await rateLimit(`documentation-create:${getClientId(request)}`, { limit: 20, windowSec: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    const { supabase, user } = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const title = parseString(formData.get("title"))
    const content = parseString(formData.get("content"))
    const category = parseString(formData.get("category")) || null
    const tags = normalizeDocumentationTags(parseString(formData.get("tags")))
    const isDraft = parseBoolean(formData.get("is_draft"))
    const files = getUploadedFiles(formData)

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 })
    }

    const documentId = crypto.randomUUID()
    const employeeName = await getEmployeeDisplayName(user.id, user.email)
    const createdAt = new Date().toISOString()
    const folderPath = buildDocumentationFolderPath(employeeName, title, createdAt, documentId)
    const updatedAt = createdAt
    const uploaded = await uploadDocumentationAssets({
      folderPath,
      title,
      category,
      tags,
      content,
      isDraft,
      updatedAt,
      employeeName,
      files,
    })

    const payload: DocumentationInsertPayload = {
      id: documentId,
      user_id: user.id,
      title,
      content,
      category,
      tags,
      is_draft: isDraft,
      sharepoint_folder_path: folderPath,
      sharepoint_text_file_path: uploaded.textFilePath,
      sharepoint_attachments: uploaded.attachments,
      created_at: createdAt,
    }

    const { data, error } = await supabase.from("user_documentation").insert(payload).select("*").single()
    if (error) {
      throw error
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "documentation",
        entityId: documentId,
        newValues: payload,
        context: { source: "api", route: "/api/documentation/internal", actorId: user.id },
      },
      { failOpen: true }
    )

    return NextResponse.json({ doc: data as UserDocumentationRow })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create documentation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
