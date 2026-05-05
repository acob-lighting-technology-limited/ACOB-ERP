import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

import { logger } from "@/lib/logger"

const log = logger("auth-confirm")

/**
 * Handles confirmation links from Supabase emails (invite, recovery, email confirmation).
 * Exchanges token_hash for a session, then redirects to the appropriate page.
 *
 * Query params:
 * - token_hash: The token hash from the email link
 * - type: The type of confirmation (invite, recovery, email, signup)
 * - next: Optional redirect path after confirmation (defaults to /profile)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const rawType = searchParams.get("type")
  const rawNext = searchParams.get("next") || "/profile"

  // Validate type parameter
  const ALLOWED_TYPES = new Set(["invite", "recovery", "email", "signup", "magiclink"])
  const type = ALLOWED_TYPES.has(rawType || "")
    ? (rawType as "invite" | "recovery" | "email" | "signup" | "magiclink")
    : "signup"

  // Validate and sanitize 'next' to prevent open redirects
  let safeNext = "/profile"
  if (
    rawNext &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.includes(":") &&
    !/https?:\/\//i.test(rawNext) &&
    !/[\r\n]/.test(rawNext) // Extra validation for CRLF
  ) {
    safeNext = rawNext
  }

  if (!tokenHash || !rawType) {
    return NextResponse.redirect(new URL("/auth/error?message=Missing+confirmation+parameters", request.url))
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type,
  })

  if (error) {
    log.error("Confirm error:", error.message)
    return NextResponse.redirect(new URL(`/auth/error?message=${encodeURIComponent(error.message)}`, request.url))
  }

  // For invites, redirect to set-password page
  if (type === "invite") {
    return NextResponse.redirect(new URL("/auth/set-password", request.url))
  }

  // For recovery, redirect to reset-password page (or custom next if provided)
  if (type === "recovery") {
    const recoveryDest = safeNext !== "/profile" ? safeNext : "/auth/reset-password"
    return NextResponse.redirect(new URL(recoveryDest, request.url))
  }

  // For all other types, redirect to the `safeNext` path
  return NextResponse.redirect(new URL(safeNext, request.url))
}
