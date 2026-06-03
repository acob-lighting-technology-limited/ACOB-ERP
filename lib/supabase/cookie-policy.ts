// Uniform session window across all browsers — single source of truth.
//
// Safari ITP hard-caps any cookie written via `document.cookie` at ~7 days, so 7
// days is the longest window we can enforce *identically* on every browser
// without moving auth fully server-side (HttpOnly). We adopt it deliberately:
// re-login is required after 7 days of inactivity, the same on Chrome and Safari.
// The auth cookie is re-issued whenever the access token refreshes, so an active
// user's window keeps rolling forward — this is "7 days idle", not a hard cap.
//
// To raise this above 7 days you must complete the HttpOnly auth migration
// (server-only cookies); a larger number here alone would only be honored by
// Chrome and silently clamped to 7 by Safari, recreating the inconsistency.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

/**
 * Cap a Supabase-provided cookie maxAge to the uniform session window while
 * preserving deletions (sign-out writes an empty value / maxAge 0).
 */
export function resolveCookieMaxAge(requestedMaxAge: number | undefined, isDeletion: boolean): number {
  if (isDeletion) return 0
  if (requestedMaxAge == null) return SESSION_MAX_AGE_SECONDS
  return Math.min(requestedMaxAge, SESSION_MAX_AGE_SECONDS)
}
