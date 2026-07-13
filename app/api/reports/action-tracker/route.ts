import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { fetchActionTrackerItems } from "@/lib/reports/action-tracker-data"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("action-tracker-route")

const CreateActionItemSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  department: z.string().trim().min(1),
  week_number: z.number().int().min(1).max(53).optional(),
  year: z.number().int().min(2000).max(9999).optional(),
})

type ScopeProfile = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

function canManageDepartment(profile: ScopeProfile | null, department: string) {
  const role = String(profile?.role || "").toLowerCase()
  if (["developer", "super_admin", "admin"].includes(role)) return true
  if (!profile?.is_department_lead) return false
  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  return profile.department === department || leadDepartments.includes(department)
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`reports-action-tracker:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = CreateActionItemSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<ScopeProfile>()

    if (!canManageDepartment(profile ?? null, parsed.data.department)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const officeWeek = getCurrentOfficeWeek()
    const targetWeek = parsed.data.week_number ?? officeWeek.week
    const targetYear = parsed.data.year ?? officeWeek.year

    // Append manually-added items after any already synced from a report submission,
    // so they don't jump ahead of the department's existing list.
    const { count: existingCount } = await supabase
      .from("action_items")
      .select("id", { count: "exact", head: true })
      .eq("department", parsed.data.department)
      .eq("week_number", targetWeek)
      .eq("year", targetYear)

    const { data: item, error } = await supabase
      .from("action_items")
      .insert({
        title: parsed.data.title,
        description: parsed.data.description || null,
        department: parsed.data.department,
        status: "not_started",
        week_number: targetWeek,
        year: targetYear,
        assigned_by: user.id,
        position: existingCount ?? 0,
      })
      .select("*")
      .single()

    if (error || !item)
      return NextResponse.json({ error: error?.message || "Failed to create action item" }, { status: 500 })

    await writeAuditLog(
      supabase,
      {
        action: "action_item.create",
        entityType: "action_item",
        entityId: item.id,
        newValues: { title: item.title, department: item.department },
        context: { actorId: user.id, source: "api", route: "/api/reports/action-tracker" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: item }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in action tracker POST")
    return NextResponse.json({ error: "Failed to create action item" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const params = request.nextUrl.searchParams
    const week = Number(params.get("week"))
    const year = Number(params.get("year"))
    const dept = params.get("dept") || "all"
    const scopedDepartments = (params.get("scoped_departments") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)

    const data = await fetchActionTrackerItems(supabase, {
      week,
      year,
      department: dept,
      scopedDepartments,
    })

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in action tracker GET")
    return NextResponse.json({ error: "Failed to fetch action items" }, { status: 500 })
  }
}
