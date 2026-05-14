import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import {
  ADMIN_LIKE_ROLES,
  ASSIGNABLE_ROLES,
  canAssignRole,
  canManageDeveloperAccounts,
  canManageSuperAdminAccounts,
} from "@/lib/role-management"
import { logger } from "@/lib/logger"
import { syncEmploymentStatusToAuth } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("admin-users-role")
const ALLOWED_ADMIN_DOMAINS = ["hr", "finance", "assets", "reports", "tasks", "projects", "communications"] as const

const UpdateUserRoleSchema = z
  .object({
    targetUserId: z.string().trim().min(1, "Missing targetUserId or role"),
    role: z.enum(ASSIGNABLE_ROLES, { errorMap: () => ({ message: "Invalid role supplied" }) }),
    admin_domains: z.array(z.enum(ALLOWED_ADMIN_DOMAINS)).optional(),
    employment_status: z.string().trim().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === "admin" && (!value.admin_domains || value.admin_domains.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Admin role requires at least one admin domain.",
        path: ["admin_domains"],
      })
    }
  })

export async function PATCH(request: Request) {
  const rl = await rateLimit(`admin-users-role:${getClientId(request)}`, { limit: 30, windowSec: 60 })
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

    const body = await request.json()
    const parsed = UpdateUserRoleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const targetUserId = parsed.data.targetUserId
    const targetRole = parsed.data.role
    const adminDomains = parsed.data.admin_domains ?? []
    const employmentStatus = parsed.data.employment_status ?? null

    if (targetUserId === user.id) {
      return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 })
    }

    const { data: actorProfile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    const actorRole = actorProfile?.role || ""

    if (!ADMIN_LIKE_ROLES.includes(actorRole as (typeof ADMIN_LIKE_ROLES)[number])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("role, department, lead_departments")
      .eq("id", targetUserId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 })
    }

    if (!canAssignRole(actorRole, targetRole)) {
      return NextResponse.json({ error: "You do not have permission to assign this role." }, { status: 403 })
    }

    if (targetProfile.role === "developer" && !canManageDeveloperAccounts(actorRole)) {
      return NextResponse.json(
        { error: "Only super admin or developer can modify developer accounts." },
        { status: 403 }
      )
    }

    if (targetProfile.role === "developer" && targetRole !== "developer") {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "developer")

      if ((count || 0) <= 1) {
        return NextResponse.json({ error: "Cannot downgrade the last developer account." }, { status: 400 })
      }
    }

    if (targetRole === "developer" && !canManageDeveloperAccounts(actorRole)) {
      return NextResponse.json(
        { error: "Only super admin or developer can assign the developer role." },
        { status: 403 }
      )
    }

    if (
      (targetProfile.role === "super_admin" || targetRole === "super_admin") &&
      !canManageSuperAdminAccounts(actorRole)
    ) {
      return NextResponse.json({ error: "Only super admin can manage super admin accounts." }, { status: 403 })
    }

    if (targetProfile.role === "super_admin" && targetRole !== "super_admin") {
      const { count, error: superAdminCountError } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin")

      if (superAdminCountError) {
        return NextResponse.json({ error: superAdminCountError.message }, { status: 400 })
      }

      if ((count || 0) <= 1) {
        return NextResponse.json({ error: "Cannot downgrade the last super admin account." }, { status: 400 })
      }
    }

    // Role changes do NOT affect department lead status — those are independent
    const payload: Record<string, unknown> = {
      role: targetRole,
      admin_domains: targetRole === "admin" ? adminDomains : null,
    }

    if (employmentStatus) {
      payload.employment_status = employmentStatus
    }

    const { error: updateError } = await supabase.from("profiles").update(payload).eq("id", targetUserId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    // Sync employment_status into JWT metadata so middleware doesn't need a DB query
    if (employmentStatus) {
      await syncEmploymentStatusToAuth(targetUserId, employmentStatus)
    }

    // Audit: role change is a critical admin action
    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "profile",
        entityId: targetUserId,
        context: { actorId: user.id, source: "api" as const },
        newValues: {
          role: targetRole,
          admin_domains: targetRole === "admin" ? adminDomains : null,
          ...(employmentStatus ? { employment_status: employmentStatus } : {}),
        },
        oldValues: { role: targetProfile.role },
        metadata: { source: "admin-users-role" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error({ err: String(error) }, "[admin-users-role]")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: Request) {
  const rl = await rateLimit(`admin-users-role:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
