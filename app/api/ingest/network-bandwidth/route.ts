import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("ingest-network-bandwidth")

/** Narrow local row shape — network_bandwidth_snapshots is not yet in generated types (@/types/database). */
interface NetworkBandwidthSnapshotInsert {
  matched_identifier: string
  user_id: string | null
  bytes_in: number
  bytes_out: number
  snapshot_at: string
}

const NetworkBandwidthEntrySchema = z.object({
  matched_identifier: z.string().min(1),
  bytes_in: z.number().nonnegative(),
  bytes_out: z.number().nonnegative(),
  snapshot_at: z.string(),
})

const NetworkBandwidthBatchSchema = z.object({
  entries: z.array(NetworkBandwidthEntrySchema).min(1).max(500),
})

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Ingests cumulative hotspot bytes-in/bytes-out snapshots per employee,
 * pushed by a separate router job (built separately, outside this repo) at a
 * much lower frequency than the domain-visit log. Mirrors the exact same
 * bearer-secret pattern as app/api/ingest/network-activity/route.ts.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`ingest-network-bandwidth:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // ── Auth — bearer shared secret, timing-safe compare ──────────────────────
  const secret = process.env.NETWORK_BANDWIDTH_INGEST_SECRET
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret ?? ""}`
  if (!secret || !safeCompare(authHeader, expected)) {
    log.warn("Invalid or missing network bandwidth ingest token")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let parsedJson: unknown
  try {
    parsedJson = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const result = NetworkBandwidthBatchSchema.safeParse(parsedJson)
  if (!result.success) {
    log.warn({ issues: result.error.issues }, "Invalid network bandwidth batch payload")
    return NextResponse.json({ error: "Invalid batch payload" }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    log.error({}, "Missing Supabase env vars — cannot process network bandwidth batch")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { entries } = result.data

  // Resolve matched_identifier -> profiles.id via company_email, in one batch lookup.
  const identifiers = [...new Set(entries.map((entry) => entry.matched_identifier.trim().toLowerCase()))]
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id, company_email")
    .in("company_email", identifiers)

  if (profileError) {
    log.error({ err: String(profileError) }, "Failed to resolve profiles for network bandwidth batch")
  }

  const userIdByEmail = new Map<string, string>()
  for (const row of (profileRows ?? []) as { id: string; company_email: string | null }[]) {
    if (row.company_email) userIdByEmail.set(row.company_email.trim().toLowerCase(), row.id)
  }

  const rows: NetworkBandwidthSnapshotInsert[] = entries.map((entry) => {
    const identifier = entry.matched_identifier.trim().toLowerCase()
    return {
      matched_identifier: entry.matched_identifier,
      user_id: userIdByEmail.get(identifier) ?? null,
      bytes_in: entry.bytes_in,
      bytes_out: entry.bytes_out,
      snapshot_at: entry.snapshot_at,
    }
  })

  const { error: insertError, count } = await supabase
    .from("network_bandwidth_snapshots")
    .insert(rows, { count: "exact" })

  if (insertError) {
    log.error({ err: String(insertError) }, "Failed to insert network bandwidth batch")
    return NextResponse.json({ error: "Failed to store batch" }, { status: 500 })
  }

  log.info({ inserted: count ?? rows.length }, "Network bandwidth batch ingested")
  return NextResponse.json({ success: true, inserted: count ?? rows.length })
}
