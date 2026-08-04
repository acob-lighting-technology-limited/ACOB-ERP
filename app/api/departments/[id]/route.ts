import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("departments")

export const dynamic = "force-dynamic"

type DepartmentsClient = Awaited<ReturnType<typeof createClient>>

const UpdateDepartmentSchema = z.object({
  name: z.string().trim().min(1, "Department name is required"),
  description: z.string().optional().nullable(),
  department_head_id: z.string().optional().nullable(),
  department_code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Code must be at least 2 characters")
    .max(10, "Code must be at most 10 characters")
    .optional()
    .nullable(),
  is_executive_dept: z.boolean().optional(),
  is_active: z.boolean().optional(),
})

// Helper function to create Supabase client
async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}

// GET /api/departments/[id] - Get a single department
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase as DepartmentsClient, user.id)

    const { data: department, error } = await supabase.from("departments").select("*").eq("id", params.id).single()

    if (error) throw error

    if (scope) {
      const scopedDepartments = getDepartmentScope(scope, "general")
      if (scopedDepartments && !scopedDepartments.includes(department.name)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("department, department_id")
        .eq("id", user.id)
        .single()
      if (profile && profile.department_id !== department.id && profile.department !== department.name) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    return NextResponse.json({ data: department })
  } catch (error) {
    log.error({ err: String(error) }, "Error fetching department:")
    return NextResponse.json({ error: "Failed to fetch department" }, { status: 500 })
  }
}

// PUT /api/departments/[id] - Update a department (admin-like only)
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`departments:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    // Check if user is admin
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase as DepartmentsClient, user.id)
    const managedDepartments = scope?.managedDepartments || []
    const canManageDepartments = !!scope && (scope.isAdminLike || managedDepartments.includes("Admin & HR"))
    if (!canManageDepartments) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateDepartmentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { name, description, department_head_id, department_code, is_executive_dept, is_active } = parsed.data

    // If this dept is being marked as the executive dept, clear the flag from all others first
    if (is_executive_dept === true) {
      await supabase
        .from("departments")
        .update({ is_executive_dept: false })
        .neq("id", params.id)
        .eq("is_executive_dept", true)
    }

    const { data: department, error } = await supabase
      .from("departments")
      .update({
        name,
        description,
        department_head_id,
        department_code: department_code ?? null,
        ...(is_executive_dept !== undefined ? { is_executive_dept } : {}),
        ...(is_active !== undefined ? { is_active } : {}),
      })
      .eq("id", params.id)
      .select()
      .single()

    if (error) throw error

    await writeAuditLog(
      supabase as DepartmentsClient,
      {
        action: "update",
        entityType: "department",
        entityId: params.id,
        newValues: { name, description, department_head_id, department_code, is_executive_dept, is_active },
        context: { actorId: user.id, source: "api", route: `/api/departments/${params.id}` },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: department })
  } catch (error) {
    log.error({ err: String(error) }, "Error updating department:")
    return NextResponse.json({ error: "Failed to update department" }, { status: 500 })
  }
}

// DELETE /api/departments/[id] - Soft delete a department (admin-like only)
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`departments:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    // Check if user is admin
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase as DepartmentsClient, user.id)
    const managedDepartments = scope?.managedDepartments || []
    const canManageDepartments = !!scope && (scope.isAdminLike || managedDepartments.includes("Admin & HR"))
    if (!canManageDepartments) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: existingDepartment, error: fetchDepartmentError } = await supabase
      .from("departments")
      .select("id, name, is_active")
      .eq("id", params.id)
      .single()

    if (fetchDepartmentError || !existingDepartment) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 })
    }

    const { count: assignedProfilesCount, error: countError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("department_id", existingDepartment.id)

    if (countError) throw countError
    let effectiveAssignedProfilesCount = assignedProfilesCount || 0
    if (effectiveAssignedProfilesCount === 0) {
      const { count: legacyAssignedProfilesCount, error: legacyCountError } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .is("department_id", null)
        .eq("department", existingDepartment.name)

      if (legacyCountError) throw legacyCountError
      effectiveAssignedProfilesCount = legacyAssignedProfilesCount || 0
    }

    if (effectiveAssignedProfilesCount > 0) {
      return NextResponse.json(
        { error: "Cannot deactivate department while users are assigned to it" },
        { status: 409 }
      )
    }

    const { error } = await supabase
      .from("departments")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", params.id)

    if (error) throw error

    await writeAuditLog(
      supabase as DepartmentsClient,
      {
        action: "delete",
        entityType: "department",
        entityId: params.id,
        oldValues: { name: existingDepartment.name, is_active: true },
        context: { actorId: user.id, source: "api", route: `/api/departments/${params.id}` },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true, soft_deleted: true })
  } catch (error) {
    log.error({ err: String(error) }, "Error soft deleting department:")
    return NextResponse.json({ error: "Failed to deactivate department" }, { status: 500 })
  }
}
