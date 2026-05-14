import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await getRequestScope()
    if (!scope?.isAdminLike || scope.scopeMode === "lead") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, company_email, gender, employment_date, employment_type, work_location")
      .or("gender.is.null,employment_date.is.null,employment_type.is.null,work_location.is.null")
      .order("full_name")

    if (error) {
      return NextResponse.json({ error: "Failed to fetch data quality report" }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch {
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
