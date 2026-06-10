/**
 * OneDrive API Routes
 * Handles folder listing and file upload operations
 */

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getOneDriveService } from "@/lib/onedrive"
import { writeAuditLog } from "@/lib/audit/write-audit"
import {
  getDepartmentContextFromPath,
  isPathAllowed,
  resolveOneDriveAccessScope,
  resolveOneDriveDepartmentAccessScope,
} from "@/lib/onedrive/access"
import { logger } from "@/lib/logger"
import type { FileItem } from "@/lib/onedrive/types"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("onedrive")

export const dynamic = "force-dynamic"

type OneDriveClient = Awaited<ReturnType<typeof createClient>>
interface ActorProfile {
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_email: string | null
}

interface DepartmentDocumentMetadataRow {
  item_id: string
  current_path: string
  created_by_name: string | null
  created_by_email: string | null
  created_at: string
  last_modified_by_name: string | null
  last_modified_by_email: string | null
  last_modified_at: string
}

type RequestContext =
  | { response: NextResponse }
  | {
      supabase: OneDriveClient
      userId: string
      scope: NonNullable<Awaited<ReturnType<typeof resolveOneDriveAccessScope>>>
      onedrive: ReturnType<typeof getOneDriveService>
    }

// Helper function to create Supabase client for auth check
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
          // Ignore
        }
      },
    },
  })
}

function normalizePath(path: string): string {
  const normalized = `/${path || ""}`.replace(/\/+/g, "/")
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

function getAccessOptions(accessMode: string | null) {
  return accessMode === "admin"
    ? { allowAdminLike: true, allowManagedDepartments: true }
    : { allowAdminLike: false, allowManagedDepartments: false }
}

function isValidItemName(name: string): boolean {
  return !!name.trim() && !/[\\/]/.test(name)
}

function getPathDepth(path: string): number {
  return normalizePath(path).split("/").filter(Boolean).length
}

function buildActorName(profile: ActorProfile | null): string {
  if (!profile) return "Unknown user"

  const fullName = profile.full_name?.trim()
  if (fullName) return fullName

  const fallbackName = [profile.first_name?.trim(), profile.last_name?.trim()].filter(Boolean).join(" ")
  return fallbackName || profile.company_email?.trim() || "Unknown user"
}

async function getActorProfile(supabase: OneDriveClient, userId: string): Promise<ActorProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, first_name, last_name, company_email")
    .eq("id", userId)
    .single<ActorProfile>()

  return data ?? null
}

async function loadMetadataMap(
  supabase: OneDriveClient,
  files: FileItem[]
): Promise<Map<string, DepartmentDocumentMetadataRow>> {
  const itemIds = Array.from(new Set(files.map((file) => file.id).filter(Boolean)))
  if (itemIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from("department_document_metadata")
    .select(
      "item_id, current_path, created_by_name, created_by_email, created_at, last_modified_by_name, last_modified_by_email, last_modified_at"
    )
    .in("item_id", itemIds)

  if (error) {
    log.error({ err: error.message }, "Failed to load department document metadata")
    return new Map()
  }

  const rows = (data ?? []) as DepartmentDocumentMetadataRow[]
  return new Map(rows.map((row) => [row.item_id, row]))
}

async function recordDepartmentDocumentMetadata(
  supabase: OneDriveClient,
  item: FileItem,
  actorProfile: ActorProfile | null,
  actorUserId: string,
  action: "create" | "update"
): Promise<void> {
  const departmentContext = getDepartmentContextFromPath(item.path)
  if (!departmentContext) return

  const actorName = buildActorName(actorProfile)
  const actorEmail = actorProfile?.company_email?.trim() || null

  const { data: existingData, error: existingError } = await supabase
    .from("department_document_metadata")
    .select("created_by_user_id, created_by_name, created_by_email, created_at")
    .eq("item_id", item.id)
    .maybeSingle()

  if (existingError) {
    log.error({ err: existingError.message, itemId: item.id }, "Failed to read existing department document metadata")
  }

  const existing = (existingData ?? null) as {
    created_by_user_id: string | null
    created_by_name: string | null
    created_by_email: string | null
    created_at: string | null
  } | null

  const payload = {
    item_id: item.id,
    department_name: departmentContext.departmentName,
    department_key: departmentContext.departmentKey,
    current_path: item.path,
    item_name: item.name,
    is_folder: item.isFolder,
    created_by_user_id: existing?.created_by_user_id ?? actorUserId,
    created_by_name: existing?.created_by_name ?? actorName,
    created_by_email: existing?.created_by_email ?? actorEmail,
    created_at: existing?.created_at ?? item.createdAt ?? new Date().toISOString(),
    last_modified_by_user_id: action === "update" ? actorUserId : null,
    last_modified_by_name: action === "update" ? actorName : null,
    last_modified_by_email: action === "update" ? actorEmail : null,
    last_modified_at:
      action === "update"
        ? new Date().toISOString()
        : (existing?.created_at ?? item.createdAt ?? new Date().toISOString()),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from("department_document_metadata").upsert(payload, { onConflict: "item_id" })

  if (error) {
    log.error({ err: error.message, itemId: item.id }, "Failed to upsert department document metadata")
  }
}

async function deleteDepartmentDocumentMetadata(
  supabase: OneDriveClient,
  args: { itemId?: string; path?: string }
): Promise<void> {
  const itemId = args.itemId?.trim()
  const path = args.path?.trim()
  if (!itemId && !path) return

  let query = supabase.from("department_document_metadata").delete()
  query = itemId ? query.eq("item_id", itemId) : query.eq("current_path", path!)
  const { error } = await query

  if (error) {
    log.error({ err: error.message, itemId, path }, "Failed to delete department document metadata")
  }
}

async function writeDepartmentDocumentAudit(
  supabase: OneDriveClient,
  payload: {
    action: "create" | "update" | "delete"
    item: Pick<FileItem, "id" | "name" | "path" | "isFolder">
    actorUserId: string
  }
): Promise<void> {
  const departmentContext = getDepartmentContextFromPath(payload.item.path)
  await writeAuditLog(
    supabase,
    {
      action: payload.action,
      entityType: "department_document",
      entityId: payload.item.id,
      metadata: {
        path: payload.item.path,
        item_name: payload.item.name,
        is_folder: payload.item.isFolder,
      },
      context: {
        source: "api",
        route: "/api/onedrive",
        actorId: payload.actorUserId,
        department: departmentContext?.departmentName ?? null,
      },
    },
    { failOpen: true }
  )
}

async function getRequestContext(
  accessMode: string | null,
  requireWrite = false,
  department: string | null = null
): Promise<RequestContext> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  if (requireWrite && accessMode !== "admin") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  const scope = department
    ? await resolveOneDriveDepartmentAccessScope(supabase as OneDriveClient, user.id, department)
    : await resolveOneDriveAccessScope(supabase as OneDriveClient, user.id, getAccessOptions(accessMode))
  if (!scope) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) {
    return { response: NextResponse.json({ error: "OneDrive integration is not configured" }, { status: 503 }) }
  }

  return { supabase: supabase as OneDriveClient, userId: user.id, scope, onedrive }
}

