import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

const log = logger("lib-auth-login-log")

/**
 * Where a `dev_login_logs` row came from.
 *
 * `reauth` is *not* a sign-in — it marks a password re-verification (change
 * password, CBT session start) that makes Supabase emit an `auth` login audit
 * entry as a side effect. Tagging them keeps reconciliation against
 * `auth.audit_log_entries` honest, and the admin list filters them out.
 */
export type LoginLogSource = "auth_login" | "auth_callback" | "auth_confirm" | "reauth"

export const REAUTH_SOURCE: LoginLogSource = "reauth"

export type LoginAuthMethod = "password" | "otp"

export interface WriteLoginLogParams {
  supabase: SupabaseClient
  headers: Headers
  userId: string
  authMethod: LoginAuthMethod
  source: LoginLogSource
  /** Fallback when the profile has no `company_email`. */
  userEmail?: string | null
}

export type LoginLogResult =
  | { written: true }
  | { written: false; reason: "no_profile_role" | "deduped" | "insert_failed" | "unexpected_error" }

/** Window in which an identical event is treated as a duplicate of an earlier one. */
const DEDUPE_WINDOW_MS = 10_000

/**
 * Records a sign-in in `dev_login_logs`.
 *
 * Fail-open — never throws, so it cannot block a redirect or a login response.
 * Unlike the previous inline copies of this logic, every failure is logged at
 * error level: a dropped login should be visible in the server logs rather
 * than silently absent from /admin/dev/login-logs.
 */
export async function writeLoginLog({
  supabase,
  headers,
  userId,
  authMethod,
  source,
  userEmail,
}: WriteLoginLogParams): Promise<LoginLogResult> {
  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_email, full_name, first_name, last_name, role")
      .eq("id", userId)
      .single()

    if (profileError) {
      log.error({ err: profileError.message, userId, source }, "login log: profile lookup failed")
    }

    if (!profile?.role) {
      // Roleless accounts are invisible on the login-logs page by design, but
      // the gap should be traceable when someone asks why a login is missing.
      log.warn({ userId, source }, "login log: skipped, profile has no role")
      return { written: false, reason: "no_profile_role" }
    }

    const ipHeader = headers.get("x-forwarded-for") || headers.get("x-real-ip")
    const ipAddress = ipHeader?.split(",")[0]?.trim() || null
    const userAgent = headers.get("user-agent")

    const nowIso = new Date().toISOString()
    const dedupeFrom = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()

    // One user action can hit two writers (callback + client POST), so those
    // collapse into a single row. Re-auth events are deduped separately so a
    // real login never suppresses one, or vice versa.
    let dedupeQuery = supabase
      .from("dev_login_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("auth_method", authMethod)
      .eq("ip_address", ipAddress)
      .gte("login_at", dedupeFrom)
      .lte("login_at", nowIso)

    // `neq` also skips rows whose metadata carries no `source` at all, so a
    // pre-existing untagged row won't suppress a new one. That errs toward a
    // duplicate rather than a dropped login, which is the right way round.
    dedupeQuery =
      source === REAUTH_SOURCE
        ? dedupeQuery.eq("metadata->>source", REAUTH_SOURCE)
        : dedupeQuery.neq("metadata->>source", REAUTH_SOURCE)

    const { data: recent, error: dedupeError } = await dedupeQuery.limit(1)

    if (dedupeError) {
      // Don't drop the event over a failed dedupe read — insert and accept the
      // small chance of a duplicate row.
      log.error({ err: dedupeError.message, userId, source }, "login log: dedupe lookup failed")
    }

    if ((recent || []).length > 0) {
      return { written: false, reason: "deduped" }
    }

    const { error: insertError } = await supabase.from("dev_login_logs").insert({
      user_id: userId,
      email: profile.company_email || userEmail || "unknown",
      full_name:
        profile.full_name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || userEmail || null,
      role: profile.role,
      ip_address: ipAddress,
      user_agent: userAgent,
      auth_method: authMethod,
      metadata: { source },
    })

    if (insertError) {
      log.error(
        { err: insertError.message, code: insertError.code, details: insertError.details, userId, source, authMethod },
        "login log: insert failed — this sign-in will not appear in /admin/dev/login-logs"
      )
      return { written: false, reason: "insert_failed" }
    }

    return { written: true }
  } catch (error) {
    log.error({ err: String(error), userId, source }, "login log: unexpected error, sign-in not recorded")
    return { written: false, reason: "unexpected_error" }
  }
}
