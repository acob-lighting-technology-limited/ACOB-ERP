import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"

const log = logger("hr-performance-cycles")
export const dynamic = "force-dynamic"

const CYCLE_STATUSES = ["planned", "active", "closed", "locked"] as const
type CycleStatus = (typeof CYCLE_STATUSES)[number]

const CreateCycleSchema = z
  .object({
    name: z.string().trim().min(1, "Cycle name is required").max(200),
    review_type: z.string().trim().min(1, "Review type is required"),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "end_date must be YYYY-MM-DD"),
    status: z.enum(CYCLE_STATUSES).default("planned"),
  })
  .refine((data) => data.start_date < data.end_date, {
    message: "end_date must be after start_date",
    path: ["end_date"],
  })

const UpdateCycleSchema = z.object({
  id: z.string().uuid("Invalid cycle ID"),
  name: z.string().trim().min(1).max(200).optional(),
  review_type: z.string().trim().min(1).optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(CYCLE_STATUSES).optional(),
})

function requireAdmin(scope: AdminScope | null) {
  return scope?.isAdminLike === true && scope.scopeMode !== "lead"
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: cycles, error } = await supabase
      .from("review_cycles")
      .select("*")
      .order("start_date", { ascending: false })

    if (error) {
      log.error({ err: String(error) }, "Error fetching review cycles")
      return NextResponse.json({ error: "Failed to fetch review cycles" }, { status: 500 })
    }

    return NextResponse.json({ data: cycles })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/performance/cycles")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cycles:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
      return NextResponse.json({ error: "Forbidden — only admins can create review cycles" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = CreateCycleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    // Prevent overlapping active cycles
    if (parsed.data.status === "active") {
      const { data: existingActive } = await adminSupabase
        .from("review_cycles")
        .select("id, name")
        .eq("status", "active")
        .limit(1)
        .maybeSingle()
      if (existingActive) {
        return NextResponse.json(
          { error: `There is already an active cycle: "${existingActive.name}". Close it before activating another.` },
          { status: 400 }
        )
      }
    }

    const { data: cycle, error } = await adminSupabase
      .from("review_cycles")
      .insert({
        ...parsed.data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single()

    if (error || !cycle) {
      log.error({ err: String(error) }, "Error creating review cycle")
      return NextResponse.json({ error: "Failed to create review cycle" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "review_cycle",
        entityId: cycle.id,
        newValues: parsed.data,
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cycles" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: cycle, message: "Review cycle created successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/performance/cycles")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cycles:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
      return NextResponse.json({ error: "Forbidden — only admins can update review cycles" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateCycleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { id, ...updates } = parsed.data

    // Locked cycles cannot be modified
    const { data: existing } = await adminSupabase
      .from("review_cycles")
      .select("id, status, name")
      .eq("id", id)
      .maybeSingle<{ id: string; status: CycleStatus | null; name: string }>()

    if (!existing) return NextResponse.json({ error: "Cycle not found" }, { status: 404 })
    if (existing.status === "locked") {
      return NextResponse.json({ error: "Locked cycles cannot be modified" }, { status: 400 })
    }

    // Prevent two active cycles
    if (updates.status === "active") {
      const { data: existingActive } = await adminSupabase
        .from("review_cycles")
        .select("id, name")
        .eq("status", "active")
        .neq("id", id)
        .limit(1)
        .maybeSingle()
      if (existingActive) {
        return NextResponse.json(
          { error: `"${existingActive.name}" is already active. Close it first.` },
          { status: 400 }
        )
      }
    }

    const { data: cycle, error } = await adminSupabase
      .from("review_cycles")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single()

    if (error || !cycle) {
      log.error({ err: String(error) }, "Error updating review cycle")
      return NextResponse.json({ error: "Failed to update review cycle" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "review_cycle",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: updates,
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cycles" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: cycle, message: "Review cycle updated" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/hr/performance/cycles")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cycles:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    const { searchParams } = request.nextUrl
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing cycle ID" }, { status: 400 })

    const { data: existing } = await adminSupabase
      .from("review_cycles")
      .select("id, status, name")
      .eq("id", id)
      .maybeSingle<{ id: string; status: CycleStatus | null; name: string }>()

    if (!existing) return NextResponse.json({ error: "Cycle not found" }, { status: 404 })

    if (["active", "locked"].includes(String(existing.status))) {
      return NextResponse.json({ error: "Cannot delete an active or locked cycle" }, { status: 400 })
    }

    // Check if any reviews reference this cycle
    const { count: reviewCount } = await adminSupabase
      .from("performance_reviews")
      .select("id", { count: "exact", head: true })
      .eq("review_cycle_id", id)

    if (reviewCount && reviewCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete — ${reviewCount} review(s) are linked to this cycle. Archive it instead.` },
        { status: 400 }
      )
    }

    const { error } = await adminSupabase.from("review_cycles").delete().eq("id", id)
    if (error) {
      log.error({ err: String(error) }, "Error deleting review cycle")
      return NextResponse.json({ error: "Failed to delete review cycle" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "review_cycle",
        entityId: id,
        oldValues: { name: existing.name, status: existing.status },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/cycles" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Review cycle deleted" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/hr/performance/cycles")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
