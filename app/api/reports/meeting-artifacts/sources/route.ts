import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, getDepartmentScope } from "@/lib/admin/rbac"
import { resolveOnlineMeetingId, isValidGraphEmail } from "@/lib/graph/meeting-calendar"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"

const log = logger("api-meeting-artifact-sources")

type AdminScope = NonNullable<Awaited<ReturnType<typeof resolveAdminScope>>>

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type MeetingArtifactSource = {
  id: string
  label: string
  join_web_url: string
  organizer_email: string
  recipients: string[]
  email_enabled: boolean
  is_active: boolean
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hasGlobalReportsWriteAccess(scope: AdminScope): boolean {
  return getDepartmentScope(scope, "general") === null
}

function normalizeRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const raw of value) {
    const email = String(raw || "").trim().toLowerCase()
    if (email && EMAIL_RE.test(email)) seen.add(email)
  }
  return Array.from(seen)
}

async function requireReportsAdmin(
  supabase: SupabaseClient
): Promise<{ userId: string; scope: AdminScope } | { error: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const scope = await resolveAdminScope(supabase as SupabaseClient, user.id)
  if (!scope) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  if (!hasGlobalReportsWriteAccess(scope)) {
    return { error: NextResponse.json({ error: "Only reports admins can manage meeting sync" }, { status: 403 }) }
  }
  return { userId: user.id, scope }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireReportsAdmin(supabase)
    if ("error" in auth) return auth.error

    const { data, error } = await supabase
      .from("meeting_artifact_sources")
      .select(
        "id, label, join_web_url, organizer_email, recipients, email_enabled, is_active, last_synced_at, last_error, created_at, updated_at"
      )
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: (data || []) as MeetingArtifactSource[] })
  } catch (error) {
    log.error({ err: String(error) }, "GET meeting-artifact-sources failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireReportsAdmin(supabase)
    if ("error" in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const label = String(body?.label || "").trim()
    const joinWebUrl = String(body?.joinWebUrl || "").trim()
    const organizerEmail = String(body?.organizerEmail || "").trim().toLowerCase()
    const recipients = normalizeRecipients(body?.recipients)
    const emailEnabled = body?.emailEnabled !== false
    const isActive = body?.isActive !== false

    if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 })
    if (!joinWebUrl) return NextResponse.json({ error: "joinWebUrl is required" }, { status: 400 })
    if (!isValidGraphEmail(organizerEmail)) {
      return NextResponse.json({ error: "A valid organizerEmail is required" }, { status: 400 })
    }

    // Confirm the meeting actually exists before saving.
    const onlineMeetingId = await resolveOnlineMeetingId(organizerEmail, joinWebUrl).catch((err) => {
      log.error({ err: String(err) }, "resolveOnlineMeetingId failed")
      return null
    })
    if (!onlineMeetingId) {
      return NextResponse.json(
        { error: "This meeting link could not be verified against the organizer's calendar." },
        { status: 422 }
      )
    }

    const { data, error } = await supabase
      .from("meeting_artifact_sources")
      .insert({
        label,
        join_web_url: joinWebUrl,
        organizer_email: organizerEmail,
        recipients,
        email_enabled: emailEnabled,
        is_active: isActive,
        created_by: auth.userId,
      })
      .select("id")
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "This meeting is already configured." }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await writeAuditLog(
      supabase as SupabaseClient,
      {
        action: "create",
        entityType: "mail_summary",
        entityId: data.id,
        metadata: { event: "meeting_artifact_source_created", label, organizer_email: organizerEmail },
        context: { actorId: auth.userId, source: "api", route: "/api/reports/meeting-artifacts/sources" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: { id: data.id } }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "POST meeting-artifact-sources failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireReportsAdmin(supabase)
    if ("error" in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const id = String(body?.id || "")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const patch: Record<string, unknown> = {}
    if (body?.label !== undefined) {
      const label = String(body.label || "").trim()
      if (!label) return NextResponse.json({ error: "label cannot be empty" }, { status: 400 })
      patch.label = label
    }
    if (body?.recipients !== undefined) patch.recipients = normalizeRecipients(body.recipients)
    if (body?.emailEnabled !== undefined) patch.email_enabled = Boolean(body.emailEnabled)
    if (body?.isActive !== undefined) patch.is_active = Boolean(body.isActive)

    // Changing the watched meeting re-validates against Graph.
    if (body?.joinWebUrl !== undefined || body?.organizerEmail !== undefined) {
      const { data: existing } = await supabase
        .from("meeting_artifact_sources")
        .select("join_web_url, organizer_email")
        .eq("id", id)
        .single()
      const joinWebUrl = String(body?.joinWebUrl ?? existing?.join_web_url ?? "").trim()
      const organizerEmail = String(body?.organizerEmail ?? existing?.organizer_email ?? "")
        .trim()
        .toLowerCase()
      if (!joinWebUrl || !isValidGraphEmail(organizerEmail)) {
        return NextResponse.json({ error: "Valid joinWebUrl and organizerEmail are required" }, { status: 400 })
      }
      const onlineMeetingId = await resolveOnlineMeetingId(organizerEmail, joinWebUrl).catch(() => null)
      if (!onlineMeetingId) {
        return NextResponse.json(
          { error: "This meeting link could not be verified against the organizer's calendar." },
          { status: 422 }
        )
      }
      patch.join_web_url = joinWebUrl
      patch.organizer_email = organizerEmail
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("meeting_artifact_sources")
      .update(patch)
      .eq("id", id)
      .select("id")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase as SupabaseClient,
      {
        action: "update",
        entityType: "mail_summary",
        entityId: id,
        metadata: { event: "meeting_artifact_source_updated", patch: Object.keys(patch) },
        context: { actorId: auth.userId, source: "api", route: "/api/reports/meeting-artifacts/sources" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: { id: data.id } })
  } catch (error) {
    log.error({ err: String(error) }, "PATCH meeting-artifact-sources failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireReportsAdmin(supabase)
    if ("error" in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get("id") || "")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const { error } = await supabase.from("meeting_artifact_sources").delete().eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase as SupabaseClient,
      {
        action: "delete",
        entityType: "mail_summary",
        entityId: id,
        metadata: { event: "meeting_artifact_source_deleted" },
        context: { actorId: auth.userId, source: "api", route: "/api/reports/meeting-artifacts/sources" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "DELETE meeting-artifact-sources failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
