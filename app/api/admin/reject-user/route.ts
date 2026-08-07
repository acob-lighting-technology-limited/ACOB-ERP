import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { normalizeDepartmentName } from "@/shared/departments"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const RejectUserSchema = z.object({
  pendingUserId: z.string().trim().min(1, "Missing pendingUserId"),
  // A rejected applicant is told why, so this is mandatory rather than optional.
  rejectionReason: z.string().trim().min(1, "A reason is required when rejecting a signup"),
})

type CallerProfile = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

export async function POST(req: Request) {
  const rl = await rateLimit(`admin-reject-user:${getClientId(req)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const supabase = await createServerClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, department, is_department_lead, lead_departments")
    .eq("id", caller.id)
    .single<CallerProfile>()

  const callerRole = String(callerProfile?.role || "").toLowerCase()
  const callerIsAdminLike = ["developer", "super_admin", "admin"].includes(callerRole)
  const callerIsLead = callerProfile?.is_department_lead === true
  if (!callerProfile || (!callerIsAdminLike && !callerIsLead)) {
    return NextResponse.json({ error: "Forbidden: Admin or lead access required" }, { status: 403 })
  }

  const parsed = RejectUserSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "System configuration error" }, { status: 500 })
  }

  const supabaseAdmin = createAdminClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: pendingUser, error: fetchError } = await supabaseAdmin
    .from("pending_users")
    .select("id, department")
    .eq("id", parsed.data.pendingUserId)
    .maybeSingle<{ id: string; department?: string | null }>()

  if (fetchError || !pendingUser) {
    return NextResponse.json({ error: "Pending user not found" }, { status: 404 })
  }

  if (!callerIsAdminLike) {
    const managedDepartments = new Set(
      Array.from(
        new Set([callerProfile?.department, ...(callerProfile?.lead_departments || [])].filter(Boolean) as string[])
      ).map((departmentName) => normalizeDepartmentName(departmentName))
    )
    const pendingDepartment = normalizeDepartmentName(String(pendingUser.department || ""))
    if (managedDepartments.size === 0 || !managedDepartments.has(pendingDepartment)) {
      return NextResponse.json({ error: "Forbidden: Department scope mismatch" }, { status: 403 })
    }
  }

  const { error: rejectError } = await supabaseAdmin
    .from("pending_users")
    .update({
      status: "rejected",
      rejection_reason: parsed.data.rejectionReason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.pendingUserId)
  if (rejectError) {
    return NextResponse.json({ error: rejectError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
