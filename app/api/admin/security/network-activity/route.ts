import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireAccessContextV2, enforceRouteAccessV2 } from "@/lib/admin/api-guard-v2"
import { toLocalISODate } from "@/lib/utils/date"
import { classifyNetworkActivity, type NetworkActivityCategory } from "@/lib/security/network-activity-classify"

const log = logger("admin-security-network-activity")
export const dynamic = "force-dynamic"

/** Narrow local row shape — network_activity_logs is not yet in generated types (@/types/database). */
interface NetworkActivityLogRow {
  id: string
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
  created_at: string
}

/** Narrow local row shape for the latest-bandwidth-snapshot join. */
interface BandwidthSnapshotRow {
  matched_identifier: string
  user_id: string | null
  bytes_in: number
  bytes_out: number
  snapshot_at: string
}

export interface BandwidthSnapshotDTO {
  bytes_in: number
  bytes_out: number
  snapshot_at: string
}

/** Narrow local row shape for the profiles join — only the fields this route needs. */
interface EmployeeProfileRow {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  department: string | null
  department_id: string | null
}

export interface NetworkActivityRecordDTO extends NetworkActivityLogRow {
  employee_first_name: string | null
  employee_last_name: string | null
  employee_email: string | null
  employee_department: string | null
  category: NetworkActivityCategory
  bandwidth: BandwidthSnapshotDTO | null
}

const TIME_RE = /^\d{2}:\d{2}$/

const QuerySchema = z.object({
  user_id: z.array(z.string().uuid()).optional(),
  department_id: z.string().uuid().optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  start_time: z.string().regex(TIME_RE).optional(),
  end_time: z.string().regex(TIME_RE).optional(),
})

/** WAT (Africa/Lagos) is a fixed UTC+1 offset with no DST. */
const WAT_OFFSET_MS = 60 * 60 * 1000

