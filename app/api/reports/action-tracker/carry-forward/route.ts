import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { fetchActionTrackerItems } from "@/lib/reports/action-tracker-data"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("action-tracker-carry-forward-route")

const CarryForwardSchema = z.object({
  week_number: z.number().int().min(1).max(53),
  year: z.number().int().min(2000).max(9999),
})

type ScopeProfile = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

function getPreviousWeek(week: number, year: number) {
  if (week > 1) return { week: week - 1, year }
  return { week: 52, year: year - 1 }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`reports-action-tracker-carry-forward:${getClientId(request)}`, {
    limit: 20,
    windowSec: 60,
  })
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

    const parsed = CarryForwardSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<ScopeProfile>()

    const role = String(profile?.role || "").toLowerCase()
    const isAdmin = ["developer", "super_admin", "admin"].includes(role)
    const isLead = Boolean(profile?.is_department_lead)
    if (!isAdmin && !isLead) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const scopedDepartments = isAdmin
      ? null
      : Array.from(
          new Set(
            [profile?.department, ...(profile?.lead_departments || [])].filter(
              (value): value is string => typeof value === "string" && value.length > 0
            )
          )
        )

    const previous = getPreviousWeek(parsed.data.week_number, parsed.data.year)
    const sourceItems = await fetchActionTrackerItems(supabase, {
      week: previous.week,
      year: previous.year,
      scopedDepartments: scopedDepartments || undefined,
    })
    const itemsToCarry = sourceItems.filter((item) => item.status !== "completed")
    if (itemsToCarry.length === 0) {
      return NextResponse.json({ carried_count: 0, items: [] })
    }

    const insertPayload = itemsToCarry.map((item, index) => ({
      title: item.title,
      department: item.department,
      description: item.description || null,
      status: "not_started",
      week_number: parsed.data.week_number,
      year: parsed.data.year,
      original_week: item.original_week || previous.week,
      assigned_by: user.id,
      position: index,
      // An unfinished management directive stays a directive when it rolls over,
      // keeping the meeting it came from and its minuted timeline attached.
      origin: item.origin,
      meeting_date: item.meeting_date || null,
      timeline_text: item.timeline_text || null,
      // The hindrance travels with the item: the whole point of recording why an
      // action point stalled is that it is still visible in the week it stalls
      // into. Evidence files stay attached to the week they were filed against.
      blocker_note: item.blocker_note || null,
      blocker_reported_at: item.blocker_reported_at || null,
      blocker_reported_by: item.blocker_reported_by || null,
    }))

    const { data: newItems, error: insertError } = await supabase.from("action_items").insert(insertPayload).select("*")

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Responsible staff carry over with the directive, or accountability resets
    // to the department every time an item misses its week.
    const assigneeLinks = (newItems || []).flatMap((newItem, index) => {
      const source = itemsToCarry[index]
      if (!source || source.origin !== "management_directive") return []
      return source.assignees.map((assignee) => ({
        action_item_id: (newItem as { id: string }).id,
        profile_id: assignee.id,
      }))
    })
    if (assigneeLinks.length > 0) {
      const { error: assigneeError } = await supabase.from("action_item_assignees").insert(assigneeLinks)
      if (assigneeError) {
        log.error({ err: assigneeError.message }, "Failed to carry forward directive assignees")
      }
    }

    await writeAuditLog(
      supabase,
      {
        action: "action_item.carry_forward",
        entityType: "action_item",
        entityId: String(parsed.data.week_number),
        newValues: { count: newItems?.length || 0, week_number: parsed.data.week_number, year: parsed.data.year },
        context: { actorId: user.id, source: "api", route: "/api/reports/action-tracker/carry-forward" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ carried_count: newItems?.length || 0, items: newItems || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in action tracker carry-forward POST")
    return NextResponse.json({ error: "Failed to carry forward action items" }, { status: 500 })
  }
}
