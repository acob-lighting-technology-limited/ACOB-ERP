import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

interface CreateAssetTypePayload {
  label?: string
  code?: string
  requiresSerialModel?: boolean
}

const CreateAssetTypeSchema = z.object({
  label: z.string().trim().min(1, "Both label and code are required"),
  code: z.string().trim().min(1, "Both label and code are required"),
  requiresSerialModel: z.boolean().optional().default(false),
})

type AdminAssetTypesClient = Awaited<ReturnType<typeof createClient>>

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase as AdminAssetTypesClient, user.id)
  if (!scope || !canAccessAdminSection(scope, "assets")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase as AdminAssetTypesClient)
  let { data, error } = await dataClient
    .from("asset_types")
    .select("id, label, code, requires_serial_model")
    .order("label", {
      ascending: true,
    })

  if (error && dataClient !== supabase) {
    const fallback = await supabase
      .from("asset_types")
      .select("id, label, code, requires_serial_model")
      .order("label", { ascending: true })
    data = fallback.data
    error = fallback.error
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-assets-types:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase as AdminAssetTypesClient, user.id)
  if (!scope || !scope.isAdminLike || !canAccessAdminSection(scope, "assets")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const payload = (await request.json().catch(() => null)) as CreateAssetTypePayload | null
  const parsed = CreateAssetTypeSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
  }

  const label = parsed.data.label
  const code = parsed.data.code.trim().toUpperCase().replace(/\s+/g, "")
  const requiresSerialModel = parsed.data.requiresSerialModel

  const dataClient = getServiceRoleClientOrFallback(supabase as AdminAssetTypesClient)
  const { data, error } = await dataClient
    .from("asset_types")
    .insert({
      label,
      code,
      requires_serial_model: requiresSerialModel,
      created_by: user.id,
    })
    .select("id, label, code, requires_serial_model")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Asset type already exists", code: error.code }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await writeAuditLog(
    supabase,
    {
      action: "create",
      entityType: "asset_type",
      entityId: data.id,
      newValues: { label, code, requires_serial_model: requiresSerialModel },
      context: { actorId: user.id, source: "api", route: "/api/admin/assets/types" },
    },
    { failOpen: true }
  )

  return NextResponse.json({ data }, { status: 201 })
}
