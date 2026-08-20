import { Buffer } from "node:buffer"
import { NextResponse } from "next/server"
import { getOneDriveService } from "@/lib/onedrive"
import { requireAccessContextV2, enforceRouteAccessV2 } from "@/lib/admin/api-guard-v2"
import { applyDataScopeV2 } from "@/lib/admin/policy-v2"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Leave attachments (evidence + handover documents) live in the SharePoint
 * document library and are recorded as their SharePoint `webUrl`. Staff do not
 * have permissions on that library, so linking the raw URL sends them to an
 * "You need access" page. These helpers stream the file back through the app
 * using the application credentials, after the caller has authorised access.
 */

function safeDispositionFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, "")
}

function fallbackFileNameFromUrl(webUrl: string): string {
  try {
    const pathname = new URL(webUrl).pathname
    const last = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "")
    return last || "leave-attachment"
  } catch {
    return "leave-attachment"
  }
}

export async function streamLeaveAttachment(webUrl: string, disposition: "attachment" | "inline" = "attachment") {
  const trimmedUrl = String(webUrl || "").trim()
  if (!trimmedUrl) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
  }

  const onedrive = getOneDriveService()
  if (!onedrive.isEnabled()) {
    return NextResponse.json({ error: "SharePoint integration is not configured" }, { status: 503 })
  }

  const item = await onedrive.getItemByWebUrl(trimmedUrl)
  const downloadUrl = item["@microsoft.graph.downloadUrl"]
  if (!downloadUrl) {
    return NextResponse.json({ error: "Attachment is not downloadable" }, { status: 502 })
  }

  const upstream = await fetch(downloadUrl)
  if (!upstream.ok) {
    return NextResponse.json({ error: "Failed to download attachment" }, { status: 502 })
  }

  const fileName = safeDispositionFilename(item.name || fallbackFileNameFromUrl(trimmedUrl))
  const mimeType = item.file?.mimeType || "application/octet-stream"

  return new NextResponse(Buffer.from(await upstream.arrayBuffer()), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  })
}

type LeaveRequestAccessRow = {
  id: string
  user_id: string | null
  reliever_id: string | null
  supervisor_id: string | null
  current_approver_user_id: string | null
  handover_checklist_url: string | null
  user: { department: string | null } | { department: string | null }[] | null
}

/**
 * Anyone directly involved in a leave request may open its attachments; anyone
 * else needs hr.leave route access, and only within their data scope.
 */
export async function authorizeLeaveRequestAccess(
  dataClient: SupabaseClient,
  userId: string,
  leaveRequestId: string
): Promise<{ ok: true; request: LeaveRequestAccessRow } | { ok: false; status: number; error: string }> {
  const { data } = await dataClient
    .from("leave_requests")
    .select(
      "id, user_id, reliever_id, supervisor_id, current_approver_user_id, handover_checklist_url, user:profiles!leave_requests_user_id_profiles_fkey(department)"
    )
    .eq("id", leaveRequestId)
    .maybeSingle<LeaveRequestAccessRow>()

  if (!data) {
    return { ok: false, status: 404, error: "Leave request not found" }
  }

  const isParticipant =
    data.user_id === userId ||
    data.reliever_id === userId ||
    data.supervisor_id === userId ||
    data.current_approver_user_id === userId

  if (isParticipant) {
    return { ok: true, request: data }
  }

  const contextResult = await requireAccessContextV2()
  if (!contextResult.ok) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.leave")
  if (!routeAccess.ok) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  const relation = data.user
  const department = (Array.isArray(relation) ? relation[0]?.department : relation?.department) || null
  const inScope = applyDataScopeV2([{ department }], routeAccess.dataScope, (row) => row.department).length > 0

  if (!inScope) {
    return { ok: false, status: 403, error: "Forbidden: outside your leave scope" }
  }

  return { ok: true, request: data }
}