/**
 * GET /api/onedrive
 * List folder contents from OneDrive
 * Query params:
 *   - path: Folder path to list (default: /)
 *   - search: Optional search query
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const context = await getRequestContext(searchParams.get("accessMode"), false, searchParams.get("department"))
    if ("response" in context) {
      return context.response
    }

    const requestedPath = searchParams.get("path") || "/"
    const search = searchParams.get("search")
    const path = normalizePath(requestedPath)

    if (!isPathAllowed(path, context.scope)) {
      return NextResponse.json({ error: "Forbidden: outside your allowed department libraries" }, { status: 403 })
    }

    let files

    if (search) {
      // Search for files
      files = await context.onedrive.searchFiles(search, path !== "/" ? path : undefined)
    } else {
      // List folder contents
      files = await context.onedrive.listFolder(path)
    }

    if (!context.scope.isAdminLike) {
      files = files.filter((file) => {
        const candidatePath = normalizePath(`${path}/${file.name}`)
        return isPathAllowed(candidatePath, context.scope)
      })
    }

    const metadataByItemId = await loadMetadataMap(context.supabase, files)
    files = files.map((file) => {
      const metadata = metadataByItemId.get(file.id)
      if (!metadata) return file

      return {
        ...file,
        createdBy: metadata.created_by_name || metadata.created_by_email || file.createdBy,
        lastModifiedBy:
          metadata.last_modified_at !== metadata.created_at
            ? metadata.last_modified_by_name || metadata.last_modified_by_email || file.lastModifiedBy
            : undefined,
      }
    })

    // Sort: folders first, then by name
    files.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({
      data: files,
      path,
      parentPath: path === "/" ? null : path.substring(0, path.lastIndexOf("/")) || "/",
    })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error listing OneDrive folder:")
    const message = error instanceof Error ? error.message : "Failed to list folder"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/onedrive
 * Upload a file to OneDrive
 * Body: FormData with:
 *   - action: "upload" or "create-folder"
 *   - path: Destination folder path
 *   - accessMode: Must be "admin" for writes
 *   - file: The file to upload
 *   - fileName: Optional custom filename
 *   - name: New folder name
 */
