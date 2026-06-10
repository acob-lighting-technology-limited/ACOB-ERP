import { NextRequest, NextResponse } from "next/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("rename-cascade")

// Only these denormalised name columns on profiles may be cascaded.
const ALLOWED_FIELDS = new Set(["office_location", "department"])

type RenameCascadeClient = Awaited<ReturnType<typeof createClient>>

/**
 * When an admin renames an office location or department in the management list,
 * the canonical row changes but every profile that stored the old name as plain
 * text keeps the stale string. This cascades the rename to those profiles so the
 * directory, scoping and AcoBot stay consistent.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`rename-cascade:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const scope = await resolveAdminScope(supabase as RenameCascadeClient, user.id)
  if (!scope?.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = (await request.json()) as { field?: string; oldName?: string; newName?: string }
  const field = String(body.field || "")
  const oldName = String(body.oldName || "").trim()
  const newName = String(body.newName || "").trim()

  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ error: "Unsupported field" }, { status: 400 })
  }
  if (!oldName || !newName || oldName === newName) {
    return NextResponse.json({ updated: 0 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase as RenameCascadeClient)
  const { data, error } = await dataClient
    .from("profiles")
    .update({ [field]: newName })
    .eq(field, oldName)
    .select("id")

  if (error) {
    log.error({ err: error.message, field }, "rename cascade failed")
    return NextResponse.json({ error: "Failed to update staff records" }, { status: 500 })
  }

  log.info({ field, oldName, newName, updated: data?.length ?? 0 }, "rename cascade applied")
  return NextResponse.json({ updated: data?.length ?? 0 })
}
