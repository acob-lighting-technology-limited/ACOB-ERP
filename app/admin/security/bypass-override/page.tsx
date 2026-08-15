import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { BypassOverrideContent, type EnrichedBypassLog, type AuditLogRow } from "./_components/bypass-override-content"

export const dynamic = "force-dynamic"

function isBypassOrOverride(log: AuditLogRow): boolean {
  const entityType = String(log.entity_type || "").toLowerCase()
  const action = String(log.action || "").toLowerCase()
  const operation = String(log.operation || "").toLowerCase()

  const newValsStr = log.new_values ? JSON.stringify(log.new_values).toLowerCase() : ""
  const oldValsStr = log.old_values ? JSON.stringify(log.old_values).toLowerCase() : ""
  const metaStr = log.metadata ? JSON.stringify(log.metadata).toLowerCase() : ""
  const allText = `${entityType} ${action} ${operation} ${newValsStr} ${oldValsStr} ${metaStr}`

  // 1. Explicitly tagged bypass/override in audit
  if (
    allText.includes('"bypass":true') ||
    allText.includes('"bypass": true') ||
    allText.includes("bypass") ||
    allText.includes("override")
  ) {
    return true
  }

  // 2. Requisition stage bypass (e.g. emergency)
  if (entityType.includes("requisition")) {
    if (newValsStr.includes("bypassed_stages") || metaStr.includes("bypassed_stages")) {
      const newVals = log.new_values as any
      if (newVals && Array.isArray(newVals.bypassed_stages) && newVals.bypassed_stages.length > 0) {
        return true
      }
    }
  }

  // 3. Manual leave approval (bypassing workflow)
  if (
    entityType.includes("leave_request") &&
    (newValsStr.includes('"admin_manual":true') || newValsStr.includes('"admin_manual": true'))
  ) {
    return true
  }

  // 4. Attendance overrides (LWP/AWP status, remote clock-in source)
  if (entityType.includes("attendance")) {
    const isOverrideStatus = [
      "lateness_with_permission",
      "absent_with_permission",
      "lwp",
      "awp",
      "remote_web",
      "exempt",
      "waiver",
    ].some((term) => allText.includes(term))

    const isManualChange =
      allText.includes("admin_manual") || allText.includes("manual_alteration") || allText.includes("remote_clock_in")

    if (isOverrideStatus || isManualChange) {
      return true
    }
  }

  return false
}

function getTargetUserId(log: AuditLogRow): string | null {
  const newVals = log.new_values as any
  const oldVals = log.old_values as any
  if (newVals) {
    if (typeof newVals.user_id === "string") return newVals.user_id
    if (typeof newVals.target_user_id === "string") return newVals.target_user_id
  }
  if (oldVals) {
    if (typeof oldVals.user_id === "string") return oldVals.user_id
    if (typeof oldVals.target_user_id === "string") return oldVals.target_user_id
  }
  return null
}

export default async function BypassOverridePage() {
  await requireAdminSectionAccess("security")

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const { data, error } = await dataClient
    .from("audit_logs")
    .select(
      "id, action, operation, entity_type, entity_id, user_id, old_values, new_values, metadata, created_at, department"
    )
    .returns<AuditLogRow[]>()
    .order("created_at", { ascending: false })
    .limit(2500)

  const filteredLogs = (data || []).filter(isBypassOrOverride)

  // De-duplicate logs where a database trigger and an API route both logged the same event.
  // Group by entity_id and entity_type, and if they occur within 5 seconds of each other, prefer the one with user_id !== null.
  const dedupedLogs: AuditLogRow[] = []
  const sortedLogs = [...filteredLogs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  for (const log of sortedLogs) {
    if (!log.entity_id) {
      dedupedLogs.push(log)
      continue
    }

    const recentIndex = dedupedLogs.findIndex((existing) => {
      if (existing.entity_id !== log.entity_id) {
        return false
      }
      const normExisting = String(existing.entity_type || "")
        .toLowerCase()
        .replace(/s$/, "")
      const normLog = String(log.entity_type || "")
        .toLowerCase()
        .replace(/s$/, "")
      if (normExisting !== normLog) {
        return false
      }
      const timeDiff = Math.abs(new Date(existing.created_at).getTime() - new Date(log.created_at).getTime())
      return timeDiff <= 10000 // 10 seconds window
    })

    if (recentIndex !== -1) {
      const existing = dedupedLogs[recentIndex]
      // If the new log has an actor (user_id) but the existing one does not, replace it
      if (log.user_id && !existing.user_id) {
        dedupedLogs[recentIndex] = log
      }
      // Otherwise, discard the duplicate
    } else {
      dedupedLogs.push(log)
    }
  }

  // Sort back to descending order (latest first)
  dedupedLogs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Fetch correspondence records for enrichment
  const correspondenceIds = Array.from(
    new Set(
      dedupedLogs
        .filter((l) => String(l.entity_type).includes("correspondence"))
        .map((l) => l.entity_id)
        .filter(Boolean)
    )
  ) as string[]

  const correspondenceMap = new Map<
    string,
    {
      id: string
      subject: string
      reference_number: string
      originator_id: string
      responsible_officer_id: string | null
      department_name: string | null
    }
  >()

  if (correspondenceIds.length > 0) {
    const { data: records } = await dataClient
      .from("correspondence_records")
      .select("id, subject, reference_number, originator_id, responsible_officer_id, department_name")
      .in("id", correspondenceIds)

    if (records) {
      for (const r of records) {
        correspondenceMap.set(r.id, r)
      }
    }
  }

  const userIds = new Set<string>()
  for (const log of dedupedLogs) {
    if (log.user_id) userIds.add(log.user_id)
    const targetId = getTargetUserId(log)
    if (targetId) userIds.add(targetId)

    // Add correspondence users
    if (log.entity_id && String(log.entity_type).includes("correspondence")) {
      const corr = correspondenceMap.get(log.entity_id)
      if (corr) {
        if (corr.originator_id) userIds.add(corr.originator_id)
        if (corr.responsible_officer_id) userIds.add(corr.responsible_officer_id)
      }
    }
  }

  const profilesMap = new Map<
    string,
    { first_name: string; last_name: string; company_email: string; department: string | null }
  >()
  if (userIds.size > 0) {
    const { data: profiles } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, company_email, department")
      .in("id", Array.from(userIds))

    if (profiles) {
      for (const p of profiles) {
        profilesMap.set(p.id, {
          first_name: p.first_name || "",
          last_name: p.last_name || "",
          company_email: p.company_email || "",
          department: p.department || null,
        })
      }
    }
  }

  const rows: EnrichedBypassLog[] = dedupedLogs.map((log) => {
    const actor = log.user_id ? profilesMap.get(log.user_id) || null : null
    const targetId = getTargetUserId(log)
    const target = targetId ? profilesMap.get(targetId) || null : null

    let correspondence = null
    if (log.entity_id && String(log.entity_type).includes("correspondence")) {
      const corr = correspondenceMap.get(log.entity_id)
      if (corr) {
        const originator = profilesMap.get(corr.originator_id) || null
        const responsible = corr.responsible_officer_id ? profilesMap.get(corr.responsible_officer_id) || null : null
        correspondence = {
          subject: corr.subject,
          reference_number: corr.reference_number,
          originator,
          responsible,
        }
      }
    }

    return {
      ...log,
      actor,
      target,
      correspondence,
    }
  })

  return <BypassOverrideContent rows={rows} error={error?.message || null} />
}
