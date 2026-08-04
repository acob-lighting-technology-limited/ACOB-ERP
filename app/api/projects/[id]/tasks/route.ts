import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
const log = logger("project-tasks-api")

// GET /api/projects/[id]/tasks - Fetch all tasks for a specific project
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { data: tasks, error } = await (supabase as any)
      .from("tasks")
      .select(
        `
        *,
        assigned_user:profiles!assigned_to(
          id,
          full_name,
          first_name,
          last_name
        )
      `
      )
      .eq("project_id", params.id)
      .order("created_at", { ascending: true })

    if (error) {
      log.error({ err: error.message }, "Failed to fetch project tasks")
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: tasks || [] })
  } catch (err) {
    log.error({ err }, "Unexpected error in project tasks GET")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/projects/[id]/tasks - Create a new task under a project
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    const { title, description, status, assigned_to, priority } = body

    if (!title) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 })
    }

    const { data: task, error } = await (supabase as any)
      .from("tasks")
      .insert({
        title,
        description,
        status: status || "pending",
        assigned_to: assigned_to || null,
        assigned_by: user.id,
        project_id: params.id,
        priority: priority || "medium",
        category: "general",
      })
      .select()
      .single()

    if (error) {
      log.error({ err: error.message }, "Failed to create task")
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data: task })
  } catch (err: any) {
    log.error({ err }, "Unexpected error in project tasks POST")
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}

// PUT /api/projects/[id]/tasks - Update an existing task under a project
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
    const { task_id, title, description, status, assigned_to, priority } = body

    if (!task_id) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 })
    }

    const { data: task, error } = await (supabase as any)
      .from("tasks")
      .update({
        title,
        description,
        status,
        assigned_to: assigned_to || null,
        priority,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task_id)
      .eq("project_id", params.id)
      .select()
      .single()

    if (error) {
      log.error({ err: error.message }, "Failed to update task")
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data: task })
  } catch (err: any) {
    log.error({ err }, "Unexpected error in project tasks PUT")
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/projects/[id]/tasks - Delete a task under a project
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const task_id = searchParams.get("task_id")

    if (!task_id) {
      return NextResponse.json({ error: "task_id query param is required" }, { status: 400 })
    }

    const { error } = await (supabase as any).from("tasks").delete().eq("id", task_id).eq("project_id", params.id)

    if (error) {
      log.error({ err: error.message }, "Failed to delete task")
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    log.error({ err }, "Unexpected error in project tasks DELETE")
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
