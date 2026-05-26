import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { requireApiAdminScope } from "@/lib/admin/api-scope"

const log = logger("admin-site-locations-id")
export const dynamic = "force-dynamic"

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(255).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius_metres: z.number().int().min(10).max(10_000).optional(),
  is_active: z.boolean().optional(),
})

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-site-locations-id:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const auth = await requireApiAdminScope()
  if (!auth.ok) return { error: auth.response }
  return { supabase: auth.supabase }
}

/** PATCH /api/admin/hr/site-locations/[id] — update a site */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const { id } = await params
  const parsed = UpdateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { data: updated, error } = await dataClient
    .from("attendance_sites")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    log.error({ err: String(error) }, "Failed to update site")
    return NextResponse.json({ error: "Failed to update site" }, { status: 500 })
  }
  return NextResponse.json({ data: updated, message: "Site updated" })
}

/** DELETE /api/admin/hr/site-locations/[id] — soft-delete (set is_active = false) */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const { id } = await params
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  const { error } = await dataClient
    .from("attendance_sites")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) {
    log.error({ err: String(error) }, "Failed to deactivate site")
    return NextResponse.json({ error: "Failed to deactivate site" }, { status: 500 })
  }
  return NextResponse.json({ message: "Site deactivated" })
}
