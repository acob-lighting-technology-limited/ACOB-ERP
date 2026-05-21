import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("admin-site-locations")
export const dynamic = "force-dynamic"

const SiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).optional().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_metres: z.number().int().min(10).max(10_000).default(150),
  is_active: z.boolean().default(true),
})

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-site-locations:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = String(profile?.role || "")
  if (!["developer", "admin", "super_admin"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { supabase }
}

/** GET /api/admin/hr/site-locations — list all sites */
export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true"
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  let query = dataClient.from("attendance_sites").select("*").order("name", { ascending: true })
  if (!includeInactive) query = query.eq("is_active", true)

  const { data, error } = await query
  if (error) {
    log.error({ err: String(error) }, "Failed to fetch sites")
    return NextResponse.json({ error: "Failed to fetch sites" }, { status: 500 })
  }
  return NextResponse.json({ data: data || [] })
}

/** POST /api/admin/hr/site-locations — create a site */
export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = SiteSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { data: created, error } = await dataClient
    .from("attendance_sites")
    .insert({ ...parsed.data })
    .select()
    .single()

  if (error) {
    log.error({ err: String(error) }, "Failed to create site")
    return NextResponse.json({ error: "Failed to create site" }, { status: 500 })
  }
  return NextResponse.json({ data: created, message: "Site created" }, { status: 201 })
}
