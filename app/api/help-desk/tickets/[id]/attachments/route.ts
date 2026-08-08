import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"

const log = logger("api-help-desk-attachments")
export const dynamic = "force-dynamic"

const BUCKET = "help_desk_documents"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

const ATTACHMENT_COLUMNS = "id, ticket_id, file_name, file_path, mime_type, file_size, uploaded_by, created_at"

function sanitizeName(name: string): string {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_")
}

/**
 * Attachments on a ticket. RLS scopes reads to the ticket's audience — the
 * requester, the assignee and the leads of either department — so this uses the
 * caller's own client rather than the service role.
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
      .from("help_desk_attachments")
      .select(ATTACHMENT_COLUMNS)
      .eq("ticket_id", params.id)
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
    log.error({ err: String(error) }, "GET help desk attachments failed")
    return NextResponse.json({ error: "Failed to load attachments" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`help-desk-attachments:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Reading the ticket through the caller's client applies the ticket's own
    // RLS, so a user who cannot see it cannot attach to it either.
    const { data: ticket } = await supabase
      .from("help_desk_tickets")
      .select("id, ticket_number")
      .eq("id", params.id)
      .maybeSingle<{ id: string; ticket_number: string | null }>()

    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    const formData = await request.formData()
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File)

    if (files.length === 0) {
      return NextResponse.json({ error: "Attach at least one file" }, { status: 400 })
    }

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 10MB` }, { status: 400 })
      }
      if (file.type && !ALLOWED_MIME.has(file.type)) {
        return NextResponse.json({ error: `${file.name} is not an accepted file type` }, { status: 400 })
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
        .from("help_desk_attachments")
        .insert({
          ticket_id: params.id,
          file_name: file.name,
          file_path: filePath,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
          uploaded_by: user.id,
        })
        .select(ATTACHMENT_COLUMNS)
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
        action: "create",
        entityType: "help_desk_attachment",
        entityId: params.id,
        newValues: { ticket_number: ticket.ticket_number, count: created.length },
        context: { actorId: user.id, source: "api", route: "/api/help-desk/tickets/[id]/attachments" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "POST help desk attachment failed")
    return NextResponse.json({ error: "Failed to attach the file" }, { status: 500 })
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

    const attachmentId = request.nextUrl.searchParams.get("attachment_id")
    if (!attachmentId) return NextResponse.json({ error: "attachment_id is required" }, { status: 400 })

    const { data: existing } = await supabase
      .from("help_desk_attachments")
      .select("id, file_path, uploaded_by")
      .eq("id", attachmentId)
      .eq("ticket_id", params.id)
      .maybeSingle<{ id: string; file_path: string; uploaded_by: string }>()

    if (!existing) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
    if (existing.uploaded_by !== user.id) {
      return NextResponse.json({ error: "You can only remove files you uploaded" }, { status: 403 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    await dataClient.storage.from(BUCKET).remove([existing.file_path])

    const { error } = await dataClient.from("help_desk_attachments").delete().eq("id", attachmentId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "DELETE help desk attachment failed")
    return NextResponse.json({ error: "Failed to remove the attachment" }, { status: 500 })
  }
}