/** Extract "HH:MM" in WAT wall-clock time for time-of-day comparison against the filter inputs. */
function timeOfDay(visitedAt: string): string {
  const d = new Date(new Date(visitedAt).getTime() + WAT_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-security-network-activity:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const accessResult = await requireAccessContextV2()
    if (!accessResult.ok) return accessResult.response
    const enforceResult = enforceRouteAccessV2(accessResult.context, "security.networkActivity")
    if (!enforceResult.ok) return enforceResult.response

    const { searchParams } = request.nextUrl
    const parsed = QuerySchema.safeParse({
      user_id: searchParams.getAll("user_id").length > 0 ? searchParams.getAll("user_id") : undefined,
      department_id: searchParams.get("department_id") ?? undefined,
      start_date: searchParams.get("start_date") ?? undefined,
      end_date: searchParams.get("end_date") ?? undefined,
      start_time: searchParams.get("start_time") ?? undefined,
      end_time: searchParams.get("end_time") ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }
    const { user_id, department_id, start_time, end_time } = parsed.data
    // Default to today when the client omits dates — supports the "defaults to today" requirement.
    const start_date = parsed.data.start_date ?? toLocalISODate()
    const end_date = parsed.data.end_date ?? toLocalISODate()

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // If department_id was supplied, resolve which user_ids belong to it and
    // intersect with any explicit user_id filter.
    let scopedUserIds: string[] | null = null
    if (department_id) {
      const { data: deptProfiles } = await dataClient
        .from("profiles")
        .select("id")
        .eq("department_id", department_id)
        .returns<{ id: string }[]>()
      scopedUserIds = (deptProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) {
        return NextResponse.json({ records: [] })
      }
    }
    if (user_id && user_id.length > 0) {
      scopedUserIds = scopedUserIds === null ? user_id : scopedUserIds.filter((id) => user_id.includes(id))
      if (scopedUserIds.length === 0) {
        return NextResponse.json({ records: [] })
      }
    }

    // Everyone, one day, ~40 people pushing deduped visits every ~10s → a few
    // thousand rows/day at most. 5000 gives comfortable headroom without
    // removing the cap entirely.
    let query = dataClient
      .from("network_activity_logs")
      .select(
        "id, user_id, matched_identifier, domain, source_ip, visited_at, raw_url, device_hostname, mac_address, device_vendor, is_new_device, user_agent, browser, os, created_at"
      )
      .gte("visited_at", `${start_date}T00:00:00.000Z`)
      .lte("visited_at", `${end_date}T23:59:59.999Z`)
      .order("visited_at", { ascending: false })
      .limit(5000)

    if (scopedUserIds !== null) query = query.in("user_id", scopedUserIds)

    const { data, error } = await query.returns<NetworkActivityLogRow[]>()
    if (error) {
      log.error({ err: String(error) }, "Failed to fetch network activity logs")
      return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 })
    }

    let records = data ?? []

    // Time-of-day filtering happens in application code, not SQL — this is an
    // internal admin tool with modest expected row volume, so extracting
    // time-of-day across a date range in Postgres isn't worth the complexity.
    if (start_time) records = records.filter((r) => timeOfDay(r.visited_at) >= start_time)
    if (end_time) records = records.filter((r) => timeOfDay(r.visited_at) <= end_time)

    // Resolve employee display info for rows that have a user_id.
    const resolvedUserIds = Array.from(new Set(records.map((r) => r.user_id).filter((id): id is string => !!id)))
    const profilesById = new Map<string, EmployeeProfileRow>()
    if (resolvedUserIds.length > 0) {
      const { data: profiles } = await dataClient
        .from("profiles")
        .select("id, first_name, last_name, company_email, department, department_id")
        .in("id", resolvedUserIds)
        .returns<EmployeeProfileRow[]>()
      for (const p of profiles ?? []) profilesById.set(p.id, p)
    }

    // Feature 4: join in each employee's most recent bandwidth snapshot —
    // one extra query for the whole result page's set of employees, not a
    // per-row query. Employees are matched by user_id when resolved, else by
    // matched_identifier (mirrors how network_activity_logs itself resolves
    // identity).
    const identifiersForBandwidth = Array.from(
      new Set(records.map((r) => r.matched_identifier.trim().toLowerCase()))
    )
    const latestBandwidthByUserId = new Map<string, BandwidthSnapshotDTO>()
    const latestBandwidthByIdentifier = new Map<string, BandwidthSnapshotDTO>()

    function absorbBandwidthRows(bandwidthRows: BandwidthSnapshotRow[] | null | undefined) {
      // Rows are ordered newest-first, so the first time we see a given
      // user_id / matched_identifier is its latest snapshot.
      for (const row of bandwidthRows ?? []) {
        const snapshot: BandwidthSnapshotDTO = {
          bytes_in: row.bytes_in,
          bytes_out: row.bytes_out,
          snapshot_at: row.snapshot_at,
        }
        if (row.user_id && !latestBandwidthByUserId.has(row.user_id)) {
          latestBandwidthByUserId.set(row.user_id, snapshot)
        }
        const identifierKey = row.matched_identifier.trim().toLowerCase()
        if (!latestBandwidthByIdentifier.has(identifierKey)) {
          latestBandwidthByIdentifier.set(identifierKey, snapshot)
        }
      }
    }

    // Two lookups (by resolved user_id, and by raw matched_identifier for
    // employees not yet resolved to a profile) instead of one query with a
    // hand-built `.or()` filter — simpler and avoids escaping arbitrary
    // identifier strings into a PostgREST filter expression.
    if (resolvedUserIds.length > 0) {
      const { data: bandwidthByUser, error: bandwidthByUserError } = await dataClient
        .from("network_bandwidth_snapshots")
        .select("matched_identifier, user_id, bytes_in, bytes_out, snapshot_at")
        .in("user_id", resolvedUserIds)
        .order("snapshot_at", { ascending: false })
        .limit(2000)
        .returns<BandwidthSnapshotRow[]>()
      if (bandwidthByUserError) {
        log.error({ err: String(bandwidthByUserError) }, "Failed to fetch bandwidth snapshots by user_id")
      }
      absorbBandwidthRows(bandwidthByUser)
    }
    if (identifiersForBandwidth.length > 0) {
      const { data: bandwidthByIdentifier, error: bandwidthByIdentifierError } = await dataClient
        .from("network_bandwidth_snapshots")
        .select("matched_identifier, user_id, bytes_in, bytes_out, snapshot_at")
        .in("matched_identifier", identifiersForBandwidth)
        .order("snapshot_at", { ascending: false })
        .limit(2000)
        .returns<BandwidthSnapshotRow[]>()
      if (bandwidthByIdentifierError) {
        log.error({ err: String(bandwidthByIdentifierError) }, "Failed to fetch bandwidth snapshots by identifier")
      }
      absorbBandwidthRows(bandwidthByIdentifier)
    }

    const enriched: NetworkActivityRecordDTO[] = records.map((r) => {
      const profile = r.user_id ? profilesById.get(r.user_id) : undefined
      const bandwidth =
        (r.user_id ? latestBandwidthByUserId.get(r.user_id) : undefined) ??
        latestBandwidthByIdentifier.get(r.matched_identifier.trim().toLowerCase()) ??
        null
      return {
        ...r,
        employee_first_name: profile?.first_name ?? null,
        employee_last_name: profile?.last_name ?? null,
        employee_email: profile?.company_email ?? null,
        employee_department: profile?.department ?? null,
        category: classifyNetworkActivity(r.domain),
        bandwidth,
      }
    })

    // No per-request audit log here: this is now a live, filterable, browsable
    // table — every filter tweak or page reload would fire a fresh GET, and
    // logging each one would flood audit_logs with view noise rather than
    // meaningful admin actions. See AGENTS.md "Logging and Audit Expectations".

    return NextResponse.json({ records: enriched })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/security/network-activity")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
