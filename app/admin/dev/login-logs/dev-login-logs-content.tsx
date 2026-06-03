"use client"

import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Download, RefreshCw, ScrollText, ShieldCheck, UserCheck, Wifi } from "lucide-react"

type DevLoginLogRow = {
  id: string
  email: string
  full_name: string | null
  role: string
  ip_address: string | null
  user_agent: string | null
  auth_method: string | null
  login_at: string
}

function toCsv(rows: DevLoginLogRow[]) {
  const headers = ["time", "email", "name", "role", "ip", "auth_method", "user_agent"]
  const body = rows.map((row) => [
    row.login_at,
    row.email,
    row.full_name || "",
    row.role,
    row.ip_address || "",
    row.auth_method || "",
    row.user_agent || "",
  ])
  const escaped = [headers, ...body].map((line) =>
    line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  )
  return escaped.join("\n")
}

async function fetchDevLoginLogs(): Promise<DevLoginLogRow[]> {
  const response = await fetch("/api/admin/dev/login-logs", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load logs (${response.status})`)
  }
  return (payload?.data || []) as DevLoginLogRow[]
}

export function DevLoginLogsContent() {
  const queryClient = useQueryClient()

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.devLoginLogs(),
    queryFn: fetchDevLoginLogs,
  })

  const roleOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.role).filter((role): role is string => Boolean(role))))
        .sort()
        .map((role) => ({
          value: role,
          label: role,
        })),
    [rows]
  )

  const methodOptions = useMemo(
    () =>
      Array.from(
        new Set(rows.map((row) => row.auth_method || "unknown").filter((method): method is string => Boolean(method)))
      )
        .sort()
        .map((method) => ({
          value: method,
          label: method,
        })),
    [rows]
  )

  const dateOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.login_at.slice(0, 10))))
        .sort()
        .reverse()
        .map((date) => ({
          value: date,
          label: formatWATDate(`${date}T00:00:00`, { day: "2-digit", month: "short", year: "numeric" }),
        })),
    [rows]
  )

  const stats = useMemo(() => {
    const total = rows.length
    const uniqueUsers = new Set(rows.map((row) => row.email)).size
    const uniqueIps = new Set(rows.map((row) => row.ip_address).filter(Boolean)).size
    const passwordLogins = rows.filter((row) => (row.auth_method || "unknown") === "password").length

    return { total, uniqueUsers, uniqueIps, passwordLogins }
  }, [rows])

  const columns = useMemo<DataTableColumn<DevLoginLogRow>[]>(
    () => [
      {
        key: "login_at",
        label: "Time",
        sortable: true,
        accessor: (row) => row.login_at,
        resizable: true,
        initialWidth: 220,
        hideOnMobile: true,
        render: (row) => formatWATDateTime(row.login_at),
      },
      {
        key: "full_name",
        label: "Person",
        sortable: true,
        accessor: (row) => row.full_name || row.email,
        render: (row) => (
          <div className="space-y-1">
            <p className="font-medium">{row.full_name || "Unknown"}</p>
            <p className="text-muted-foreground text-xs">{row.email}</p>
          </div>
        ),
      },
      {
        key: "role",
        label: "Role",
        sortable: true,
        accessor: (row) => row.role,
        render: (row) => <Badge variant="outline">{row.role}</Badge>,
      },
      {
        key: "ip_address",
        label: "IP Address",
        accessor: (row) => row.ip_address || "",
        hideOnMobile: true,
        render: (row) => row.ip_address || "-",
      },
      {
        key: "auth_method",
        label: "Method",
        accessor: (row) => row.auth_method || "unknown",
        hideOnMobile: true,
        render: (row) => row.auth_method || "unknown",
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<DevLoginLogRow>[]>(
    () => [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
      },
      {
        key: "auth_method",
        label: "Auth Method",
        options: methodOptions,
      },
      {
        key: "login_date",
        label: "Date",
        mode: "custom",
        options: dateOptions,
        filterFn: (row, value) => {
          const rowDate = row.login_at.slice(0, 10)
          if (Array.isArray(value)) {
            return value.includes(rowDate)
          }
          return rowDate === value
        },
      },
    ],
    [dateOptions, methodOptions, roleOptions]
  )

  const exportCsv = () => {
    const csv = toCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `dev-login-logs-${new Date().toISOString()}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Events"
          value={stats.total}
          icon={ScrollText}
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Unique Users"
          value={stats.uniqueUsers}
          icon={UserCheck}
          iconBgColor="bg-emerald-500/10"
          iconColor="text-emerald-500"
        />
        <StatCard
          title="Unique IPs"
          value={stats.uniqueIps}
          icon={Wifi}
          iconBgColor="bg-amber-500/10"
          iconColor="text-amber-500"
        />
        <StatCard
          title="Password Logins"
          value={stats.passwordLogins}
          icon={ShieldCheck}
          iconBgColor="bg-violet-500/10"
          iconColor="text-violet-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.devLoginLogs() })}
          disabled={isLoading}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Button onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <DataTable<DevLoginLogRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search person, email, IP address, or user agent..."
        searchFn={(row, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            (row.full_name || "").toLowerCase().includes(normalizedQuery) ||
            row.email.toLowerCase().includes(normalizedQuery) ||
            (row.ip_address || "").toLowerCase().includes(normalizedQuery) ||
            (row.user_agent || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Email</p>
                <p className="mt-2 text-sm">{row.email}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">IP Address</p>
                <p className="mt-2 text-sm">{row.ip_address || "-"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">User Agent</p>
                <p className="mt-2 text-sm break-words">{row.user_agent || "Unavailable"}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{row.full_name || "Unknown"}</p>
                <p className="text-muted-foreground text-sm">{row.email}</p>
              </div>
              <Badge variant="outline">{row.role}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Method</span>
                <span>{row.auth_method || "unknown"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IP</span>
                <span>{row.ip_address || "-"}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No login logs found"
        emptyDescription="Developer login events will appear here once sign-ins are recorded."
        emptyIcon={ScrollText}
        skeletonRows={5}
        urlSync
      />
    </div>
  )
}
