import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { normalizeDepartmentName } from "@/shared/departments"

type CallerProfile = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

export async function GET() {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "System configuration error" }, { status: 500 })
  }

  const supabaseAdmin = createAdminClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabaseAdmin
    .from("pending_users")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (callerIsAdminLike) {
    return NextResponse.json({ data: data || [] })
  }

  const managedDepartments = new Set(
    Array.from(
      new Set([callerProfile?.department, ...(callerProfile?.lead_departments || [])].filter(Boolean) as string[])
    ).map((departmentName) => normalizeDepartmentName(departmentName))
  )

  const scopedRows = (data || []).filter((row) =>
    managedDepartments.has(normalizeDepartmentName(String(row.department || "")))
  )
  return NextResponse.json({ data: scopedRows })
}
