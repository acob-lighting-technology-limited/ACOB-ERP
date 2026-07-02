import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, getDepartmentScope } from "@/lib/admin/rbac"
import { listOrganizerTeamsMeetings, isValidGraphEmail } from "@/lib/graph/meeting-calendar"
import { isGraphConfigured } from "@/lib/graph/client"
import { logger } from "@/lib/logger"

const log = logger("api-meeting-artifact-calendar")

type AdminScope = NonNullable<Awaited<ReturnType<typeof resolveAdminScope>>>

function hasGlobalReportsWriteAccess(scope: AdminScope): boolean {
  return getDepartmentScope(scope, "general") === null
}

/**
 * Powers the meeting-picker dropdown: returns the organizer's distinct Teams
 * meetings from their calendar so an admin can select a real meeting to watch.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can manage meeting sync" }, { status: 403 })
    }

    if (!isGraphConfigured()) {
      return NextResponse.json(
        { error: "Microsoft Graph is not configured on the server (AZURE_* env vars)." },
        { status: 503 }
      )
    }

    const { searchParams } = new URL(request.url)
    const organizer = String(searchParams.get("organizer") || "").trim().toLowerCase()
    if (!isValidGraphEmail(organizer)) {
      return NextResponse.json({ error: "A valid ?organizer=email is required" }, { status: 400 })
    }

    const meetings = await listOrganizerTeamsMeetings(organizer)
    return NextResponse.json({ data: meetings })
  } catch (error) {
    log.error({ err: String(error) }, "GET meeting-artifact calendar failed")
    const message = error instanceof Error ? error.message : "Failed to load meetings"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
