import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
const log = logger("projects-api")

// GET /api/projects - List scoped projects with task counts for progress bars
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`projects:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { data: projects, error } = await (supabase as any)
      .from("projects")
      .select(
        `
        *,
        project_manager:profiles!project_manager_id(
          id,
          full_name,
          first_name,
          last_name
        ),
        tasks:tasks(
          id,
          status
        )
      `
      )
      .order("project_name", { ascending: true })

    if (error) {
      log.error({ err: error.message }, "Failed to fetch projects")
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500 })
    }

    return NextResponse.json({ data: projects || [] })
  } catch (err) {
    log.error({ err }, "Unexpected error in projects GET")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`projects-write:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })
  }

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

    const { data: project, error } = await (supabase as any)
      .from("projects")
      .insert({
        project_name,
        location,
        deployment_start_date,
        deployment_end_date,
        capacity_w: capacity_w === "" || capacity_w === null ? null : Number(capacity_w),
        technology_type,
        project_manager_id: project_manager_id || null,
        description,
        status: status || "planning",
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      log.error({ err: error.message }, "Failed to create project")
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data: project })
  } catch (err: any) {
    log.error({ err }, "Unexpected error in projects POST")
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
