import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getEligibleLeadsForUser } from "@/lib/feedback/lead-feedback"
import { logger } from "@/lib/logger"

const log = logger("feedback-my-leads-route")

export const dynamic = "force-dynamic"

/**
 * GET /api/feedback/my-leads
 *
 * Lists the department lead(s) the caller may submit anonymous feedback about —
 * strictly the lead(s) of the caller's own department.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const leads = await getEligibleLeadsForUser(dataClient, user.id)

    return NextResponse.json({ data: leads })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to resolve eligible leads")
    return NextResponse.json({ error: "Failed to load leads" }, { status: 500 })
  }
}
