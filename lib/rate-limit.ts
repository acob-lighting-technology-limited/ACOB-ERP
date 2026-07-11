import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { createClient as createServiceClient } from "@supabase/supabase-js"

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()
const limiterCache = new Map<string, Ratelimit>()
const hasRedisConfig = Boolean(process.env.UPSTASH_REDIS_REST_URL)
const redis = hasRedisConfig ? Redis.fromEnv() : null
let hasWarnedAboutMemoryFallback = false

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasPostgresFallbackConfig = Boolean(supabaseUrl && serviceRoleKey)
const postgresClient = hasPostgresFallbackConfig
  ? createServiceClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

// Prune expired entries every 5 minutes to avoid unbounded growth
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const now = Date.now()
      for (const [key, win] of Array.from(store)) {
        if (win.resetAt < now) store.delete(key)
      }
    },
    5 * 60 * 1000
  )
}

export interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number
  /** Window size in seconds */
  windowSec: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function createRateLimiter(opts: { limit: number; windowSec: number }) {
  if (!redis) {
    throw new Error("Upstash Redis is not configured")
  }

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(opts.limit, `${opts.windowSec} s`),
  })
}

/**
 * Cross-lambda fallback backed by Postgres (rate_limit_increment RPC), used
 * when Upstash isn't configured. Correct under concurrent serverless
 * invocations (unlike the in-memory Map, which is per-lambda-instance),
 * at the cost of a DB round-trip per call.
 */
async function getPostgresRateLimitResult(key: string, opts: RateLimitOptions): Promise<RateLimitResult | null> {
  if (!postgresClient) return null

  const { data, error } = await postgresClient
    .rpc("rate_limit_increment", { p_key: key, p_window_seconds: opts.windowSec, p_limit: opts.limit })
    .single<{ allowed: boolean; remaining: number; reset_at: string }>()

  if (error || !data) {
    console.error("Postgres rate limit check failed, failing open", error)
    return null
  }

  return {
    allowed: data.allowed,
    remaining: data.remaining,
    resetAt: new Date(data.reset_at).getTime(),
  }
}

function getMemoryRateLimitResult(key: string, opts: RateLimitOptions): RateLimitResult {
  if (!hasWarnedAboutMemoryFallback) {
    console.warn("Rate limiting falling back to in-memory — not suitable for production")
    hasWarnedAboutMemoryFallback = true
  }

  const now = Date.now()
  const windowMs = opts.windowSec * 1000

  let win = store.get(key)
  if (!win || win.resetAt < now) {
    win = { count: 0, resetAt: now + windowMs }
    store.set(key, win)
  }

  win.count++

  return {
    allowed: win.count <= opts.limit,
    remaining: Math.max(0, opts.limit - win.count),
    resetAt: win.resetAt,
  }
}

/**
 * Check and increment the rate limit counter for a given key.
 * Key should encode both the identifier (IP or user ID) and the route.
 */
export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  if (!redis) {
    const postgresResult = await getPostgresRateLimitResult(key, opts)
    if (postgresResult) return postgresResult
    return getMemoryRateLimitResult(key, opts)
  }

  const cacheKey = `${opts.limit}:${opts.windowSec}`
  let limiter = limiterCache.get(cacheKey)
  if (!limiter) {
    limiter = createRateLimiter(opts)
    limiterCache.set(cacheKey, limiter)
  }

  const result = await limiter.limit(key)

  return {
    allowed: result.success,
    remaining: result.remaining,
    resetAt: result.reset,
  }
}

/**
 * Extract the best available client identifier from a Request.
 * Prefers x-forwarded-for (set by Vercel), falls back to a fixed string.
 */
export function getClientId(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return "unknown"
}
