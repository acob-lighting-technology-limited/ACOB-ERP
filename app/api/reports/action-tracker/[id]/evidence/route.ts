import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { canUpdateActionProgress, type ActionTrackerScopeProfile } from "@/lib/reports/action-tracker-permissions"

const log = logger("action-tracker-evidence-route")
export const dynamic = "force-dynamic"

const BUCKET = "action_item_evidence"
// Video is the reason this ceiling is higher than the 10MB used for ticket
// attachments — a short clip of a site condition runs well past that.
const MAX_FILE_BYTES = 50 * 1024 * 1024
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
])

const EVIDENCE_COLUMNS =
  "id, action_item_id, file_name, file_path, mime_type, file_size, caption, uploaded_by, created_at"

function sanitizeName(name: string): string {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_")
}

/**
 * Evidence attached to an action item's hindrance note. Reads are org-wide, the
 * same as the tracker itself, so this uses the caller's own client.
 */
export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await supabase
      .from("action_item_evidence")
      .select(EVIDENCE_COLUMNS)
      .eq("action_item_id", params.id)
      .order("created_at", { ascending: false })

    if (error) throw error

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const withUrls = await Promise.all(
      (data || []).map(async (row) => {
        const { data: signed } = await dataClient.storage.from(BUCKET).createSignedUrl(row.file_path, 3600)
        return { ...row, signed_url: signed?.signedUrl ?? null }
      })
    )

    return NextResponse.json({ data: withUrls })
  } catch (error) {
    log.error({ err: String(error) }, "GET action item evidence failed")
    return NextResponse.json({ error: "Failed to load evidence" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`action-tracker-evidence:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [{ data: profile }, { data: item }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ActionTrackerScopeProfile>(),
      supabase
        .from("action_items")
        .select("id, title, department, origin")
        .eq("id", params.id)
        .maybeSingle<{ id: string; title: string | null; department: string | null; origin: string | null }>(),
    ])

    if (!item) return NextResponse.json({ error: "Action item not found" }, { status: 404 })

    // Evidence hangs off the hindrance note, so it follows the same rule: a
    // directive with named staff belongs to those staff, not to the department.
    let assigneeIds: string[] = []
    if (String(item.origin) === "management_directive") {
      const { data: assignees } = await supabase
        .from("action_item_assignees")
        .select("profile_id")
        .eq("action_item_id", params.id)
        .returns<{ profile_id: string }[]>()
      assigneeIds = (assignees || []).map((row) => String(row.profile_id))
    }

    if (!canUpdateActionProgress(profile ?? null, { department: item.department, origin: item.origin, assigneeIds })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File)
    const caption = String(formData.get("caption") || "").trim() || null

    if (files.length === 0) {
      return NextResponse.json({ error: "Attach at least one file" }, { status: 400 })
    }

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 50MB` }, { status: 400 })
      }
      if (file.type && !ALLOWED_MIME.has(file.type)) {
        return NextResponse.json(
          { error: `${file.name} is not an accepted file type. Attach an image, a video or a PDF.` },
          { status: 400 }
        )
      }
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const created: unknown[] = []

    for (const file of files) {
      const filePath = `${params.id}/${Date.now()}_${sanitizeName(file.name)}`
      const { error: uploadError } = await dataClient.storage
        .from(BUCKET)
        .upload(filePath, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined })

      if (uploadError) {
        return NextResponse.json({ error: `Upload failed for ${file.name}` }, { status: 500 })
      }

      const { data: row, error: insertError } = await dataClient
        .from("action_item_evidence")
        .insert({
          action_item_id: params.id,
          file_name: file.name,
          file_path: filePath,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
          caption,
          uploaded_by: user.id,
        })
        .select(EVIDENCE_COLUMNS)
        .single()

      if (insertError || !row) {
        // Do not leave an orphaned object behind if the row fails to write.
        await dataClient.storage.from(BUCKET).remove([filePath])
        return NextResponse.json({ error: `Failed to record ${file.name}` }, { status: 500 })
      }

      created.push(row)
    }

    await writeAuditLog(
      supabase,
      {
        action: "action_item.evidence_upload",
        entityType: "action_item",
        entityId: params.id,
        newValues: { title: item.title, department: item.department, count: created.length },
        context: { actorId: user.id, source: "api", route: "/api/reports/action-tracker/[id]/evidence" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "POST action item evidence failed")
    return NextResponse.json({ error: "Failed to attach the evidence" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const evidenceId = request.nextUrl.searchParams.get("evidence_id")
    if (!evidenceId) return NextResponse.json({ error: "evidence_id is required" }, { status: 400 })

    const [{ data: profile }, { data: existing }] = await Promise.all([
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ActionTrackerScopeProfile>(),
      supabase
        .from("action_item_evidence")
        .select("id, file_path, uploaded_by")
        .eq("id", evidenceId)
        .eq("action_item_id", params.id)
        .maybeSingle<{ id: string; file_path: string; uploaded_by: string }>(),
    ])

    if (!existing) return NextResponse.json({ error: "Evidence not found" }, { status: 404 })

    const role = String(profile?.role || "").toLowerCase()
    const isAdmin = ["developer", "super_admin", "admin"].includes(role)
    if (existing.uploaded_by !== user.id && !isAdmin) {
      return NextResponse.json({ error: "You can only remove evidence you uploaded" }, { status: 403 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    await dataClient.storage.from(BUCKET).remove([existing.file_path])

    const { error } = await dataClient.from("action_item_evidence").delete().eq("id", evidenceId)
    if (error) throw error

    await writeAuditLog(
      supabase,
      {
        action: "action_item.evidence_delete",
        entityType: "action_item",
        entityId: params.id,
        oldValues: { evidence_id: evidenceId, file_path: existing.file_path },
        context: { actorId: user.id, source: "api", route: "/api/reports/action-tracker/[id]/evidence" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "DELETE action item evidence failed")
    return NextResponse.json({ error: "Failed to remove the evidence" }, { status: 500 })
  }
}
