import { createBrowserClient } from "@supabase/ssr"
import { resolveCookieMaxAge } from "@/lib/supabase/cookie-policy"

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        // Check if we're in the browser before accessing document
        if (typeof document === "undefined") {
          return []
        }
        return document.cookie.split("; ").map((cookie) => {
          const [name, ...rest] = cookie.split("=")
          return { name, value: decodeURIComponent(rest.join("=")) }
        })
      },
      setAll(cookiesToSet) {
        // Check if we're in the browser before accessing document
        if (typeof document === "undefined") {
          return
        }
        cookiesToSet.forEach(({ name, value, options }) => {
          // A deletion is an empty value (Supabase clears cookies on sign-out by
          // writing "" with maxAge 0). Never give those a future expiry.
          const isDeletion = value === "" || options?.maxAge === 0
          // Enforce the uniform 7-day session window (see cookie-policy.ts).
          // This also guarantees a non-deletion cookie always carries a max-age,
          // so it is never a session cookie that Safari drops on tab/app close.
          const maxAge = resolveCookieMaxAge(options?.maxAge, isDeletion)
          const sameSite = options?.sameSite || "lax"
          const cookieString =
            `${name}=${encodeURIComponent(value)}; path=${options?.path || "/"}; ` +
            `max-age=${maxAge}; SameSite=${sameSite}; ` +
            `${options?.secure ? "Secure; " : ""}`
          document.cookie = cookieString
        })
      },
    },
  })
}
