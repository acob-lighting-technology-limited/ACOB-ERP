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
  // Management directives (raised at the general meeting) are the same row type
  // separated by origin. They deliberately carry no report_id, so the weekly
  // report sync — which deletes every row with its report_id on each submit —
  // can never wipe them.
  origin: z.enum(["weekly_report", "management_directive"]).optional(),
  meeting_date: z.string().trim().min(1).optional().nullable(),
  timeline_text: z.string().trim().optional().nullable(),
  assignee_ids: z.array(z.string().uuid()).optional(),
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
    const origin = parsed.data.origin ?? "weekly_report"

    // Append manually-added items after any already synced from a report submission,
    // so they don't jump ahead of the department's existing list. Directives number
    // within their own category rather than continuing the report-derived list.
    const { count: existingCount } = await supabase
      .from("action_items")
      .select("id", { count: "exact", head: true })
      .eq("department", parsed.data.department)
      .eq("week_number", targetWeek)
      .eq("year", targetYear)
      .eq("origin", origin)

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
        origin,
        meeting_date: origin === "management_directive" ? parsed.data.meeting_date || null : null,
        timeline_text: origin === "management_directive" ? parsed.data.timeline_text || null : null,
      })
      .select("*")
      .single()

    if (error || !item)
      return NextResponse.json({ error: error?.message || "Failed to create action item" }, { status: 500 })

    const assigneeIds = Array.from(new Set(parsed.data.assignee_ids || []))
    if (origin === "management_directive" && assigneeIds.length > 0) {
      const { error: assigneeError } = await supabase
        .from("action_item_assignees")
        .insert(assigneeIds.map((profileId) => ({ action_item_id: item.id, profile_id: profileId })))
      if (assigneeError) {
        // The directive itself is the record of account; a failed name link must
        // not leave the caller thinking nothing was saved.
        log.error({ err: assigneeError.message, itemId: item.id }, "Failed to attach directive assignees")
      }
    }

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
