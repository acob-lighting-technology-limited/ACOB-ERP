import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { writeLoginLog } from "@/lib/auth/login-log"

const log = logger("auth-callback")

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
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      await writeLoginLog({
        supabase,
        headers: request.headers,
        userId: user.id,
        authMethod: "otp",
        source: "auth_callback",
        userEmail: user.email,
      })
    }
  }

  return NextResponse.redirect(new URL(safeNext, request.url))
}
