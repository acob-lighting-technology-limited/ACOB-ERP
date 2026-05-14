import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("payments-categories")

export const dynamic = "force-dynamic"

type PaymentsClient = Awaited<ReturnType<typeof createClient>>

const CreatePaymentCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
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

// GET /api/payments/categories - Get all payment categories
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: categories, error } = await supabase.from("payment_categories").select("*").order("name")

    if (error) throw error

    return NextResponse.json({ data: categories })
  } catch (error) {
    log.error({ err: String(error) }, "Error fetching payment categories:")
    return NextResponse.json({ error: "Failed to fetch payment categories" }, { status: 500 })
  }
}

// POST /api/payments/categories - Create a new payment category
export async function POST(request: Request) {
  const rl = await rateLimit(`payments-categories:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    // Check if user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope || !scope.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = CreatePaymentCategorySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { name } = parsed.data

    const { data: category, error } = await supabase.from("payment_categories").insert({ name }).select().single()

    if (error) throw error

    await writeAuditLog(
      supabase as PaymentsClient,
      {
        action: "create",
        entityType: "payment_category",
        entityId: category.id,
        newValues: { name },
        context: { actorId: user.id, source: "api", route: "/api/payments/categories" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: category }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error creating payment category:")
    return NextResponse.json({ error: "Failed to create payment category" }, { status: 500 })
  }
}
