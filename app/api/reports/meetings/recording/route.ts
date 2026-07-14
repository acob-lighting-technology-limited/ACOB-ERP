import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { isGraphConfigured } from "@/lib/graph/client"
import {
  resolveGraphUserId,
  resolveOnlineMeetingId,
  listMeetingRecordings,
  getRecordingDownloadUrl,
} from "@/lib/graph/meeting-calendar"
import { logger } from "@/lib/logger"

const log = logger("api-meeting-recording")

export const dynamic = "force-dynamic"

/**
 * Meeting recording access (Way 1 — on-demand, no stored copy):
 *  - GET ?source_id=...           → list recordings for the meeting
 *  - GET ?source_id=...&download=1[&recording_id=...] → 302 to a fresh,
 *    pre-authenticated Microsoft download URL (direct download, no login)
 *
 * Requires the Azure app to hold OnlineMeetingRecording.Read.All (admin consent).
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`meeting-recording:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!isGraphConfigured()) {
    return NextResponse.json({ error: "Microsoft Graph is not configured" }, { status: 503 })
  }

  const sourceId = String(request.nextUrl.searchParams.get("source_id") || "").trim()
  const wantDownload = request.nextUrl.searchParams.get("download") === "1"
  const recordingIdParam = String(request.nextUrl.searchParams.get("recording_id") || "").trim()
  if (!sourceId) return NextResponse.json({ error: "source_id is required" }, { status: 400 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { data: source } = await db
    .from("meeting_artifact_sources")
    .select("id, label, organizer_email, join_web_url")
    .eq("id", sourceId)
    .maybeSingle()
  if (!source?.organizer_email || !source?.join_web_url) {
    return NextResponse.json({ error: "Meeting source not found" }, { status: 404 })
  }

  try {
    const [userId, meetingId] = await Promise.all([
      resolveGraphUserId(source.organizer_email),
      resolveOnlineMeetingId(source.organizer_email, source.join_web_url),
    ])
    if (!userId || !meetingId) {
      return NextResponse.json({ error: "Could not resolve the online meeting" }, { status: 404 })
    }

    const recordings = await listMeetingRecordings(userId, meetingId)
    if (recordings.length === 0) {
      return NextResponse.json({ error: "No recording is available for this meeting yet" }, { status: 404 })
    }

    if (!wantDownload) {
      return NextResponse.json({ data: recordings })
    }

    const recordingId = recordingIdParam || recordings[0].id
    const url = await getRecordingDownloadUrl(userId, meetingId, recordingId)
    if (!url) {
      return NextResponse.json(
        { error: "Recording download URL is unavailable (Graph did not return a direct link)" },
        { status: 502 }
      )
    }
    return NextResponse.redirect(url, 302)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message, sourceId }, "Failed to fetch meeting recording")
    // A 403 from Graph almost always means the recording permission isn't granted.
    const missingPermission = /403|Authorization|permission/i.test(message)
    return NextResponse.json(
      {
        error: missingPermission
          ? "Access denied by Microsoft Graph — the OnlineMeetingRecording.Read.All permission may not be granted."
          : "Failed to fetch the meeting recording",
      },
      { status: missingPermission ? 403 : 500 }
    )
  }
}
