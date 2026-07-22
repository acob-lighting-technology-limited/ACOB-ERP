import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { isGraphConfigured } from "@/lib/graph/client"
import {
  resolveGraphUserId,
  resolveOnlineMeetingId,
  listMeetingRecordings,
  fetchRecordingContent,
} from "@/lib/graph/meeting-calendar"
import { logger } from "@/lib/logger"

const log = logger("api-meeting-recording")

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Recordings can be large; allow a long streaming window.
export const maxDuration = 300

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
    // Forward the client's Range so downloads can resume. When the client sends no
    // Range, still request "bytes=0-" so Graph replies 206 with the total size —
    // that's what lets the browser show a real file size instead of "Unknown".
    const clientRange = request.headers.get("range")
    const upstream = await fetchRecordingContent(userId, meetingId, recordingId, clientRange || "bytes=0-")
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "")
      log.error({ status: upstream.status, sourceId }, "Recording content fetch failed")
      const denied = upstream.status === 401 || upstream.status === 403
      return NextResponse.json(
        {
          error: denied
            ? "Access denied by Microsoft Graph — the OnlineMeetingRecording.Read.All permission may not be granted."
            : `Could not fetch the recording (${upstream.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        },
        { status: denied ? 403 : 502 }
      )
    }

    const dateLabel = recordings[0].createdDateTime?.slice(0, 10) || "recording"
    const safeLabel = source.label.replace(/[^a-zA-Z0-9._-]+/g, "_")
    const filename = `${safeLabel}-recording-${dateLabel}.mp4`
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    }
    const contentLength = upstream.headers.get("content-length")
    const contentRange = upstream.headers.get("content-range")
    if (contentLength) headers["Content-Length"] = contentLength
    // Only surface a partial (206) response when the CLIENT actually asked for a
    // range. When we forced "bytes=0-" ourselves, return a normal 200 full-file
    // download that still carries the real Content-Length.
    if (clientRange && contentRange) {
      headers["Content-Range"] = contentRange
      return new NextResponse(upstream.body, { status: 206, headers })
    }
    return new NextResponse(upstream.body, { status: 200, headers })
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
