"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { Globe, ShieldCheck, Users, Clock, Download, Building2, AlertTriangle, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  buildNetworkActivityExportRows,
  exportNetworkActivityToExcel,
  exportNetworkActivityToPDF,
  formatBytes,
  type NetworkActivityRowForExport,
} from "@/lib/security/network-activity-export"
import {
  NETWORK_ACTIVITY_CATEGORY_LABELS,
  type NetworkActivityCategory,
} from "@/lib/security/network-activity-classify"

const log = logger("admin-security-network-activity")

interface EmployeeOption {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

interface DepartmentOption {
  id: string
  name: string
}

interface NetworkActivityBandwidth {
  bytes_in: number
  bytes_out: number
  snapshot_at: string
}

interface NetworkActivityRecord {
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
  employee_first_name: string | null
  employee_last_name: string | null
  employee_email: string | null
  employee_department: string | null
  category: NetworkActivityCategory
  bandwidth: NetworkActivityBandwidth | null
}

const CATEGORY_FILTER_OPTIONS = [
  { value: "normal", label: NETWORK_ACTIVITY_CATEGORY_LABELS.normal },
  { value: "review", label: NETWORK_ACTIVITY_CATEGORY_LABELS.review },
  { value: "system_noise", label: NETWORK_ACTIVITY_CATEGORY_LABELS.system_noise },
]

// Default view hides system/background noise — real signal only, until the
// admin explicitly opts into seeing it.
const DEFAULT_CATEGORY_FILTER_VALUES = ["normal", "review"]

const MATCH_STATUS_FILTER_OPTIONS = [
  { value: "matched", label: "Matched to Employee" },
  { value: "unmatched", label: "Unmatched (e.g. tv, security)" },
]

// Default shows both — rows from hotspot accounts that aren't a real employee
// email (shared/device accounts like "tv" or "security") are visible by
// default, per the requirement that nothing gets silently dropped. This
// filter just lets an admin narrow to employees-only when they want to.
const DEFAULT_MATCH_STATUS_FILTER_VALUES = ["matched", "unmatched"]

function ReviewBadge() {
  return (
    <Badge className="border-transparent bg-amber-500/10 text-amber-600 hover:bg-amber-500/10">
      <AlertTriangle className="mr-1 h-3 w-3" />
      Review
    </Badge>
  )
}

// Distinct styling from ReviewBadge (violet vs amber) — a brand-new device
// on the network is a different kind of signal (identity/rogue-device
// alert) than a "worth a second look" domain, so it should read differently
// at a glance while following the same badge pattern.
function NewDeviceBadge() {
  return (
    <Badge className="border-transparent bg-violet-500/10 text-violet-600 hover:bg-violet-500/10">
      <ShieldAlert className="mr-1 h-3 w-3" />
      New Device
    </Badge>
  )
}

function employeeLabel(employee: EmployeeOption) {
  const name = [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Unknown"
  return employee.department ? `${name} (${employee.department})` : name
}

function formatVisitedAt(value: string) {
  return formatWATDate(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function whoName(record: NetworkActivityRecord): string {
  return [record.employee_first_name, record.employee_last_name].filter(Boolean).join(" ")
}

async function fetchEmployees(): Promise<EmployeeOption[]> {
  const res = await fetch("/api/hr/performance/employees", { cache: "no-store" })
  const payload = (await res.json().catch(() => null)) as { data?: EmployeeOption[]; error?: string } | null
  if (!res.ok) throw new Error(payload?.error || "Failed to load employees")
  return payload?.data || []
}

async function fetchDepartments(): Promise<DepartmentOption[]> {
  const res = await fetch("/api/departments", { cache: "no-store" })
  const payload = (await res.json().catch(() => null)) as { data?: DepartmentOption[]; error?: string } | null
  if (!res.ok) throw new Error(payload?.error || "Failed to load departments")
  return payload?.data || []
}

export function AdminSecurityNetworkActivityPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  // Defaults to today, everyone — no gating on a pre-selected employee.
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("")
  const [dateRange, setDateRange] = useState({
    start_date: toLocalISODate(),
    end_date: toLocalISODate(),
  })
  const [timeRange, setTimeRange] = useState({ start_time: "", end_time: "" })
  const [records, setRecords] = useState<NetworkActivityRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [filteredForExport, setFilteredForExport] = useState<NetworkActivityRecord[]>([])

  const { data: employees = [] } = useQuery({
    queryKey: QUERY_KEYS.adminSecurityEmployees(),
    queryFn: fetchEmployees,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
  })

  const employeeOptions = useMemo(
    () => employees.map((employee) => ({ value: employee.id, label: employeeLabel(employee) })),
    [employees]
  )

  const departmentOptions = useMemo(
    () => departments.map((dept) => ({ value: dept.id, label: dept.name })),
    [departments]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
      })
      for (const id of selectedUserIds) params.append("user_id", id)
      if (selectedDepartmentId) params.set("department_id", selectedDepartmentId)
      if (timeRange.start_time) params.set("start_time", timeRange.start_time)
      if (timeRange.end_time) params.set("end_time", timeRange.end_time)

      const res = await fetch(`/api/admin/security/network-activity?${params}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load network activity")
      setRecords(payload.records || [])
    } catch (err) {
      log.error("Failed to load network activity", err)
      const message = err instanceof Error ? err.message : "Failed to load network activity"
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [
    selectedUserIds,
    selectedDepartmentId,
    dateRange.start_date,
    dateRange.end_date,
    timeRange.start_time,
    timeRange.end_time,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const uniqueDomains = useMemo(() => new Set(records.map((r) => r.domain)).size, [records])
  const uniquePeople = useMemo(
    () => new Set(records.map((r) => r.user_id || r.matched_identifier)).size,
    [records]
  )
  const reviewCount = useMemo(
    () => filteredForExport.filter((r) => r.category === "review").length,
    [filteredForExport]
  )

  const columns: DataTableColumn<NetworkActivityRecord>[] = [
    {
      key: "who",
      label: "Who",
      sortable: true,
      accessor: (r) => whoName(r) || r.matched_identifier,
      render: (r) => {
        const name = whoName(r)
        return (
          <div>
            <div className="font-medium">{name || r.matched_identifier}</div>
            {name && r.employee_email && <div className="text-muted-foreground text-xs">{r.employee_email}</div>}
            {!name && <div className="text-muted-foreground text-xs">Unresolved identifier</div>}
          </div>
        )
      },
      initialWidth: 200,
      resizable: true,
    },
    {
      key: "visited_at",
      label: "Visited At",
      sortable: true,
      accessor: (r) => r.visited_at,
      render: (r) => <span className="font-medium">{formatVisitedAt(r.visited_at)}</span>,
      initialWidth: 200,
      resizable: true,
    },
    {
      key: "domain",
      label: "Domain",
      sortable: true,
      accessor: (r) => r.domain,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{r.domain}</span>
          {r.category === "review" && <ReviewBadge />}
          {r.is_new_device && <NewDeviceBadge />}
        </div>
      ),
      resizable: true,
      initialWidth: 220,
    },
    {
      key: "employee_department",
      label: "Department",
      sortable: true,
      accessor: (r) => r.employee_department ?? "",
      render: (r) => r.employee_department || <span className="text-muted-foreground">-</span>,
      hideOnMobile: true,
    },
    {
      key: "source_ip",
      label: "Source IP",
      sortable: true,
      accessor: (r) => r.source_ip ?? "",
      render: (r) => r.source_ip || <span className="text-muted-foreground">-</span>,
      hideOnMobile: true,
    },
  ]

  // Employee/department/date/time filters are wired as `mode: "custom"` because
  // they drive a server request (via `load`) rather than filtering the already
  // -fetched `records` client-side. Each `render` still calls the `onChange`
  // passed in by DataTable so the selection lands in DataTable's own
  // `filterValues` state — that's what makes the built-in active-filter-pills
  // row (and "Clear all") pick these up automatically instead of needing a
  // hand-rolled pill row. `options` on each filter provides the label lookup
  // the pills use to render human-readable text.
  const tableFilters: DataTableFilter<NetworkActivityRecord>[] = [
    {
      key: "category",
      label: "Category",
      options: CATEGORY_FILTER_OPTIONS,
      placeholder: "All Categories",
      icon: <AlertTriangle className="text-muted-foreground h-4 w-4" />,
      mode: "custom",
      filterFn: (row, selected) => selected.includes(row.category),
      // Client-side filter over already-fetched records. Defaults to
      // Normal + Review so System/Background noise stays hidden until
      // explicitly selected.
      defaultValues: DEFAULT_CATEGORY_FILTER_VALUES,
    },
    {
      key: "match_status",
      label: "Match Status",
      options: MATCH_STATUS_FILTER_OPTIONS,
      placeholder: "All",
      icon: <Users className="text-muted-foreground h-4 w-4" />,
      mode: "custom",
      filterFn: (row, selected) => selected.includes(row.user_id ? "matched" : "unmatched"),
      // Client-side filter over already-fetched records — shows both by
      // default so shared/device hotspot accounts (no employee email match)
      // are visible, not silently dropped; this only lets an admin narrow
      // down to employees-only when they want a clean view.
      defaultValues: DEFAULT_MATCH_STATUS_FILTER_VALUES,
    },
    {
      key: "employee",
      label: "Employee",
      options: employeeOptions,
      placeholder: "All Employees",
      mode: "custom",
      filterFn: () => true,
      render: (_values, onChange) => (
        <SearchableMultiSelect
          label="Employee"
          icon={<Users className="text-muted-foreground h-4 w-4" />}
          values={selectedUserIds}
          options={employeeOptions}
          onChange={(vals) => {
            setSelectedUserIds(vals)
            onChange(vals)
          }}
          placeholder="All Employees"
          searchPlaceholder="Search employee..."
        />
      ),
    },
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
      mode: "custom",
      filterFn: () => true,
      render: (_values, onChange) => (
        <SearchableMultiSelect
          label="Department"
          icon={<Building2 className="text-muted-foreground h-4 w-4" />}
          values={selectedDepartmentId ? [selectedDepartmentId] : []}
          options={departmentOptions}
          onChange={(vals) => {
            const next = vals[0] || ""
            setSelectedDepartmentId(next)
            onChange(next ? [next] : [])
          }}
          placeholder="All Departments"
          searchPlaceholder="Search department..."
        />
      ),
    },
    {
      key: "start_date",
      label: "Start Date",
      options: dateRange.start_date ? [{ value: dateRange.start_date, label: dateRange.start_date }] : [],
      mode: "custom",
      filterFn: () => true,
      render: (_values, onChange) => (
        <Input
          type="date"
          aria-label="Start Date"
          value={dateRange.start_date}
          onChange={(e) => {
            const next = e.target.value
            setDateRange((f) => ({ ...f, start_date: next }))
            onChange(next ? [next] : [])
          }}
        />
      ),
    },
    {
      key: "end_date",
      label: "End Date",
      options: dateRange.end_date ? [{ value: dateRange.end_date, label: dateRange.end_date }] : [],
      mode: "custom",
      filterFn: () => true,
      render: (_values, onChange) => (
        <Input
          type="date"
          aria-label="End Date"
          value={dateRange.end_date}
          onChange={(e) => {
            const next = e.target.value
            setDateRange((f) => ({ ...f, end_date: next }))
            onChange(next ? [next] : [])
          }}
        />
      ),
    },
    {
      key: "start_time",
      label: "Start Time",
      options: timeRange.start_time ? [{ value: timeRange.start_time, label: timeRange.start_time }] : [],
      mode: "custom",
      filterFn: () => true,
      render: (_values, onChange) => (
        <Input
          type="time"
          aria-label="Start Time"
          value={timeRange.start_time}
          onChange={(e) => {
            const next = e.target.value
            setTimeRange((f) => ({ ...f, start_time: next }))
            onChange(next ? [next] : [])
          }}
        />
      ),
    },
    {
      key: "end_time",
      label: "End Time",
      options: timeRange.end_time ? [{ value: timeRange.end_time, label: timeRange.end_time }] : [],
      mode: "custom",
      filterFn: () => true,
      render: (_values, onChange) => (
        <Input
          type="time"
          aria-label="End Time"
          value={timeRange.end_time}
          onChange={(e) => {
            const next = e.target.value
            setTimeRange((f) => ({ ...f, end_time: next }))
            onChange(next ? [next] : [])
          }}
        />
      ),
    },
  ]

  // Keeps local filter state (which actually drives the API request) in sync
  // when a pill's × or "Clear all" resets DataTable's internal `filterValues`.
  // DataTable owns the pills; this is the one bridge back to our state.
  function handleDataTableFilterChange(values: Record<string, string[]>) {
    if (!("employee" in values) && selectedUserIds.length > 0) setSelectedUserIds([])
    if (!("department" in values) && selectedDepartmentId) setSelectedDepartmentId("")
    if (!("start_date" in values) && dateRange.start_date !== toLocalISODate()) {
      setDateRange((f) => ({ ...f, start_date: toLocalISODate() }))
    }
    if (!("end_date" in values) && dateRange.end_date !== toLocalISODate()) {
      setDateRange((f) => ({ ...f, end_date: toLocalISODate() }))
    }
    if (!("start_time" in values) && timeRange.start_time) setTimeRange((f) => ({ ...f, start_time: "" }))
    if (!("end_time" in values) && timeRange.end_time) setTimeRange((f) => ({ ...f, end_time: "" }))
  }

  function handleExportSelect(id: string) {
    const rows: NetworkActivityRowForExport[] = filteredForExport.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      matched_identifier: r.matched_identifier,
      domain: r.domain,
      source_ip: r.source_ip,
      visited_at: r.visited_at,
      raw_url: r.raw_url,
      device_hostname: r.device_hostname,
      mac_address: r.mac_address,
      device_vendor: r.device_vendor,
      is_new_device: r.is_new_device,
      user_agent: r.user_agent,
      browser: r.browser,
      os: r.os,
      employee_first_name: r.employee_first_name,
      employee_last_name: r.employee_last_name,
      employee_email: r.employee_email,
      employee_department: r.employee_department,
      category: r.category,
      bandwidth: r.bandwidth,
    }))
    const exportRows = buildNetworkActivityExportRows(rows)
    const filename = `network-activity-export-${dateRange.start_date}-to-${dateRange.end_date}`
    if (exportRows.length === 0) {
      toast.error("No rows to export")
      return
    }
    if (id === "excel") void exportNetworkActivityToExcel(exportRows, filename)
    else if (id === "pdf") void exportNetworkActivityToPDF(exportRows, filename, { total: exportRows.length })
  }

  return (
    <DataTablePage
      title="Network Activity"
      description="View domain-visit history sourced from the office network proxy."
      icon={ShieldCheck}
      backLink={{ href: backLinkHref ?? "/admin/security", label: "Back to Security" }}
      actions={
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={filteredForExport.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
          <StatCard
            title="Total Visits"
            value={records.length}
            icon={Globe}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Unique Domains"
            value={uniqueDomains}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="People"
            value={uniquePeople}
            icon={Users}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Flagged for Review"
            value={reviewCount}
            icon={AlertTriangle}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Date Range"
            value={
              dateRange.start_date === dateRange.end_date
                ? dateRange.start_date
                : `${dateRange.start_date} to ${dateRange.end_date}`
            }
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<NetworkActivityRecord>
        data={records}
        columns={columns}
        filters={tableFilters}
        onProcessedDataChange={setFilteredForExport}
        onFilterChange={handleDataTableFilterChange}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search domain, source IP, device, or name..."
        searchFn={(r, q) =>
          [r.domain, r.source_ip || "", r.device_hostname || "", whoName(r), r.matched_identifier, r.employee_email || ""]
            .join(" ")
            .toLowerCase()
            .includes(q)
        }
        isLoading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No network activity found"
        emptyDescription="Adjust the filters and try again."
        emptyIcon={Globe}
        skeletonRows={8}
        expandable={{
          render: (r) => (
            <div className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Source IP</div>
                <div>{r.source_ip || "-"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Device Hostname</div>
                <div>{r.device_hostname || "-"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">MAC Address</div>
                <div>
                  {r.mac_address || "-"}
                  {r.mac_address && r.device_vendor && (
                    <span className="text-muted-foreground"> ({r.device_vendor})</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Browser / OS</div>
                <div>{r.browser || r.os ? [r.browser, r.os].filter(Boolean).join(" / ") : "-"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Bandwidth (In / Out)</div>
                <div>
                  {r.bandwidth ? `${formatBytes(r.bandwidth.bytes_in)} / ${formatBytes(r.bandwidth.bytes_out)}` : "-"}
                </div>
                {r.bandwidth && (
                  <div className="text-muted-foreground text-xs">
                    as of {formatWATDate(r.bandwidth.snapshot_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Exact Timestamp</div>
                <div>{formatWATDate(r.visited_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Department</div>
                <div>{r.employee_department || "-"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">Matched Identifier</div>
                <div className="font-mono text-xs">{r.matched_identifier}</div>
              </div>
              {r.raw_url && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="text-muted-foreground text-xs font-medium uppercase">Raw URL</div>
                  <div className="break-all font-mono text-xs">{r.raw_url}</div>
                </div>
              )}
              {r.user_agent && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="text-muted-foreground text-xs font-medium uppercase">User Agent</div>
                  <div className="break-all font-mono text-xs">{r.user_agent}</div>
                </div>
              )}
            </div>
          ),
        }}
      />

      <ExportOptionsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Network Activity"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
        ]}
        onSelect={handleExportSelect}
      />
    </DataTablePage>
  )
}
