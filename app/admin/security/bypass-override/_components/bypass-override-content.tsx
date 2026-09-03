"use client"

import { useMemo } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { ShieldAlert, AlertCircle, FileText, CalendarRange, Download, RefreshCw } from "lucide-react"
import { formatWATDateTime, toLocalISODate } from "@/lib/utils/date"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export type AuditLogRow = {
  id: string
  action: string | null
  operation: string | null
  entity_type: string | null
  entity_id: string | null
  user_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  department: string | null
}

export type EnrichedBypassLog = AuditLogRow & {
  actor: {
    first_name: string
    last_name: string
    company_email: string
    department: string | null
  } | null
  target: {
    first_name: string
    last_name: string
    company_email: string
    department: string | null
  } | null
  correspondence?: {
    subject: string
    reference_number: string
    originator: { first_name: string; last_name: string; company_email: string; department: string | null } | null
    responsible: { first_name: string; last_name: string; company_email: string; department: string | null } | null
  } | null
}

function getBypassSummary(log: EnrichedBypassLog): string {
  const entityType = String(log.entity_type || "").toLowerCase()
  const newVals = (log.new_values || {}) as any
  const oldVals = (log.old_values || {}) as any
  const meta = (log.metadata || {}) as any

  if (entityType.includes("requisition")) {
    const num = newVals.requisition_number || oldVals.requisition_number || log.entity_id || ""
    const stages = newVals.bypassed_stages || meta.bypassed_stages || []
    return `Emergency Requisition #${num} — Bypassed: ${stages.join(", ")}`
  }

  if (entityType.includes("leave_request")) {
    const targetName = log.target ? `${log.target.first_name} ${log.target.last_name}` : "Employee"
    const start = newVals.start_date || ""
    const end = newVals.end_date || ""
    return `Manual Leave Record for ${targetName} (${start} to ${end}) — Bypassed standard request workflow`
  }

  if (entityType.includes("correspondence")) {
    const num = newVals.unique_code || oldVals.unique_code || log.entity_id || ""
    return `Correspondence Approval Bypass for Doc #${num} — Approved by Admin directly`
  }

  if (entityType.includes("attendance")) {
    const targetName = log.target ? `${log.target.first_name} ${log.target.last_name}` : "Employee"
    const date = newVals.date || oldVals.date || ""
    const status = newVals.status || oldVals.status || ""
    const source = newVals.clock_in_source || newVals.source || ""

    if (status === "lateness_with_permission") {
      return `Lateness override (LWP) granted to ${targetName} for ${date}`
    }
    if (status === "incomplete_with_permission") {
      return `Missed clock-out override (IWP) granted to ${targetName} for ${date}`
    }
    if (status === "absent_with_permission") {
      return `Absence override (AWP) granted to ${targetName} for ${date}`
    }
    if (source === "remote_web") {
      return `Remote web clock-in bypass used by ${targetName} for ${date}`
    }
    return `Manual attendance alteration for ${targetName} for ${date}`
  }

  return `Bypass/Override activity logged on module: ${entityType}`
}

function getBypassType(row: EnrichedBypassLog): string {
  const entityType = String(row.entity_type || "").toLowerCase()
  if (entityType.includes("requisition")) return "Emergency Requisition"
  if (entityType.includes("leave_request")) return "Manual Leave Grant"
  if (entityType.includes("correspondence")) return "Correspondence Bypass"
  if (entityType.includes("attendance")) {
    const newVals = (row.new_values || {}) as any
    const oldVals = (row.old_values || {}) as any
    const status = newVals.status || oldVals.status || ""
    const source = newVals.clock_in_source || newVals.source || ""
    if (status === "lateness_with_permission") return "Lateness Override (LWP)"
    if (status === "incomplete_with_permission") return "Incomplete Override (IWP)"
    if (status === "absent_with_permission") return "Absence Override (AWP)"
    if (source === "remote_web") return "Remote Check-In Bypass"
    return "Manual Punch Alteration"
  }
  return "Policy Override"
}

function getBypassReason(row: EnrichedBypassLog): string {
  const newVals = (row.new_values || {}) as any
  const oldVals = (row.old_values || {}) as any
  const meta = (row.metadata || {}) as any

  return (
    newVals.manual_comment ||
    newVals.reason ||
    newVals.comment ||
    newVals.comments ||
    meta.reason ||
    meta.comment ||
    meta.comments ||
    meta.justification ||
    newVals.justification ||
    oldVals.manual_comment ||
    oldVals.reason ||
    oldVals.comment ||
    "No justification provided"
  )
}

