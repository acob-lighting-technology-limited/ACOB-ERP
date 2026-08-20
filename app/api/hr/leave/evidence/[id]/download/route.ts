import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { authorizeLeaveRequestAccess, streamLeaveAttachment } from "@/lib/hr/leave-attachments"
import { logger } from "@/lib/logger"

const log = logger("hr-leave-evidence-download")

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: evidence } = await dataClient
      .from("leave_evidence")
      .select("id, leave_request_id, file_url")
      .eq("id", params.id)
      .maybeSingle<{ id: string; leave_request_id: string; file_url: string | null }>()

    if (!evidence?.leave_request_id) {
      return NextResponse.json({ error: "Evidence not found" }, { status: 404 })
    }

    const access = await authorizeLeaveRequestAccess(dataClient, user.id, evidence.leave_request_id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    return await streamLeaveAttachment(String(evidence.file_url || ""))
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/evidence/[id]/download:")
    return NextResponse.json({ error: "Failed to download evidence" }, { status: 500 })
  }
}
