import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"

const log = logger("competency-frameworks")

const CATEGORIES = ["behaviour", "leadership", "core"] as const

const CreateCompetencySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_]+$/, "Key must be lowercase letters, digits, or underscores"),
  label: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  category: z.enum(CATEGORIES).default("behaviour"),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
})

const UpdateCompetencySchema = z.object({
  id: z.string().uuid("Invalid competency ID"),
  label: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  category: z.enum(CATEGORIES).optional(),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
})

function requireAdmin(scope: AdminScope | null) {
  return scope?.isAdminLike === true && scope.scopeMode !== "lead"
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await supabase
      .from("competency_frameworks")
      .select("id, key, label, description, category, is_active, sort_order, created_at, updated_at")
      .order("sort_order")
      .order("label")

    if (error) {
      log.error({ err: String(error) }, "Error fetching competencies")
      return NextResponse.json({ error: "Failed to fetch competencies" }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/competencies")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-competencies:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role?: string | null }>()

    if (!requireAdmin(await getRequestScope())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = CreateCompetencySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data, error } = await adminSupabase.from("competency_frameworks").insert(parsed.data).select("*").single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `A competency with key "${parsed.data.key}" already exists` },
          { status: 409 }
        )
      }
      log.error({ err: String(error) }, "Error creating competency")
      return NextResponse.json({ error: "Failed to create competency" }, { status: 500 })
    }

    return NextResponse.json({ data, message: "Competency created" }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/performance/competencies")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-competencies:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role?: string | null }>()

    if (!requireAdmin(await getRequestScope())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateCompetencySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { id, ...updates } = parsed.data

    const { data, error } = await adminSupabase
      .from("competency_frameworks")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single()

    if (error) {
      log.error({ err: String(error) }, "Error updating competency")
      return NextResponse.json({ error: "Failed to update competency" }, { status: 500 })
    }

    return NextResponse.json({ data, message: "Competency updated" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/hr/performance/competencies")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-competencies:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const adminSupabase = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role?: string | null }>()

    if (!requireAdmin(await getRequestScope())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const { error } = await adminSupabase.from("competency_frameworks").delete().eq("id", id)

    if (error) {
      log.error({ err: String(error) }, "Error deleting competency")
      return NextResponse.json({ error: "Failed to delete competency" }, { status: 500 })
    }

    return NextResponse.json({ message: "Competency deleted" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/hr/performance/competencies")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