function getBypassTarget(row: EnrichedBypassLog): string {
  const entityType = String(row.entity_type || "").toLowerCase()
  const newVals = (row.new_values || {}) as any
  const oldVals = (row.old_values || {}) as any

  if (row.correspondence) {
    return `Correspondence: ${row.correspondence.subject} (${row.correspondence.reference_number})`
  }

  if (row.target) {
    return `${row.target.first_name} ${row.target.last_name} (${row.target.company_email || "No email"})`
  }

  if (entityType.includes("requisition")) {
    return `Requisition #${newVals.requisition_number || oldVals.requisition_number || row.entity_id}`
  }

  if (entityType.includes("correspondence")) {
    return `Correspondence Document #${newVals.unique_code || oldVals.unique_code || row.entity_id}`
  }

  return `Entity ID: ${row.entity_id || "Unknown"}`
}

function getDetailedChanges(row: EnrichedBypassLog) {
  const entityType = String(row.entity_type || "").toLowerCase()
  const newVals = (row.new_values || {}) as any
  const oldVals = (row.old_values || {}) as any
  const meta = (row.metadata || {}) as any
  const details: { label: string; value: string }[] = []

  if (entityType.includes("requisition")) {
    const amount = newVals.amount || oldVals.amount
    if (amount) {
      details.push({ label: "Amount", value: `₦${Number(amount).toLocaleString()}` })
    }
    const dept = newVals.department_name || oldVals.department_name || row.department
    if (dept) {
      details.push({ label: "Department", value: String(dept) })
    }
    const stages = newVals.bypassed_stages || meta.bypassed_stages || []
    if (Array.isArray(stages) && stages.length > 0) {
      details.push({ label: "Bypassed Stages", value: stages.join(", ") })
    }
  } else if (entityType.includes("leave_request")) {
    if (newVals.start_date) details.push({ label: "Start Date", value: String(newVals.start_date) })
    if (newVals.end_date) details.push({ label: "End Date", value: String(newVals.end_date) })
    if (newVals.days_count) details.push({ label: "Total Days", value: String(newVals.days_count) })
  } else if (entityType.includes("attendance")) {
    const date = newVals.date || oldVals.date
    if (date) details.push({ label: "Work Date", value: String(date) })
    if (oldVals.status && newVals.status) {
      details.push({ label: "Status Change", value: `${oldVals.status} → ${newVals.status}` })
    } else if (newVals.status) {
      details.push({ label: "New Status", value: String(newVals.status) })
    }
    if (newVals.clock_in) details.push({ label: "Clock In", value: String(newVals.clock_in) })
    if (newVals.clock_out) details.push({ label: "Clock Out", value: String(newVals.clock_out) })
    if (newVals.clock_in_source || newVals.source) {
      details.push({ label: "Source", value: String(newVals.clock_in_source || newVals.source) })
    }
  } else if (entityType.includes("correspondence") && row.correspondence) {
    const orig = row.correspondence.originator
    if (orig) {
      details.push({
        label: "Created By (Requester)",
        value: `${orig.first_name} ${orig.last_name} (${orig.company_email})`,
      })
    }
    const resp = row.correspondence.responsible
    if (resp) {
      details.push({
        label: "Responsible Officer",
        value: `${resp.first_name} ${resp.last_name} (${resp.company_email || "No email"})`,
      })
    }
  }

  return details
}

function getRequestedBy(row: EnrichedBypassLog): string {
  if (row.correspondence?.originator) {
    return `${row.correspondence.originator.first_name} ${row.correspondence.originator.last_name}`
  }
  if (row.target) {
    return `${row.target.first_name} ${row.target.last_name}`
  }
  return "System / N/A"
}

function toCsv(rows: EnrichedBypassLog[]) {
  const headers = [
    "Time",
    "Performed By",
    "Actor Email",
    "Target Person",
    "Module",
    "Bypass Type",
    "Summary",
    "IP Address",
  ]
  const body = rows.map((r) => {
    const actorName = r.actor ? `${r.actor.first_name} ${r.actor.last_name}` : "System"
    const actorEmail = r.actor ? r.actor.company_email : ""
    const targetName = r.correspondence
      ? r.correspondence.originator
        ? `${r.correspondence.originator.first_name} ${r.correspondence.originator.last_name}`
        : ""
      : r.target
        ? `${r.target.first_name} ${r.target.last_name}`
        : ""
    const ip = (r.metadata as any)?.ip_address || ""
    return [
      r.created_at,
      actorName,
      actorEmail,
      targetName,
      r.entity_type || "",
      getBypassType(r),
      getBypassSummary(r),
      ip,
    ]
  })
  const escaped = [headers, ...body].map((line) =>
    line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  )
  return escaped.join("\n")
}

