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
  getFolderNameFromPath,
  getParentFolderPath,
  mergeDocumentationAttachments,
  normalizeDocumentationTags,
  remapPathPrefix,
  sanitizeSharePointFileName,
  type DocumentationAttachment,
} from "@/lib/documentation/sharepoint"

type UserDocumentationRow = {
  id: string
  user_id: string
  title: string
  content: string
  category: string | null
  tags: string[]
  is_draft: boolean
  sharepoint_folder_path: string | null
  sharepoint_text_file_path: string | null
  sharepoint_attachments: DocumentationAttachment[] | null
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

function parseString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : ""
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  return String(value || "false").toLowerCase() === "true"
}

function getUploadedFiles(formData: FormData): File[] {
  return formData
    .getAll("attachments")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0)
}

async function getAuthenticatedDoc(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, doc: null }
  }

  const { data: doc, error } = await supabase
    .from("user_documentation")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) {
    throw error
  }

  return { supabase, user, doc: doc as UserDocumentationRow | null }
}

async function getEmployeeDisplayName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email?: string
) {
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: profile } = await dataClient
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", userId)
    .maybeSingle()

  const fullName =
    profile?.full_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    email?.split("@")[0] ||
    "Unknown Employee"

  return buildEmployeeFolderName(fullName)
}

async function syncDocumentationAssets(params: {
  folderPath: string
  textFilePath: string
  title: string
  category: string | null
  tags: string[]
  content: string
  isDraft: boolean
  updatedAt: string
  employeeName: string
  files: File[]
  existingAttachments: DocumentationAttachment[]
}) {
  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) {
    throw new Error("SharePoint integration is not configured")
  }

  await onedrive.createFolder(params.folderPath)

  const textContent = buildDocumentationTextBackup({
    title: params.title,
    category: params.category,
    tags: params.tags,
    content: params.content,
    isDraft: params.isDraft,
    updatedAt: params.updatedAt,
    employeeName: params.employeeName,
  })

  await onedrive.uploadFile(params.textFilePath, new TextEncoder().encode(textContent), "text/plain; charset=utf-8")

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

  return mergeDocumentationAttachments(params.existingAttachments, uploadedAttachments)
}

async function deleteSharePointFolderIfExists(folderPath: string | null) {
  if (!folderPath) {
    return
  }

  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) {
    return
  }

  try {
    await onedrive.deleteItem(folderPath)
  } catch (error) {
    if (error instanceof Error && error.message.includes("itemNotFound")) {
      return
    }
    throw error
  }
}

export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`documentation-update:${getClientId(request)}`, { limit: 20, windowSec: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    const { supabase, user, doc } = await getAuthenticatedDoc(params.id)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!doc) {
      return NextResponse.json({ error: "Documentation not found" }, { status: 404 })
    }

    const formData = await request.formData()
    const title = parseString(formData.get("title"))
    const content = parseString(formData.get("content"))
    const category = parseString(formData.get("category")) || null
    const tags = normalizeDocumentationTags(parseString(formData.get("tags")))
    const isDraft = parseBoolean(formData.get("is_draft"))
    // Only the author reaches this update (the query is scoped by user_id below),
    // so publishing to the whole company stays the author's own decision.
    const visibility = String(formData.get("visibility") ?? "") === "general" ? "general" : "private"
    const files = getUploadedFiles(formData)

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 })
    }

    const employeeName = await getEmployeeDisplayName(supabase, user.id, user.email)
    const desiredFolderPath = buildDocumentationFolderPath(employeeName, title, doc.created_at, doc.id)
    const onedrive = getOneDriveService()
    const currentFolderPath = doc.sharepoint_folder_path
    let folderPath = currentFolderPath || desiredFolderPath

    if (currentFolderPath && currentFolderPath !== desiredFolderPath && onedrive.isEnabled()) {
      await onedrive.createFolder(getParentFolderPath(desiredFolderPath))
      await onedrive.moveItem(
        currentFolderPath,
        getParentFolderPath(desiredFolderPath),
        getFolderNameFromPath(desiredFolderPath)
      )
      folderPath = desiredFolderPath
    }

    const textFilePath =
      remapPathPrefix(doc.sharepoint_text_file_path, currentFolderPath, folderPath) || `${folderPath}/documentation.txt`
    const updatedAt = new Date().toISOString()

    const attachments = await syncDocumentationAssets({
      folderPath,
      textFilePath,
      title,
      category,
      tags,
      content,
      isDraft,
      updatedAt,
      employeeName,
      files,
      existingAttachments: doc.sharepoint_attachments || [],
    })

    const remappedAttachments = attachments.map((attachment) => ({
      ...attachment,
      file_path: remapPathPrefix(attachment.file_path, currentFolderPath, folderPath) || attachment.file_path,
    }))

    const updatePayload = {
      title,
      content,
      category,
      tags,
      is_draft: isDraft,
      visibility,
      updated_at: updatedAt,
      sharepoint_folder_path: folderPath,
      sharepoint_text_file_path: textFilePath,
      sharepoint_attachments: remappedAttachments,
    }

    const { data, error } = await supabase
      .from("user_documentation")
      .update(updatePayload)
      .eq("id", doc.id)
      .eq("user_id", user.id)
      .select("*")
      .single()

    if (error) {
      throw error
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "documentation",
        entityId: doc.id,
        oldValues: {
          title: doc.title,
          category: doc.category,
          tags: doc.tags,
          is_draft: doc.is_draft,
        },
        newValues: updatePayload,
        context: { source: "api", route: `/api/documentation/internal/${doc.id}`, actorId: user.id },
      },
      { failOpen: true }
    )

    return NextResponse.json({ doc: data as UserDocumentationRow })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update documentation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const rl = await rateLimit(`documentation-delete:${getClientId(request)}`, { limit: 20, windowSec: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    const { supabase, user, doc } = await getAuthenticatedDoc(params.id)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!doc) {
      return NextResponse.json({ error: "Documentation not found" }, { status: 404 })
    }

    await deleteSharePointFolderIfExists(doc.sharepoint_folder_path)

    const { error } = await supabase.from("user_documentation").delete().eq("id", doc.id).eq("user_id", user.id)
    if (error) {
      throw error
    }

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "documentation",
        entityId: doc.id,
        oldValues: {
          title: doc.title,
          category: doc.category,
          sharepoint_folder_path: doc.sharepoint_folder_path,
        },
        context: { source: "api", route: `/api/documentation/internal/${doc.id}`, actorId: user.id },
      },
      { failOpen: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete documentation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
