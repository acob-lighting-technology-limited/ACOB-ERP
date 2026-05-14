import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAuthContext } from "@/lib/correspondence/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-categories")

const CreateCategorySchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  code: z
    .string()
    .trim()
    .min(2, "code must be at least 2 characters")
    .max(10, "code must be at most 10 characters")
    .regex(/^[A-Z0-9\-]+$/i, "code must be alphanumeric with optional hyphens"),
})

export async function GET() {
  try {
    const { supabase, user } = await getAuthContext()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data, error } = await supabase
      .from("correspondence_categories")
      .select("id, name, code, created_at")
      .order("name", { ascending: true })

    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/categories:")
    return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`correspondence-categories:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )

  try {
    const { supabase, user } = await getAuthContext()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = CreateCategorySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const code = parsed.data.code.toUpperCase()
    const name = parsed.data.name

    const { data, error } = await supabase
      .from("correspondence_categories")
      .insert({ name, code, created_by: user.id })
      .select("id, name, code, created_at")
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `Category code "${code}" already exists` }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/correspondence/categories:")
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 })
  }
}
