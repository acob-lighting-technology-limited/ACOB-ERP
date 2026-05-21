import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/correspondence/server"
import { logger } from "@/lib/logger"

const log = logger("correspondence-requesters")

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getAuthContext()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const departmentName = request.nextUrl.searchParams.get("department_name")
    if (!departmentName || !departmentName.trim()) {
      return NextResponse.json({ error: "department_name is required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, email:id")
      .eq("employment_status", "active")
      .or(`department.eq.${departmentName.trim()},lead_departments.cs.{${departmentName.trim()}}`)
      .order("full_name", { ascending: true })

    if (error) throw error

    const profiles = (data || []).map(
      (p: { id: string; full_name?: string | null; first_name?: string | null; last_name?: string | null }) => ({
        id: p.id,
        full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Unknown",
      })
    )

    return NextResponse.json({ data: profiles })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/requesters:")
    return NextResponse.json({ error: "Failed to fetch requesters" }, { status: 500 })
  }
}
