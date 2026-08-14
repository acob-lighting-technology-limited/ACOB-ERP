import { NextRequest, NextResponse } from "next/server"
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { REAUTH_SOURCE } from "@/lib/auth/login-log"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("admin-onboarding")

type OnboardingClient = Awaited<ReturnType<typeof createClient>>

/** auth.admin.listUsers page size — the whole roster is a few hundred rows. */
const AUTH_PAGE_SIZE = 1000
/** Safety stop so a bad cursor can never spin forever. */
const MAX_AUTH_PAGES = 20

export interface OnboardingRow {
  id: string
  employee_number: string | null
  full_name: string
  email: string
  additional_email: string | null
  department: string | null
  designation: string | null
  role: string
  employment_status: string
  /** True when auth has ever recorded a successful sign-in for this account. */
  has_signed_in: boolean
  /** auth.users.last_sign_in_at — authoritative, covers logins from before app logging existed. */
  last_sign_in_at: string | null
  /** First app-recorded sign-in (dev_login_logs), null when we only know it from auth. */
  first_sign_in_at: string | null
  /** How many app-recorded sign-ins exist for this account. */
  sign_in_count: number
  /** Auth method of the most recent app-recorded sign-in: "password" | "otp" | null. */
  last_auth_method: string | null
  /** True once the invite/confirmation email has been confirmed. */
  email_confirmed: boolean
  /** auth.users.created_at — when the account was provisioned. */
  account_created_at: string | null
  /** Profile row creation, used when the auth account can't be read. */
  profile_created_at: string
}

interface ProfileRow {
  id: string
  employee_number: string | null
  company_email: string | null
  additional_email: string | null
  first_name: string | null
  last_name: string | null
  department: string | null
  designation: string | null
  role: string | null
  employment_status: string | null
  created_at: string
}

interface LoginLogRow {
  user_id: string
  auth_method: string | null
  login_at: string
  metadata: { source?: string } | null
}

interface AuthFacts {
  lastSignInAt: string | null
  emailConfirmed: boolean
  createdAt: string | null
  email: string | null
}

/**
 * Reads every auth account via the service-role admin API.
 *
 * `auth.users` is not reachable through PostgREST, so this is the only way to
 * get `last_sign_in_at` — the one field that answers "has this person ever
 * actually logged in", including sign-ins that predate `dev_login_logs`.
 *
 * Returns null (rather than throwing) when the service role key is absent, so
 * the page can still render the roster with an explicit "unknown" state.
 */
async function loadAuthFacts(): Promise<Map<string, AuthFacts> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  const adminClient = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const facts = new Map<string, AuthFacts>()

  for (let page = 1; page <= MAX_AUTH_PAGES; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (error) {
      log.error({ err: String(error), page }, "Failed to list auth users")
      return facts.size > 0 ? facts : null
    }

    for (const authUser of data.users) {
      facts.set(authUser.id, {
        lastSignInAt: authUser.last_sign_in_at ?? null,
        emailConfirmed: Boolean(authUser.email_confirmed_at ?? authUser.confirmed_at),
        createdAt: authUser.created_at ?? null,
        email: authUser.email ?? null,
      })
    }

    if (data.users.length < AUTH_PAGE_SIZE) break
  }

  return facts
}

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-onboarding:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Same gate as Settings → Users: this exposes the full account roster, so it
  // is deliberately not department-scoped.
  const scope = await resolveAdminScope(supabase as SupabaseClient, user.id)
  if (!scope || !canAccessAdminSection(scope, "settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase as SupabaseClient) as OnboardingClient

  const [profilesResult, logsResult, authFacts] = await Promise.all([
    dataClient
      .from("profiles")
      .select(
        "id, employee_number, company_email, additional_email, first_name, last_name, department, designation, role, employment_status, created_at"
      )
      .order("last_name", { ascending: true }),
    dataClient.from("dev_login_logs").select("user_id, auth_method, login_at, metadata"),
    loadAuthFacts(),
  ])

  if (profilesResult.error) {
    return NextResponse.json({ error: profilesResult.error.message }, { status: 500 })
  }
  if (logsResult.error) {
    // The log table is supplementary — auth.users still answers the core
    // question, so a failure here degrades detail rather than the whole page.
    log.error({ err: logsResult.error.message }, "Failed to read dev_login_logs")
  }

  const profiles = (profilesResult.data ?? []) as unknown as ProfileRow[]
  const logRows = (logsResult.error ? [] : ((logsResult.data ?? []) as unknown as LoginLogRow[])).filter(
    // Re-auth rows are password re-verifications, not sign-ins — counting them
    // would make a user who only ever changed their password look onboarded.
    (row) => row.metadata?.source !== REAUTH_SOURCE
  )

  const logStats = new Map<string, { first: string; last: string; count: number; lastMethod: string | null }>()
  for (const row of logRows) {
    const existing = logStats.get(row.user_id)
    if (!existing) {
      logStats.set(row.user_id, {
        first: row.login_at,
        last: row.login_at,
        count: 1,
        lastMethod: row.auth_method,
      })
      continue
    }
    existing.count += 1
    if (row.login_at < existing.first) existing.first = row.login_at
    if (row.login_at > existing.last) {
      existing.last = row.login_at
      existing.lastMethod = row.auth_method
    }
  }

  const rows: OnboardingRow[] = profiles.map((profile) => {
    const auth = authFacts?.get(profile.id) ?? null
    const logs = logStats.get(profile.id) ?? null
    const lastSignInAt = auth?.lastSignInAt ?? logs?.last ?? null

    return {
      id: profile.id,
      employee_number: profile.employee_number,
      full_name: [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Unnamed",
      email: profile.company_email || auth?.email || "",
      additional_email: profile.additional_email,
      department: profile.department,
      designation: profile.designation,
      role: profile.role || "employee",
      employment_status: profile.employment_status || "active",
      has_signed_in: Boolean(lastSignInAt),
      last_sign_in_at: lastSignInAt,
      first_sign_in_at: logs?.first ?? null,
      sign_in_count: logs?.count ?? 0,
      last_auth_method: logs?.lastMethod ?? null,
      email_confirmed: auth?.emailConfirmed ?? false,
      account_created_at: auth?.createdAt ?? null,
      profile_created_at: profile.created_at,
    }
  })

  return NextResponse.json({
    data: rows,
    meta: {
      // When false, `has_signed_in` rests on app logs alone and will
      // under-report anyone who last signed in before logging was added.
      authSourceAvailable: authFacts !== null,
      loginLogsAvailable: !logsResult.error,
      total: rows.length,
    },
  })
}