export async function POST(request: Request) {
  const rl = await rateLimit(`onedrive:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const formData = await request.formData()
    const accessMode = typeof formData.get("accessMode") === "string" ? String(formData.get("accessMode")) : null
    const department = typeof formData.get("department") === "string" ? String(formData.get("department")) : null
    const context = await getRequestContext(accessMode, true, department)
    if ("response" in context) {
      return context.response
    }

    const action = typeof formData.get("action") === "string" ? String(formData.get("action")) : ""
    const path = normalizePath(typeof formData.get("path") === "string" ? String(formData.get("path")) : "/")

    if (path === "/" || !isPathAllowed(path, context.scope)) {
      return NextResponse.json({ error: "Select a department library before making changes" }, { status: 403 })
    }

    if (action === "create-folder") {
      const actorProfile = await getActorProfile(context.supabase, context.userId)
      const name = typeof formData.get("name") === "string" ? String(formData.get("name")).trim() : ""
      if (!isValidItemName(name)) {
        return NextResponse.json({ error: "Folder name is invalid" }, { status: 400 })
      }

      const folderPath = normalizePath(`${path}/${name}`)
      if (!isPathAllowed(folderPath, context.scope)) {
        return NextResponse.json({ error: "Forbidden: outside your allowed department libraries" }, { status: 403 })
      }

      await context.onedrive.createFolder(folderPath)
      const created = await context.onedrive.getItem(folderPath)
      await recordDepartmentDocumentMetadata(context.supabase, created, actorProfile, context.userId, "create")
      await writeDepartmentDocumentAudit(context.supabase, {
        action: "create",
        item: created,
        actorUserId: context.userId,
      })
      return NextResponse.json({ data: created, message: "Folder created" })
    }

    if (action === "upload") {
      const actorProfile = await getActorProfile(context.supabase, context.userId)
      const file = formData.get("file")
      const customName = typeof formData.get("fileName") === "string" ? String(formData.get("fileName")).trim() : ""
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "A file is required" }, { status: 400 })
      }

      const fileName = customName || file.name
      if (!isValidItemName(fileName)) {
        return NextResponse.json({ error: "File name is invalid" }, { status: 400 })
      }

      const uploadPath = normalizePath(`${path}/${fileName}`)
      if (!isPathAllowed(uploadPath, context.scope)) {
        return NextResponse.json({ error: "Forbidden: outside your allowed department libraries" }, { status: 403 })
      }

      const content = await file.arrayBuffer()
      await context.onedrive.uploadFile(uploadPath, content, file.type || undefined)
      const uploaded = await context.onedrive.getItem(uploadPath)
      await recordDepartmentDocumentMetadata(context.supabase, uploaded, actorProfile, context.userId, "create")
      await writeDepartmentDocumentAudit(context.supabase, {
        action: "create",
        item: uploaded,
        actorUserId: context.userId,
      })
      return NextResponse.json({ data: uploaded, message: "File uploaded" })
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error writing to OneDrive:")
    const message = error instanceof Error ? error.message : "Failed to update folder"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const rl = await rateLimit(`onedrive:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const body = (await request.json()) as { path?: string; newName?: string; accessMode?: string; department?: string }
    const context = await getRequestContext(body.accessMode ?? null, true, body.department ?? null)
    if ("response" in context) {
      return context.response
    }

    const path = normalizePath(body.path || "/")
    const newName = body.newName?.trim() || ""
    const parentPath = path.substring(0, path.lastIndexOf("/")) || "/"
    const nextPath = normalizePath(`${parentPath}/${newName}`)
    const actorProfile = await getActorProfile(context.supabase, context.userId)

    if (getPathDepth(path) < 2) {
      return NextResponse.json({ error: "Department libraries cannot be renamed in this app" }, { status: 403 })
    }

    if (!isValidItemName(newName)) {
      return NextResponse.json({ error: "Name is invalid" }, { status: 400 })
    }

    if (!isPathAllowed(path, context.scope) || !isPathAllowed(nextPath, context.scope)) {
      return NextResponse.json({ error: "Forbidden: outside your allowed department libraries" }, { status: 403 })
    }

    await context.onedrive.renameItem(path, newName)
    const renamed = await context.onedrive.getItem(nextPath)
    await recordDepartmentDocumentMetadata(context.supabase, renamed, actorProfile, context.userId, "update")
    await writeDepartmentDocumentAudit(context.supabase, {
      action: "update",
      item: renamed,
      actorUserId: context.userId,
    })
    return NextResponse.json({ data: renamed, message: "Item renamed" })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error renaming OneDrive item:")
    const message = error instanceof Error ? error.message : "Failed to rename item"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const rl = await rateLimit(`onedrive:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { searchParams } = new URL(request.url)
    const context = await getRequestContext(searchParams.get("accessMode"), true, searchParams.get("department"))
    if ("response" in context) {
      return context.response
    }

    const path = normalizePath(searchParams.get("path") || "/")
    if (getPathDepth(path) < 2) {
      return NextResponse.json({ error: "Department libraries cannot be deleted in this app" }, { status: 403 })
    }

    if (!isPathAllowed(path, context.scope)) {
      return NextResponse.json({ error: "Forbidden: outside your allowed department libraries" }, { status: 403 })
    }

    const existing = await context.onedrive.getItem(path)
    await context.onedrive.deleteItem(path)
    await deleteDepartmentDocumentMetadata(context.supabase, { itemId: existing.id, path })
    await writeDepartmentDocumentAudit(context.supabase, {
      action: "delete",
      item: existing,
      actorUserId: context.userId,
    })
    return NextResponse.json({ message: "Item deleted" })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error deleting OneDrive item:")
    const message = error instanceof Error ? error.message : "Failed to delete item"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
