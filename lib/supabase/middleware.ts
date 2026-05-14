import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { canManageMaintenanceMode, parseMaintenanceMode } from "@/lib/maintenance"
import type { EmploymentStatus } from "@/types/database"
import { resolveAdminScope, roleCanEnterAdmin } from "@/lib/admin/rbac"
import { buildAccessContextV2, canAccessRouteV2, resolveAdminRouteKeyV2 } from "@/lib/admin/policy-v2"

// ---------------------------------------------------------------------------
// Maintenance-mode in-memory cache (30 s TTL).
// Avoids a DB round-trip on every authenticated request.
// ---------------------------------------------------------------------------
interface MaintenanceCache {
  value: boolean
  expiresAt: number
}
let _maintenanceCache: MaintenanceCache | null = null

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buffer)
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("")
}

function timingSafeEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function getMaintenanceMode(supabase: ReturnType<typeof createServerClient>): Promise<boolean> {
  const now = Date.now()
  if (_maintenanceCache && now < _maintenanceCache.expiresAt) {
    return _maintenanceCache.value
  }

  const { data: settings } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "maintenance_mode")
    .single()

  const { enabled } = parseMaintenanceMode(settings?.value)
  _maintenanceCache = { value: enabled, expiresAt: now + 30_000 }
  return enabled
}

