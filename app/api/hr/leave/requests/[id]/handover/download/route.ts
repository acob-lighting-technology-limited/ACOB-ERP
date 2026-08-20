import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { authorizeLeaveRequestAccess, streamLeaveAttachment } from "@/lib/hr/leave-attachments"
import { logger } from "@/lib/logger"

const log = logger("hr-leave-handover-download")

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const access = await authorizeLeaveRequestAccess(dataClient, user.id, params.id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const handoverUrl = String(access.request.handover_checklist_url || "")
    if (!handoverUrl) {
      return NextResponse.json({ error: "No handover document on this request" }, { status: 404 })
    }

    return await streamLeaveAttachment(handoverUrl)
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/requests/[id]/handover/download:")
    return NextResponse.json({ error: "Failed to download handover document" }, { status: 500 })
  }
}