export function BypassOverrideContent({ rows, error }: { rows: EnrichedBypassLog[]; error: string | null }) {
  const router = useRouter()

  const stats = useMemo(
    () => ({
      total: rows.length,
      emergencyReqs: rows.filter((r) => String(r.entity_type).includes("requisition")).length,
      attendanceOverrides: rows.filter((r) => String(r.entity_type).includes("attendance")).length,
      manualLeaves: rows.filter((r) => String(r.entity_type).includes("leave_request")).length,
    }),
    [rows]
  )

  const bypassTypeOptions = useMemo(
    () => [
      { value: "Emergency Requisition", label: "Emergency Requisitions" },
      { value: "Manual Leave Grant", label: "Manual Leave Grants" },
      { value: "Correspondence Bypass", label: "Correspondence Bypasses" },
      { value: "LWP", label: "Liveness/Lateness Overrides (LWP)" },
      { value: "AWP", label: "Absence Overrides (AWP)" },
      { value: "Remote Check-In Bypass", label: "Remote Clock-In Bypasses" },
      { value: "Manual Punch Alteration", label: "Manual Punch Alterations" },
    ],
    []
  )

  const departmentOptions = useMemo(() => {
    const depts = new Set<string>()
    for (const r of rows) {
      if (r.actor?.department) depts.add(r.actor.department)
      if (r.target?.department) depts.add(r.target.department)
    }
    return Array.from(depts)
      .sort()
      .map((d) => ({ value: d, label: d }))
  }, [rows])

  const actorOptions = useMemo(() => {
    const actors = new Set<string>()
    for (const r of rows) {
      const name = r.actor ? `${r.actor.first_name} ${r.actor.last_name}` : "System"
      actors.add(name)
    }
    return Array.from(actors)
      .sort()
      .map((a) => ({ value: a, label: a }))
  }, [rows])

  const dayOptions = useMemo(() => {
    const days = new Set<string>()
    for (const r of rows) {
      days.add(r.created_at.slice(0, 10))
    }
    return Array.from(days)
      .sort()
      .reverse()
      .map((d) => ({ value: d, label: d }))
  }, [rows])

  const columns: DataTableColumn<EnrichedBypassLog>[] = useMemo(
    () => [
      {
        key: "created_at",
        label: "Time",
        sortable: true,
        accessor: (row) => row.created_at,
        resizable: true,
        initialWidth: 200,
        hideOnMobile: true,
        render: (row) => formatWATDateTime(row.created_at),
      },
      {
        key: "bypass_type",
        label: "Bypass Type",
        accessor: (row) => getBypassType(row),
        render: (row) => <Badge variant="outline">{getBypassType(row)}</Badge>,
      },
      {
        key: "requested_by",
        label: "Requested By",
        accessor: (row) => getRequestedBy(row),
        resizable: true,
        initialWidth: 320,
        render: (row) => {
          const orig = row.correspondence?.originator || row.target
          return (
            <div className="flex flex-col text-xs">
              <span className="font-medium">{orig ? `${orig.first_name} ${orig.last_name}` : "System / N/A"}</span>
              <span className="text-muted-foreground">{orig?.company_email || ""}</span>
            </div>
          )
        },
      },
      {
        key: "actor",
        label: "Performed By",
        accessor: (row) => (row.actor ? `${row.actor.first_name} ${row.actor.last_name}` : "System"),
        render: (row) => (
          <div className="flex flex-col text-xs">
            <span className="font-medium">
              {row.actor ? `${row.actor.first_name} ${row.actor.last_name}` : "System"}
            </span>
            <span className="text-muted-foreground">{row.actor?.company_email || ""}</span>
          </div>
        ),
      },
    ],
    []
  )

  const filters: DataTableFilter<EnrichedBypassLog>[] = useMemo(
    () => [
      {
        key: "bypass_type",
        label: "Bypass Type",
        options: bypassTypeOptions,
        mode: "custom",
        filterFn: (row, selectedValues) => {
          const type = getBypassType(row)
          return selectedValues.some((val) => {
            if (val === "LWP") return type.includes("LWP")
            if (val === "AWP") return type.includes("AWP")
            return type === val
          })
        },
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
        mode: "custom",
        filterFn: (row, selectedValues) => {
          const actorDept = row.actor?.department
          const targetDept = row.target?.department
          return selectedValues.some((val) => val === actorDept || val === targetDept)
        },
      },
      {
        key: "person",
        label: "Performed By",
        options: actorOptions,
        mode: "custom",
        filterFn: (row, selectedValues) => {
          const actorName = row.actor ? `${row.actor.first_name} ${row.actor.last_name}` : "System"
          return selectedValues.includes(actorName)
        },
      },
      {
        key: "day",
        label: "Date",
        options: dayOptions,
        mode: "custom",
        filterFn: (row, selectedValues) => {
          const rowDay = row.created_at.slice(0, 10)
          return selectedValues.includes(rowDay)
        },
      },
    ],
    [bypassTypeOptions, departmentOptions, actorOptions, dayOptions]
  )

  const exportCsv = () => {
    const csv = toCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `bypass-override-audit-${toLocalISODate()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DataTablePage
      title="Bypass & Override Audit Logs"
      description="Centralized audit trail of manual policy alterations, emergency bypasses, and validation overrides."
      icon={ShieldAlert}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Total Overrides"
            value={stats.total}
            icon={ShieldAlert}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Emergency Reqs"
            value={stats.emergencyReqs}
            icon={AlertCircle}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            variant="compact"
            title="Attendance Overrides"
            value={stats.attendanceOverrides}
            icon={CalendarRange}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Manual Leaves"
            value={stats.manualLeaves}
            icon={FileText}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      <DataTable<EnrichedBypassLog>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search action, summaries, actors or entities..."
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          const actorName = row.actor ? `${row.actor.first_name} ${row.actor.last_name}` : ""
          const targetName = row.target ? `${row.target.first_name} ${row.target.last_name}` : ""
          return (
            (row.action || "").toLowerCase().includes(q) ||
            (row.operation || "").toLowerCase().includes(q) ||
            (row.entity_type || "").toLowerCase().includes(q) ||
            getBypassSummary(row).toLowerCase().includes(q) ||
            actorName.toLowerCase().includes(q) ||
            targetName.toLowerCase().includes(q) ||
            (row.actor?.company_email || "").toLowerCase().includes(q)
          )
        }}
        error={error}
        expandable={{
          render: (row) => {
            const reason = getBypassReason(row)
            const target = getBypassTarget(row)
            const details = getDetailedChanges(row)

            return (
              <div className="bg-muted/40 space-y-4 rounded-lg border-2 p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground block text-xs font-medium uppercase">Target / Entity</span>
                    <span className="text-foreground text-sm font-semibold">{target}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs font-medium uppercase">Requested By</span>
                    <span className="text-foreground text-sm font-semibold">{getRequestedBy(row)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs font-medium uppercase">IP Address</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {(row.metadata as any)?.ip_address || "Internal / Unknown"}
                    </span>
                  </div>
                </div>

                {reason && (
                  <div>
                    <span className="text-muted-foreground block text-xs font-medium uppercase">
                      Reason / Justification
                    </span>
                    <p className="bg-background mt-1 rounded border p-2 text-xs italic">{reason}</p>
                  </div>
                )}

                {details.length > 0 && (
                  <div>
                    <span className="text-muted-foreground mb-1 block text-xs font-medium uppercase">
                      Detailed Parameters
                    </span>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                      {details.map((d, i) => (
                        <div key={i} className="bg-background rounded border p-2">
                          <span className="text-muted-foreground block text-[10px]">{d.label}</span>
                          <span className="font-semibold">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          },
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (row) =>
            getBypassType(row).includes("Emergency")
              ? "bg-red-500"
              : getBypassType(row).includes("Manual")
                ? "bg-amber-500"
                : "bg-blue-500",
          title: (row) => getBypassSummary(row),
          subtitle: (row) =>
            `${formatWATDateTime(row.created_at)} · By: ${row.actor ? `${row.actor.first_name} ${row.actor.last_name}` : "System"}`,
          trailing: (row) => (
            <Badge variant="outline" className="text-[10px]">
              {getBypassType(row)}
            </Badge>
          ),
        }}
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{getBypassSummary(row)}</p>
                <p className="text-muted-foreground text-xs">{formatWATDateTime(row.created_at)}</p>
              </div>
              <Badge variant="outline">{getBypassType(row)}</Badge>
            </div>
            <div className="grid gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Performed By</span>
                <span>{row.actor ? `${row.actor.first_name} ${row.actor.last_name}` : "System"}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No bypass or override activities found"
        emptyDescription="No manual overrides or workflow bypass events were found in the audit log."
        emptyIcon={ShieldAlert}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