export async function updateSession(request: NextRequest) {
  const requestId = globalThis.crypto.randomUUID()
  request.headers.set("x-request-id", requestId)

  let supabaseResponse = NextResponse.next({
    request,
  })
  supabaseResponse.headers.set("x-request-id", requestId)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          supabaseResponse.headers.set("x-request-id", requestId)
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const intendedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`

  // -----------------------------------------------------------------------
  // ADMIN SCOPE INJECTION — Single Source of Truth
  // Resolve AdminScope once here and forward it as an internal request header
  // (x-admin-scope) so every downstream API route / server component can read
  // it via headers() without an extra DB round-trip.
  //
  // IMPORTANT: we set the header on the *forwarded request*, not on the
  // response — only request headers are readable via `headers()` in server
  // components and route handlers. Response headers go to the browser only.
  //
  // Strip any client-supplied x-admin-scope to prevent spoofing.
  // -----------------------------------------------------------------------
  const isAdminOrApiPath =
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/hr") ||
    pathname.startsWith("/api/reports") ||
    pathname.startsWith("/api/documentation") ||
    pathname.startsWith("/api/assets") ||
    pathname.startsWith("/admin")

  if (isAdminOrApiPath && user) {
    try {
      // Check role from user_metadata first (fast path, no extra DB query for non-admins)
      const metaRole = user.user_metadata?.role as string | undefined
      const metaIsLead = Boolean(user.user_metadata?.is_department_lead)
      const needsScope = !metaRole || roleCanEnterAdmin(metaRole, metaIsLead)
      if (needsScope) {
        const scope = await resolveAdminScope(supabase, user.id)
        if (scope) {
          if (pathname.startsWith("/admin")) {
            const routeKey = resolveAdminRouteKeyV2(pathname)
            const accessContext = buildAccessContextV2(scope)
            if (!canAccessRouteV2(accessContext, routeKey)) {
              const blockedTarget = request.nextUrl.clone()
              blockedTarget.pathname = "/admin"
              return NextResponse.redirect(blockedTarget)
            }
          }

          const encoded = Buffer.from(JSON.stringify(scope)).toString("base64")
          // Build new request headers with the scope injected
          const forwardedHeaders = new Headers(request.headers)
          // Strip any client-supplied value first (anti-spoofing)
          forwardedHeaders.delete("x-admin-scope")
          forwardedHeaders.set("x-admin-scope", encoded)
          // Rebuild supabaseResponse with the updated forwarded request headers
          // so that headers() in server components / API routes can read it
          supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders } })
          supabaseResponse.headers.set("x-request-id", requestId)
          // Re-apply any cookies that were already set on the previous supabaseResponse
          request.cookies.getAll().forEach(({ name, value }) => {
            supabaseResponse.cookies.set(name, value)
          })
        }
      }
    } catch {
      // Non-fatal — routes fall back to resolving scope themselves via DB
    }
  }

  // Check maintenance mode (cached — no DB hit within 30 s window)
  const isMaintenanceMode = await getMaintenanceMode(supabase)

  // If maintenance has been disabled, users should not remain stuck on /maintenance.
  if (!isMaintenanceMode && pathname.startsWith("/maintenance")) {
    const url = request.nextUrl.clone()
    if (!user) {
      url.pathname = "/auth/login"
      return NextResponse.redirect(url)
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    url.pathname = canManageMaintenanceMode(profile?.role) ? "/admin" : "/profile"
    return NextResponse.redirect(url)
  }

  // If maintenance is on, and not already on maintenance page or statics
  if (
    isMaintenanceMode &&
    !pathname.startsWith("/maintenance") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/favicon.ico")
  ) {
    if (!user) {
      // If not logged in, allow auth pages, otherwise maintenance
      if (!pathname.startsWith("/auth")) {
        const url = request.nextUrl.clone()
        url.pathname = "/maintenance"
        return NextResponse.redirect(url)
      }
    } else {
      // If logged in, check role
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, employment_status")
        .eq("id", user.id)
        .single()

      const canBypassMaintenance = canManageMaintenanceMode(profile?.role)

      if (!canBypassMaintenance) {
        const url = request.nextUrl.clone()
        url.pathname = "/maintenance"
        return NextResponse.redirect(url)
      }

      // Reuse profile for employment status check
      const status = profile?.employment_status as EmploymentStatus | undefined

      // Allow access to logout and suspension page without status check
      const allowedPaths = ["/auth/logout", "/suspended", "/auth/login"]
      const isAllowedPath = allowedPaths.some((path) => pathname.startsWith(path))

      if (!isAllowedPath) {
        // Handle suspended employees - redirect to suspension notice page
        if (status === "suspended") {
          const url = request.nextUrl.clone()
          url.pathname = "/suspended"
          return NextResponse.redirect(url)
        }

        // Handle separated employees - sign out and redirect to login with error
        if (status === "separated") {
          // Clear session cookies and redirect to login
          const url = request.nextUrl.clone()
          url.pathname = "/auth/login"
          url.searchParams.set("error", "account_separated")

          // Sign out the user
          await supabase.auth.signOut()

          return NextResponse.redirect(url)
        }
      }

      // Maintenance is enabled and the current user can manage maintenance mode.
    }
  }

  // Allow unauthenticated access to auth pages, public routes, and the form
  // Maintenance mode check must run before this block so non-authenticated users
  // are redirected to /maintenance when maintenance is enabled.
  if (
    pathname !== "/" &&
    !user &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/employee/new") &&
    !pathname.startsWith("/api/public") &&
    !pathname.startsWith("/api/devices") &&
    !pathname.startsWith("/kss")
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    url.searchParams.set("next", intendedPath || "/profile")
    return NextResponse.redirect(url)
  }

  // Check employment status for authenticated users (Normal flow if maintenance is OFF).
  // Prefer JWT user_metadata (set by syncEmploymentStatusToAuth) to avoid a DB query.
  // Falls back to a DB query only when metadata is absent (e.g. legacy sessions).
  if (user && !isMaintenanceMode) {
    // Allow access to logout and suspension page without status check
    const allowedPaths = ["/auth/logout", "/suspended", "/auth/login"]
    const isAllowedPath = allowedPaths.some((path) => pathname.startsWith(path))

    if (!isAllowedPath) {
      // Prefer JWT metadata — zero DB round-trip for most requests
      let status = user.user_metadata?.employment_status as EmploymentStatus | undefined

      // Fallback for legacy sessions that pre-date the metadata sync
      if (!status) {
        const { data: profile } = await supabase.from("profiles").select("employment_status").eq("id", user.id).single()
        status = profile?.employment_status as EmploymentStatus | undefined
      }

      // Handle suspended employees - redirect to suspension notice page
      if (status === "suspended") {
        const url = request.nextUrl.clone()
        url.pathname = "/suspended"
        return NextResponse.redirect(url)
      }

      // Handle separated employees - sign out and redirect to login with error
      if (status === "separated") {
        // Clear session cookies and redirect to login
        const url = request.nextUrl.clone()
        url.pathname = "/auth/login"
        url.searchParams.set("error", "account_separated")

        // Sign out the user
        await supabase.auth.signOut()

        return NextResponse.redirect(url)
      }
    }
  }

  // CSRF: validate Origin header for state-changing requests
  const method = request.method.toUpperCase()
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = request.headers.get("origin")
    const host = request.headers.get("host")
    const allowedOrigins = [process.env.NEXT_PUBLIC_SITE_URL, `https://${host}`, `http://${host}`].filter(Boolean)

    if (origin && !allowedOrigins.some((o) => origin.startsWith(o!))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const isApiRoute = pathname.startsWith("/api/")
    const hasBearerAuth = request.headers.get("authorization")?.startsWith("Bearer ")

    if (isApiRoute && !hasBearerAuth) {
      const cookieToken = request.cookies.get("csrf_token")?.value
      const headerToken = request.headers.get("x-csrf-token")

      if (cookieToken && headerToken) {
        if (headerToken.length !== cookieToken.length || !timingSafeEqualText(headerToken, cookieToken)) {
          return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 })
        }
      }
    }
  }

  if (method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    const existingToken = request.cookies.get("csrf_token")?.value
    if (!existingToken) {
      const token = randomHex(32)
      supabaseResponse.cookies.set("csrf_token", token, {
        httpOnly: false,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60,
      })
    }
  }

  return supabaseResponse
}
