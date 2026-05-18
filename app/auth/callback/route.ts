import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"

const log = logger("auth-callback")

async function writeLoginLog(request: Request, supabase: Awaited<ReturnType<typeof createClient>>, authMethod: string) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_email, full_name, first_name, last_name, role")
      .eq("id", user.id)
      .single()

    if (!profile?.role) return

    const ipHeader =
      (request.headers as Headers).get("x-forwarded-for") || (request.headers as Headers).get("x-real-ip")
    const ipAddress = ipHeader?.split(",")[0]?.trim() || null
    const userAgent = (request.headers as Headers).get("user-agent")

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
        metadata: { source: "auth_callback" },
      })
    }
  } catch (err) {
    // fail-open — never block the redirect
    log.warn({ err: String(err) }, "Failed to write login log in callback")
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") || "/profile"

  // Validate and sanitize 'next' to prevent open redirects
  let safeNext = "/profile"
  if (
    next &&
    typeof next === "string" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes(":") && // Prevent scheme/host characters
    !/https?:\/\//i.test(next) // Extra check for explicit http/https
  ) {
    safeNext = next
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      log.error("Callback error:", error.message)
      // Use a generic message in the URL to avoid leaking internal Supabase error details
      return NextResponse.redirect(
        new URL(`/auth/error?message=${encodeURIComponent("Authentication failed. Please try again.")}`, request.url)
      )
    }

    // Log the login — magic link / OTP flows all land here
    await writeLoginLog(request, supabase, "otp")
  }

  return NextResponse.redirect(new URL(safeNext, request.url))
}
