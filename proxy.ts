import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const LEGACY_HOSTS = new Set(["acob-erp.vercel.app"])
const CANONICAL_HOST = "erp.acoblighting.com"

export async function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase()
  if (LEGACY_HOSTS.has(hostname)) {
    const url = request.nextUrl.clone()
    url.protocol = "https"
    url.hostname = CANONICAL_HOST
    url.port = ""
    return NextResponse.redirect(url, 308)
  }

  const pathname = request.nextUrl.pathname

  // Allow API routes and static assets through with session update
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/favicon.ico")) {
    return await updateSession(request)
  }

  // Intercept Supabase auth codes/tokens at root — these come from email links
  // when the redirect_to is the bare domain (no path).
  // Forward to the callback/confirm handler so the code actually gets exchanged.
  if (pathname === "/") {
    const code = request.nextUrl.searchParams.get("code")
    const tokenHash = request.nextUrl.searchParams.get("token_hash")
    const type = request.nextUrl.searchParams.get("type")

    if (code) {
      // PKCE code flow — forward to /auth/callback
      const url = request.nextUrl.clone()
      url.pathname = "/auth/callback"
      // Preserve the code and set next based on type
      url.searchParams.set("code", code)
      if (type === "recovery") {
        url.searchParams.set("next", "/auth/reset-password")
      }
      return NextResponse.redirect(url)
    }

    if (tokenHash && type) {
      // Token hash flow — forward to /auth/confirm
      const url = request.nextUrl.clone()
      url.pathname = "/auth/confirm"
      url.searchParams.set("token_hash", tokenHash)
      url.searchParams.set("type", type)
      return NextResponse.redirect(url)
    }

    // Normal root redirect
    const url = request.nextUrl.clone()
    url.pathname = "/profile"
    return NextResponse.redirect(url)
  }

  // Continue with normal session management
  return await updateSession(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
