import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("hr-attendance-admin-records")

const SaveAdminAttendanceSchema = z.object({
  user_id: z.string().trim().min(1, "Employee is required"),
  review_cycle_id: z.string().trim().min(1, "Cycle is required"),
  attendance_score: z.coerce
    .number()
    .min(1, "Attendance score must be above 0")
    .max(100, "Attendance score cannot exceed 100"),
})

type AccessProfile = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

type ExistingReviewRow = {
  id: string
  attendance_score: number | null
}

function canManage(profile: AccessProfile | null | undefined) {
  const role = String(profile?.role || "").toLowerCase()
  return ["developer", "admin", "super_admin"].includes(role) || profile?.is_department_lead === true
}

function reviewStatusPriority(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  if (normalized === "completed") return 3
  if (normalized === "submitted") return 2
  if (normalized === "draft") return 1
  return 0
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-attendance-admin-records:${getClientId(request)}`, { limit: 10, windowSec: 60 })
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
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const parsed = SaveAdminAttendanceSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("role, department, is_department_lead, lead_departments")
      .eq("id", user.id)
      .maybeSingle<AccessProfile>()

    if (!canManage(actorProfile)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const attendanceScope = await getRequestScope()
    const role = String(actorProfile?.role || "").toLowerCase()
    const isAdminLike = ["developer", "admin", "super_admin"].includes(role)
    // Global admin (scopeMode: "global") bypasses department restriction.
    // Admin in lead mode is restricted the same as a department lead.
    const isGlobalAdmin = isAdminLike && attendanceScope?.scopeMode !== "lead"

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, department")
      .eq("id", parsed.data.user_id)
      .maybeSingle<{ id: string; department?: string | null }>()

    if (!targetProfile) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 })
    }

    if (!isGlobalAdmin) {
      const managed = Array.from(
        new Set([actorProfile?.department, ...(actorProfile?.lead_departments || [])].filter(Boolean) as string[])
      )
      if (!managed.includes(String(targetProfile.department || ""))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { data: existingReviews, error: existingError } = await supabase
      .from("performance_reviews")
      .select("id, status, created_at, attendance_score")
      .eq("user_id", parsed.data.user_id)
      .eq("review_cycle_id", parsed.data.review_cycle_id)
      .returns<Array<ExistingReviewRow & { status?: string | null; created_at?: string | null }>>()

    if (existingError) {
      log.error({ err: JSON.stringify(existingError) }, "Failed to load attendance review row")
      return NextResponse.json({ error: "Failed to load attendance record" }, { status: 500 })
    }

    const canonicalReview = [...(existingReviews || [])].sort((left, right) => {
      const statusDiff = reviewStatusPriority(right.status) - reviewStatusPriority(left.status)
      if (statusDiff !== 0) return statusDiff
      return new Date(String(right.created_at || 0)).getTime() - new Date(String(left.created_at || 0)).getTime()
    })[0]

    const payload = {
      user_id: parsed.data.user_id,
      reviewer_id: user.id,
      review_cycle_id: parsed.data.review_cycle_id,
      review_date: new Date().toISOString().slice(0, 10),
      attendance_score: parsed.data.attendance_score,
      status: "draft",
      updated_at: new Date().toISOString(),
    }

    const query = canonicalReview
      ? supabase.from("performance_reviews").update(payload).eq("id", canonicalReview.id)
      : supabase.from("performance_reviews").insert(payload)

    const { data: saved, error: saveError } = await query.select("id, attendance_score").single<ExistingReviewRow>()

    if (saveError || !saved) {
      log.error({ err: JSON.stringify(saveError) }, "Failed to save attendance admin record")
      return NextResponse.json({ error: "Failed to save attendance record" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: canonicalReview ? "update" : "create",
        entityType: "performance_review",
        entityId: saved.id,
        oldValues: canonicalReview ? { attendance_score: canonicalReview.attendance_score ?? null } : null,
        newValues: {
          attendance_score: payload.attendance_score,
          review_cycle_id: payload.review_cycle_id,
          user_id: payload.user_id,
        },
        context: { actorId: user.id, source: "api", route: "/api/hr/attendance/admin-records" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: saved,
      message: canonicalReview ? "Attendance score updated" : "Attendance score created",
    })
  } catch (error) {
    log.error(
      { err: JSON.stringify(error, Object.getOwnPropertyNames(error || {})) },
      "Error in POST /api/hr/attendance/admin-records"
    )
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
