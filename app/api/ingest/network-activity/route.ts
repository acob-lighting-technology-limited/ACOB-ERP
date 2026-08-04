import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { lookupMacVendor } from "@/lib/security/mac-vendor"
import { parseUserAgent } from "@/lib/security/parse-user-agent"

const log = logger("ingest-network-activity")

/** Narrow local row shape — network_activity_logs is not yet in generated types (@/types/database). */
interface NetworkActivityLogInsert {
  user_id: string | null
  matched_identifier: string
  domain: string
  source_ip: string | null
  visited_at: string
  raw_url: string | null
  device_hostname: string | null
  mac_address: string | null
  device_vendor: string | null
  is_new_device: boolean
  user_agent: string | null
  browser: string | null
  os: string | null
  metadata: Record<string, unknown>
}

/** Narrow local row shape for known_devices — not yet in generated types. */
interface KnownDeviceRow {
  mac_address: string
  matched_identifier: string | null
}

const NetworkActivityEntrySchema = z.object({
  matched_identifier: z.string().min(1),
  domain: z.string().min(1),
  source_ip: z.string().optional().nullable(),
  visited_at: z.string(),
  raw_url: z.string().optional().nullable(),
  device_hostname: z.string().optional().nullable(),
  mac_address: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable(),
})

const NetworkActivityBatchSchema = z.object({
  entries: z.array(NetworkActivityEntrySchema).min(1).max(500),
})

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`ingest-network-activity:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // ── Auth — bearer shared secret, timing-safe compare ──────────────────────
  const secret = process.env.NETWORK_ACTIVITY_INGEST_SECRET
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret ?? ""}`
  if (!secret || !safeCompare(authHeader, expected)) {
    log.warn("Invalid or missing network activity ingest token")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let parsedJson: unknown
  try {
    parsedJson = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const result = NetworkActivityBatchSchema.safeParse(parsedJson)
  if (!result.success) {
    log.warn({ issues: result.error.issues }, "Invalid network activity batch payload")
    return NextResponse.json({ error: "Invalid batch payload" }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    log.error({}, "Missing Supabase env vars — cannot process network activity batch")
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
    log.error({ err: String(profileError) }, "Failed to resolve profiles for network activity batch")
  }

  const userIdByEmail = new Map<string, string>()
  for (const row of (profileRows ?? []) as { id: string; company_email: string | null }[]) {
    if (row.company_email) userIdByEmail.set(row.company_email.trim().toLowerCase(), row.id)
  }

  // Feature 2: rogue/new-device detection. Batch-fetch every distinct MAC in
  // this payload against known_devices in one round-trip, diff in memory, and
  // bulk-upsert — never a per-row query even for a 500-entry batch.
  const macsInBatch = [...new Set(entries.map((e) => e.mac_address?.trim()).filter((m): m is string => !!m))]
  const knownMacs = new Set<string>()
  if (macsInBatch.length > 0) {
    const { data: knownDeviceRows, error: knownDevicesError } = await supabase
      .from("known_devices")
      .select("mac_address, matched_identifier")
      .in("mac_address", macsInBatch)
      .returns<KnownDeviceRow[]>()
    if (knownDevicesError) {
      log.error({ err: String(knownDevicesError) }, "Failed to look up known_devices for batch")
    }
    for (const row of knownDeviceRows ?? []) knownMacs.add(row.mac_address)
  }

  // Track which MAC gets is_new_device=true on this insert — only the first
  // occurrence within the batch (in case the same brand-new MAC appears more
  // than once in a single push). No alerting is fired for this — is_new_device
  // just marks the row so the UI can show a badge on it.
  const newlySeenMacs = new Set<string>()

  const rows: NetworkActivityLogInsert[] = entries.map((entry) => {
    const identifier = entry.matched_identifier.trim().toLowerCase()
    const mac = entry.mac_address?.trim() || null
    const vendor = mac ? lookupMacVendor(mac) : null
    const { browser, os } = parseUserAgent(entry.user_agent ?? null)

    let isNewDevice = false
    if (mac && !knownMacs.has(mac) && !newlySeenMacs.has(mac)) {
      isNewDevice = true
      newlySeenMacs.add(mac)
    }

    return {
      user_id: userIdByEmail.get(identifier) ?? null,
      matched_identifier: entry.matched_identifier,
      domain: entry.domain,
      source_ip: entry.source_ip ?? null,
      visited_at: entry.visited_at,
      raw_url: entry.raw_url ?? null,
      device_hostname: entry.device_hostname ?? null,
      mac_address: mac,
      device_vendor: vendor,
      is_new_device: isNewDevice,
      user_agent: entry.user_agent ?? null,
      browser,
      os,
      metadata: {},
    }
  })

  const { error: insertError, count } = await supabase
    .from("network_activity_logs")
    .insert(rows, { count: "exact" })

  if (insertError) {
    log.error({ err: String(insertError) }, "Failed to insert network activity batch")
    return NextResponse.json({ error: "Failed to store batch" }, { status: 500 })
  }

  // Bulk-upsert known_devices: brand-new MACs get inserted (first_seen_at =
  // now), previously-seen MACs get last_seen_at (and matched_identifier)
  // refreshed. One upsert call for the whole batch.
  if (macsInBatch.length > 0) {
    const latestByMac = new Map<string, string>()
    for (const entry of entries) {
      const mac = entry.mac_address?.trim()
      if (mac) latestByMac.set(mac, entry.matched_identifier)
    }
    const upsertRows = macsInBatch.map((mac) => ({
      mac_address: mac,
      last_seen_at: new Date().toISOString(),
      matched_identifier: latestByMac.get(mac) ?? null,
      ...(newlySeenMacs.has(mac) ? { first_seen_at: new Date().toISOString() } : {}),
    }))
    const { error: upsertError } = await supabase
      .from("known_devices")
      .upsert(upsertRows, { onConflict: "mac_address" })
    if (upsertError) {
      log.error({ err: String(upsertError) }, "Failed to upsert known_devices for batch")
    }
  }

  log.info({ inserted: count ?? rows.length, newDevices: newlySeenMacs.size }, "Network activity batch ingested")
  return NextResponse.json({ success: true, inserted: count ?? rows.length, newDevices: newlySeenMacs.size })
}
