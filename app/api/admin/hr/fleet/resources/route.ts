import { NextRequest, NextResponse } from "next/server"
import { canManageFleet } from "@/lib/fleet-booking"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type FleetResourcePatch = Record<string, string | boolean | null>

const CreateFleetResourceSchema = z.object({
  name: z.string().trim().min(2, "Resource name must be at least 2 characters"),
  resource_type: z.string().trim().optional().default("general"),
  description: z.string().optional(),
})

const UpdateFleetResourceSchema = z.object({
  id: z.string().trim().min(1, "Resource id is required"),
  name: z.string().optional(),
  resource_type: z.string().optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const allowed = await canManageFleet(supabase, user.id)
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data, error } = await dataClient
      .from("fleet_resources")
      .select("id, name, resource_type, description, is_active, created_at, updated_at")
      .order("name")

    if (error) return NextResponse.json({ error: error.message || "Failed to load resources" }, { status: 500 })

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-fleet-resources:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const allowed = await canManageFleet(supabase, user.id)
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json()
    const parsed = CreateFleetResourceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const name = parsed.data.name
    const resourceType = parsed.data.resource_type.trim() || "general"
    const description = String(parsed.data.description || "").trim() || null

    const { data, error } = await dataClient
      .from("fleet_resources")
      .insert({
        name,
        resource_type: resourceType,
        description,
        is_active: true,
        created_by: user.id,
      })
      .select("id, name, resource_type, description, is_active, created_at, updated_at")
      .single()

    if (error) {
      const status = String(error.message || "")
        .toLowerCase()
        .includes("unique")
        ? 409
        : 500
      return NextResponse.json({ error: error.message || "Failed to create resource" }, { status })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "fleet_resource",
        entityId: data.id,
        newValues: { name, resource_type: resourceType },
        context: { actorId: user.id, source: "api", route: "/api/admin/hr/fleet/resources" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-fleet-resources:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const allowed = await canManageFleet(supabase, user.id)
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json()
    const parsed = UpdateFleetResourceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const id = parsed.data.id

    const patch: FleetResourcePatch = {}
    if (parsed.data.name !== undefined) {
      const name = String(parsed.data.name || "").trim()
      if (name.length < 2) return NextResponse.json({ error: "Invalid resource name" }, { status: 400 })
      patch.name = name
    }
    if (parsed.data.resource_type !== undefined) {
      patch.resource_type = String(parsed.data.resource_type || "general").trim() || "general"
    }
    if (parsed.data.description !== undefined) {
      const desc = String(parsed.data.description || "").trim()
      patch.description = desc || null
    }
    if (parsed.data.is_active !== undefined) {
      patch.is_active = Boolean(parsed.data.is_active)
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 })
    }

    const { data, error } = await dataClient
      .from("fleet_resources")
      .update(patch)
      .eq("id", id)
      .select("id, name, resource_type, description, is_active, created_at, updated_at")
      .single()

    if (error) return NextResponse.json({ error: error.message || "Failed to update resource" }, { status: 500 })

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "fleet_resource",
        entityId: id,
        newValues: patch,
        context: { actorId: user.id, source: "api", route: "/api/admin/hr/fleet/resources" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
