import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
const log = logger("projects-detail-api")

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      project_name,
      location,
      deployment_start_date,
      deployment_end_date,
      capacity_w,
      technology_type,
      project_manager_id,
      description,
      status,
    } = body

    if (!project_name || !location || !deployment_start_date || !deployment_end_date) {
      return NextResponse.json(
        { error: "Project name, location, start date, and end date are required" },
        { status: 400 }
      )
    }

    // Update project using authenticated user's client cast to any
    const { data, error } = await (supabase as any)
      .from("projects")
      .update({
        project_name,
        location,
        deployment_start_date,
        deployment_end_date,
        capacity_w: capacity_w === "" || capacity_w === null ? null : Number(capacity_w),
        technology_type,
        project_manager_id: project_manager_id || null,
        description,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select()
      .single()

    if (error) {
      log.error({ err: error.message }, "Failed to update project")
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data })
  } catch (err: any) {
    log.error({ err }, "Unexpected error in project PUT")
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
