import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { latenessDeduction } from "@/lib/hr/attendance-utils"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { DB_WRITABLE_STATUSES } from "@/lib/hr/attendance-status"

const CreateSchema = z.object({
  user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clock_in: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .nullable(),
  clock_out: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .nullable(),
  status: z.enum(DB_WRITABLE_STATUSES).optional(),
  waived: z.boolean().optional(),
  waiver_reason: z.string().max(200).optional().nullable(),
})

const log = logger("admin-hr-attendance-records")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-records:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const depts = getScopedDepartments(scope)
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const userId = searchParams.get("user_id")

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Resolve the set of user IDs visible to this admin/lead
    let scopedUserIds: string[] | null = null
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ records: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ records: [] })
    }

    let attendanceQuery = dataClient
      .from("attendance_records")
      .select("id, user_id, date, clock_in, clock_out, total_hours, status, source, waived, waiver_reason, updated_at")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500)

    if (startDate) attendanceQuery = attendanceQuery.gte("date", startDate)
    if (endDate) attendanceQuery = attendanceQuery.lte("date", endDate)
    // If a specific user_id was requested, honour it only when it falls within scope
    if (userId) {
      if (scopedUserIds !== null && !scopedUserIds.includes(userId)) {
        return NextResponse.json({ records: [] })
      }
      attendanceQuery = attendanceQuery.eq("user_id", userId)
    } else if (scopedUserIds !== null) {
      attendanceQuery = attendanceQuery.in("user_id", scopedUserIds)
    }

    const { data, error } = await attendanceQuery

    if (error) {
      log.error({ err: String(error) }, "Failed to fetch admin attendance records")
      return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 })
    }

    const rows = data ?? []

    // Fetch profiles separately (no FK constraint between attendance_records and profiles)
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
    const profileMap = new Map<
      string,
      { full_name?: string; first_name?: string; last_name?: string; department?: string }
    >()
    if (userIds.length > 0) {
      const { data: profileRows } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name, department")
        .in("id", userIds)
      for (const p of profileRows ?? []) profileMap.set(p.id, p)
    }

    const records = rows.map((r) => {
      const p = profileMap.get(r.user_id)
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: name,
        department: p?.department ?? "",
        date: r.date,
        clock_in: r.clock_in,
        clock_out: r.clock_out,
        total_hours: r.total_hours,
        status: r.waived ? "waiver" : r.status,
        source: r.source,
        waived: r.waived,
        waiver_reason: r.waiver_reason,
        updated_at: r.updated_at,
      }
    })

    return NextResponse.json({ records })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/records")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-create:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const parsed = CreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { user_id, date, clock_in, clock_out, waived, waiver_reason } = parsed.data
    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Validate the target employee is in this admin/lead's scope
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      const { data: targetProfile } = await dataClient
        .from("profiles")
        .select("department")
        .eq("id", user_id)
        .maybeSingle()
      if (!targetProfile || !depts.includes(targetProfile.department || "")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Check for existing record on this date
    const { data: existing } = await dataClient
      .from("attendance_records")
      .select("id")
      .eq("user_id", user_id)
      .eq("date", date)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: "A record already exists for this date" }, { status: 409 })
    }

    // Auto-determine status from times
    let status = parsed.data.status
    if (!status) {
      if (waived) {
        status = "waiver"
      } else if (!clock_in && !clock_out) {
        status = "absent"
      } else if (clock_in && !clock_out) {
        status = "incomplete"
      } else if (clock_in && clock_out) {
        status = latenessDeduction(clock_in) > 0 ? "late" : "present"
      } else {
        status = "incomplete"
      }
    }

    if (clock_in && clock_out && clock_out < clock_in) {
      return NextResponse.json({ error: "Clock out cannot be before clock in" }, { status: 400 })
    }
    if (!waived && !clock_in && !clock_out) {
      return NextResponse.json({ error: "Provide both clock in and clock out before saving" }, { status: 400 })
    }
    if ((clock_in && !clock_out) || (!clock_in && clock_out)) {
      return NextResponse.json({ error: "Clock in and clock out must be provided together" }, { status: 400 })
    }

    const insert: Record<string, unknown> = { user_id, date, status, source: "manual" }
    if (clock_in) insert.clock_in = clock_in
    if (clock_out) insert.clock_out = clock_out
    if (waived !== undefined) insert.waived = waived
    if (waiver_reason !== undefined) insert.waiver_reason = waiver_reason

    if (clock_in && clock_out) {
      const inMs = new Date(`${date}T${clock_in}Z`).getTime()
      const outMs = new Date(`${date}T${clock_out}Z`).getTime()
      insert.total_hours = Math.max(0, (outMs - inMs) / (1000 * 60 * 60))
    }

    const { data: created, error } = await dataClient.from("attendance_records").insert(insert).select().single()

    if (error) {
      log.error({ err: JSON.stringify(error) }, "Failed to create attendance record")
      return NextResponse.json({ error: "Failed to create record" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "attendance_record",
        entityId: created.id,
        newValues: insert,
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/records" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: created, message: "Record created" }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/records")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
