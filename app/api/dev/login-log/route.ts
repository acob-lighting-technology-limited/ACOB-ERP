import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("dev-login-log")
const DevLoginLogSchema = z.object({
  authMethod: z.enum(["otp", "password"]).optional(),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`dev-login-log:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    let authMethod = "password"
    try {
      const body = await request.json()
      const parsed = DevLoginLogSchema.safeParse(body)
      if (parsed.success && parsed.data.authMethod) {
        authMethod = parsed.data.authMethod
      }
    } catch {
      // Body is optional for this endpoint.
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_email, full_name, first_name, last_name, role")
      .eq("id", user.id)
      .single()

    if (!profile?.role) {
      return NextResponse.json({ ok: true })
    }

    const ipHeader = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip")
    const ipAddress = ipHeader?.split(",")[0]?.trim() || null
    const userAgent = request.headers.get("user-agent")

    const nowIso = new Date().toISOString()
    const dedupeFrom = new Date(Date.now() - 10_000).toISOString()

    const { data: recent } = await supabase
      .from("dev_login_logs")
      .select("id")
      .eq("user_id", user.id)
      .eq("auth_method", authMethod)
      .eq("ip_address", ipAddress)
      .gte("login_at", dedupeFrom)
      .lte("login_at", nowIso)
      .limit(1)

    if ((recent || []).length === 0) {
      await supabase.from("dev_login_logs").insert({
        user_id: user.id,
        email: profile.company_email || user.email || "unknown",
        full_name:
          profile.full_name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || user.email || null,
        role: profile.role,
        ip_address: ipAddress,
        user_agent: userAgent,
        auth_method: authMethod,
        metadata: {
          source: "auth_login",
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    log.warn({ data: String(error) }, "[dev-login-log] fail-open logging error")
    return NextResponse.json({ ok: true })
  }
}
