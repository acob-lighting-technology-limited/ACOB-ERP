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

const CreateDepartmentSchema = z.object({
  name: z.string().trim().min(1, "Department name is required"),
  description: z.string().optional().nullable(),
  department_head_id: z.string().optional().nullable(),
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

// GET /api/departments - Get all departments
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase as DepartmentsClient, user.id)
    let query = supabase.from("departments").select("*").eq("is_active", true).order("name")

    if (scope) {
      const scopedDepartments = getDepartmentScope(scope, "general")
      if (scopedDepartments) {
        query = scopedDepartments.length > 0 ? query.in("name", scopedDepartments) : query.eq("name", "__none__")
      }
    } else {
      const { data: profile } = await supabase.from("profiles").select("department").eq("id", user.id).single()
      if (profile?.department) query = query.eq("name", profile.department)
    }

    const { data: departments, error } = await query

    if (error) throw error

    return NextResponse.json({ data: departments })
  } catch (error) {
    log.error({ err: String(error) }, "Error fetching departments:")
    return NextResponse.json({ error: "Failed to fetch departments" }, { status: 500 })
  }
}

// POST /api/departments - Create a new department (admin-like only)
export async function POST(request: Request) {
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
    const parsed = CreateDepartmentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { name, description, department_head_id } = parsed.data

    const { data: department, error } = await supabase
      .from("departments")
      .insert({
        name,
        description,
        department_head_id,
      })
      .select()
      .single()

    if (error) throw error

    await writeAuditLog(
      supabase as DepartmentsClient,
      {
        action: "create",
        entityType: "department",
        entityId: department.id,
        newValues: { name, description, department_head_id },
        context: { actorId: user.id, source: "api", route: "/api/departments" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: department }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error creating department:")
    return NextResponse.json({ error: "Failed to create department" }, { status: 500 })
  }
}
