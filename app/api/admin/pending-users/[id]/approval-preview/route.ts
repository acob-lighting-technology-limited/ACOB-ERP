import { createClient as createAdminClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { buildApprovalEmailPreview } from "@/lib/onboarding/approval-email-preview"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { normalizeDepartmentName } from "@/shared/departments"

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createServerClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()

  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, department, designation, full_name, first_name, last_name, is_department_lead, lead_departments")
    .eq("id", caller.id)
    .single<{
      role?: string | null
      department?: string | null
      designation?: string | null
      full_name?: string | null
      first_name?: string | null
      last_name?: string | null
      is_department_lead?: boolean | null
      lead_departments?: string[] | null
    }>()
  const callerRole = String(callerProfile?.role || "").toLowerCase()
  const callerIsAdminLike = ["developer", "super_admin", "admin"].includes(callerRole)
  const callerIsLead = callerProfile?.is_department_lead === true
  if (!callerProfile || (!callerIsAdminLike && !callerIsLead)) {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "System configuration error" }, { status: 500 })
  }

  const employeeId = new URL(req.url).searchParams.get("employeeId")?.trim()
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employeeId" }, { status: 400 })
  }

  const empNumPattern = /^ACOB\/([A-Z0-9-]+\/)?[0-9]{4}\/[0-9]{3}$/
  if (!empNumPattern.test(employeeId)) {
    return NextResponse.json(
      { error: "Employee number must be in format: ACOB/YEAR/NUMBER (e.g., ACOB/2026/058)" },
      { status: 400 }
    )
  }

  const supabaseAdmin = createAdminClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: pendingUser, error } = await supabaseAdmin
    .from("pending_users")
    .select(
      "first_name, last_name, department, designation, company_email, personal_email, phone_number, office_location, residential_address"
    )
    .eq("id", params.id)
    .single()

  if (error || !pendingUser) {
    return NextResponse.json({ error: "Pending user not found" }, { status: 404 })
  }

  if (!callerIsAdminLike) {
    const managedDepartments = Array.from(
      new Set([callerProfile?.department, ...(callerProfile?.lead_departments || [])].filter(Boolean) as string[])
    ).map((departmentName) => normalizeDepartmentName(departmentName))
    const pendingDepartment = normalizeDepartmentName(String(pendingUser.department || ""))
    if (managedDepartments.length === 0 || !managedDepartments.includes(pendingDepartment)) {
      return NextResponse.json({ error: "Forbidden: Department scope mismatch" }, { status: 403 })
    }
  }

  const requiredFields = [
    "company_email",
    "personal_email",
    "first_name",
    "last_name",
    "department",
    "designation",
  ] as const
  const missingFields = requiredFields.filter((field) => !pendingUser[field])

  if (missingFields.length > 0) {
    return NextResponse.json({ error: `Missing required user data: ${missingFields.join(", ")}` }, { status: 422 })
  }

  const preview = await buildApprovalEmailPreview({
    supabase: supabaseAdmin,
    pendingUser,
    preparedBy: {
      name:
        callerProfile?.full_name ||
        [callerProfile?.first_name, callerProfile?.last_name].filter(Boolean).join(" ").trim() ||
        caller.email ||
        "Admin and HR Lead",
      designation: callerProfile?.designation || null,
      department: callerProfile?.department || "Admin and HR",
    },
  })

  return NextResponse.json(preview)
}
