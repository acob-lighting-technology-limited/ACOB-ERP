"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatWATDate, formatWATDateTime, formatWATRelative } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Download, RefreshCw, ScrollText, ShieldCheck, UserCheck, Wifi } from "lucide-react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type DevLoginLogRow = {
  id: string
  user_id: string | null
  email: string
  full_name: string | null
  role: string
  department: string | null
  ip_address: string | null
  user_agent: string | null
  auth_method: string | null
  login_at: string
}

function toCsv(rows: DevLoginLogRow[]) {
  const headers = ["time", "email", "name", "role", "department", "ip", "auth_method", "user_agent"]
  const body = rows.map((row) => [
    row.login_at,
    row.email,
    row.full_name || "",
    row.role,
    row.department || "",
    row.ip_address || "",
    row.auth_method || "",
    row.user_agent || "",
  ])
  const escaped = [headers, ...body].map((line) =>
    line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  )
  return escaped.join("\n")
}

type DevLoginLogsMeta = {
  days: number | null
  limit: number
  truncated: boolean
}

type DevLoginLogsPayload = {
  rows: DevLoginLogRow[]
  meta: DevLoginLogsMeta | null
}

async function fetchDevLoginLogs(days: string): Promise<DevLoginLogsPayload> {
  const response = await fetch(`/api/admin/dev/login-logs?days=${days}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load logs (${response.status})`)
  }
  return {
    rows: (payload?.data || []) as DevLoginLogRow[],
    meta: (payload?.meta as DevLoginLogsMeta | undefined) ?? null,
  }
}

async function fetchDashboardAuditLogs(department: string, userId: string | null): Promise<any[]> {
  const url = `/api/admin/dev/login-logs?type=dashboard-audit&department=${department}&user_id=${userId || "all"}`
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load dashboard audit logs (${response.status})`)
  }
  return (payload?.data || []) as any[]
}

const CHART_COLORS = [
  "var(--primary)",
  "oklch(0.65 0.15 250)",
  "oklch(0.7 0.12 85)",
  "oklch(0.6 0.18 300)",
  "oklch(0.65 0.15 142)",
]

// Custom tooltips matching shadcn styling
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card rounded-lg border border-2 p-3 text-sm shadow-md">
        <p className="text-foreground font-semibold">{label}</p>
        {payload.map((item: any) => (
          <p key={item.name} className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color || item.fill }}
            />
            {item.name}: <span className="text-foreground font-medium">{item.value}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

// User-specific statistics detail view inside the dialog
function UserStatsView({
  email,
  userId,
  allLogs,
}: {
  email: string
  userId: string | null
  allLogs: DevLoginLogRow[]
}) {
  const userLogs = useMemo(() => allLogs.filter((log) => log.email === email), [email, allLogs])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  useEffect(() => {
    if (!userId) return
    setLoadingAudit(true)
    fetch(`/api/admin/dev/login-logs?type=audit&user_id=${userId}`)
      .then((res) => res.json())
      .then((payload) => {
        setAuditLogs(payload.data || [])
      })
      .catch((err) => console.error(err))
      .finally(() => setLoadingAudit(false))
  }, [userId])

  const userStats = useMemo(() => {
    const total = userLogs.length
    const firstLogin = userLogs.length > 0 ? userLogs[userLogs.length - 1].login_at : null
    const lastLogin = userLogs.length > 0 ? userLogs[0].login_at : null
    const uniqueDays = new Set(userLogs.map((log) => log.login_at.slice(0, 10))).size

    const methodCounts = new Map<string, number>()
    const ipCounts = new Map<string, number>()
    const uaCounts = new Map<string, number>()
    const hourly = new Array(24).fill(0)

    userLogs.forEach((log) => {
      const method = log.auth_method || "unknown"
      methodCounts.set(method, (methodCounts.get(method) || 0) + 1)

      if (log.ip_address) {
        ipCounts.set(log.ip_address, (ipCounts.get(log.ip_address) || 0) + 1)
      }

      if (log.user_agent) {
        const ua = log.user_agent.toLowerCase()
        let browser = "Other"
        if (ua.includes("edg/")) browser = "Edge"
        else if (ua.includes("chrome/")) browser = "Chrome"
        else if (ua.includes("safari/") && !ua.includes("chrome/")) browser = "Safari"
        else if (ua.includes("firefox/")) browser = "Firefox"
        uaCounts.set(browser, (uaCounts.get(browser) || 0) + 1)
      }

      try {
        const hour = new Date(log.login_at).getHours()
        if (hour >= 0 && hour < 24) {
          hourly[hour] += 1
        }
      } catch (e) {}
    })

    const preferredMethod = Array.from(methodCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown"
    const ips = Array.from(ipCounts.entries())
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
    const browsers = Array.from(uaCounts.entries()).map(([browser, count]) => ({ name: browser, value: count }))
    const hourlyChartData = hourly.map((count, hour) => ({ hour: `${String(hour).padStart(2, "0")}:00`, count }))

    return { total, firstLogin, lastLogin, uniqueDays, preferredMethod, ips, browsers, hourlyChartData }
  }, [userLogs])

  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-muted/30 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Total Logins</p>
          <p className="mt-1 text-xl font-bold">{userStats.total}</p>
        </div>
        <div className="bg-muted/30 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Active Days</p>
          <p className="mt-1 text-xl font-bold">{userStats.uniqueDays}</p>
        </div>
        <div className="bg-muted/30 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Primary Method</p>
          <p className="mt-1 text-sm font-semibold capitalize">{userStats.preferredMethod.replace(/_/g, " ")}</p>
        </div>
        <div className="bg-muted/30 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">First Login</p>
          <p className="text-muted-foreground mt-1 truncate text-xs font-semibold">
            {userStats.firstLogin
              ? formatWATDate(userStats.firstLogin, { day: "2-digit", month: "short", year: "2-digit" })
              : "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="bg-card rounded-xl border p-4">
          <h4 className="mb-3 text-sm font-semibold">Activity by Hour</h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={userStats.hourlyChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <XAxis dataKey="hour" tickLine={false} axisLine={false} className="text-[10px]" />
                <YAxis tickLine={false} axisLine={false} className="text-[10px]" />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.15}
                  name="Logins"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card space-y-4 rounded-xl border p-4">
          <div>
            <h4 className="mb-2 text-sm font-semibold">Used IP Addresses</h4>
            <div className="scrollbar-custom max-h-20 space-y-1.5 overflow-y-auto pr-1 text-xs">
              {userStats.ips.slice(0, 3).map((item) => (
                <div key={item.ip} className="text-muted-foreground flex items-center justify-between">
                  <span className="text-foreground font-mono">{item.ip}</span>
                  <span>{item.count} logins</span>
                </div>
              ))}
              {userStats.ips.length === 0 && <p className="text-muted-foreground">No IPs logged</p>}
            </div>
          </div>
          <div className="border-t pt-3">
            <h4 className="mb-2 text-sm font-semibold">Browser Distribution</h4>
            <div className="flex flex-wrap gap-2">
              {userStats.browsers.map((item) => (
                <Badge key={item.name} variant="secondary" className="text-xs">
                  {item.name}: {item.value}
                </Badge>
              ))}
              {userStats.browsers.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
            </div>
          </div>
        </div>

        <div className="bg-card col-span-full space-y-4 rounded-xl border p-4">
          <h4 className="mb-2 text-sm font-semibold">Audit History & Visited Sections</h4>
          {loadingAudit ? (
            <div className="space-y-2 py-4">
              <div className="bg-muted h-4 w-3/4 animate-pulse rounded"></div>
              <div className="bg-muted h-4 w-1/2 animate-pulse rounded"></div>
            </div>
          ) : auditLogs.length > 0 ? (
            <div className="scrollbar-custom max-h-48 space-y-3 overflow-y-auto pr-1 text-xs">
              {auditLogs.slice(0, 8).map((log) => {
                const route =
                  (log.metadata?.path as string) || (log.metadata?.url as string) || `/${log.entity_type || ""}`
                return (
                  <div key={log.id} className="flex items-start justify-between border-b pb-2 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">
                          {log.action}
                        </Badge>
                        <span className="text-foreground font-medium capitalize">
                          {log.entity_type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-muted-foreground font-mono text-[10px]">{route}</p>
                    </div>
                    <span className="text-muted-foreground text-[10px]">{formatWATRelative(log.created_at)}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-muted-foreground py-4 text-center text-xs">No recent actions recorded in audit logs.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function DevLoginLogsContent() {
  const queryClient = useQueryClient()
  const [filterMode, setFilterMode] = useState<"time" | "date" | "month" | "cycle" | "biannual" | "annual">("time")
  const [timeRange, setTimeRange] = useState<string>("90")
  const [selectedDateRange, setSelectedDateRange] = useState<{ from: string; to: string }>({ from: "", to: "" })
  const [selectedMonth, setSelectedMonth] = useState<string>("")
  const [selectedCycle, setSelectedCycle] = useState<string>("")
  const [selectedBiannual, setSelectedBiannual] = useState<string>("")
  const [selectedAnnual, setSelectedAnnual] = useState<string>("")

  const [selectedDept, setSelectedDept] = useState<string>("all")
  const [selectedUser, setSelectedUser] = useState<string>("all")
  const [selectedRowForStats, setSelectedRowForStats] = useState<DevLoginLogRow | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.devLoginLogs(),
    queryFn: () => fetchDevLoginLogs("all"),
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const meta = data?.meta ?? null

  // Option extractors based on ALL raw rows
  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.department).filter((d): d is string => Boolean(d))))
        .sort()
        .map((dept) => ({ value: dept, label: dept })),
    [rows]
  )

  const individualOptions = useMemo(() => {
    const usersMap = new Map<string, string>()
    rows.forEach((row) => {
      usersMap.set(row.email, row.full_name || row.email)
    })
    return Array.from(usersMap.entries())
      .map(([email, name]) => ({ value: email, label: `${name} (${email})` }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const selectedUserId = useMemo(() => {
    if (selectedUser === "all") return null
    return rows.find((r) => r.email === selectedUser)?.user_id ?? null
  }, [selectedUser, rows])

  const { data: auditLogsData, isLoading: isLoadingAudit } = useQuery({
    queryKey: ["dev-login-logs-audit", selectedDept, selectedUserId],
    queryFn: () => fetchDashboardAuditLogs(selectedDept, selectedUserId),
    enabled: rows.length > 0,
  })

  const topRoutes = useMemo(() => {
    if (!auditLogsData) return []
    const routeCounts = new Map<string, { count: number; action: string; entity: string }>()

    auditLogsData.forEach((log) => {
      let route = (log.metadata?.path as string) || (log.metadata?.url as string) || `/${log.entity_type || ""}`
      if (route.includes("?")) {
        route = route.split("?")[0]
      }
      const key = `${log.action}:${route}`
      const existing = routeCounts.get(key)
      if (existing) {
        existing.count += 1
      } else {
        routeCounts.set(key, { count: 1, action: log.action, entity: log.entity_type })
      }
    })

    return Array.from(routeCounts.entries())
      .map(([key, val]) => {
        const [action, route] = key.split(":")
        return { action, route, count: val.count, entity: val.entity }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [auditLogsData])

  // Dynamic options generators based on raw rows
  const monthOptions = useMemo(() => {
    const months = new Set<string>()
    rows.forEach((row) => {
      if (row.login_at) {
        months.add(row.login_at.slice(0, 7))
      }
    })
    return Array.from(months)
      .sort()
      .reverse()
      .map((m) => {
        const [year, monthStr] = m.split("-")
        const date = new Date(Number(year), Number(monthStr) - 1, 1)
        const label = date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        return { value: m, label }
      })
  }, [rows])

  const cycleOptions = useMemo(() => {
    const cycles = new Set<string>()
    rows.forEach((row) => {
      const d = new Date(row.login_at)
      if (!isNaN(d.getTime())) {
        const q = Math.ceil((d.getMonth() + 1) / 3)
        cycles.add(`Q${q}-${d.getFullYear()}`)
      }
    })
    return Array.from(cycles)
      .sort()
      .reverse()
      .map((c) => {
        const [q, y] = c.split("-")
        return { value: c, label: `${q} ${y}` }
      })
  }, [rows])

  const biannualOptions = useMemo(() => {
    const halves = new Set<string>()
    rows.forEach((row) => {
      const d = new Date(row.login_at)
      if (!isNaN(d.getTime())) {
        const h = d.getMonth() + 1 <= 6 ? 1 : 2
        halves.add(`H${h}-${d.getFullYear()}`)
      }
    })
    return Array.from(halves)
      .sort()
      .reverse()
      .map((h) => {
        const [half, y] = h.split("-")
        return { value: h, label: `${half === "H1" ? "First Half (H1)" : "Second Half (H2)"} ${y}` }
      })
  }, [rows])

  const annualOptions = useMemo(() => {
    const years = new Set<string>()
    rows.forEach((row) => {
      const d = new Date(row.login_at)
      if (!isNaN(d.getTime())) {
        years.add(String(d.getFullYear()))
      }
    })
    return Array.from(years)
      .sort()
      .reverse()
      .map((y) => ({ value: y, label: y }))
  }, [rows])

  // Filter rows statefully by Dept, User and multi-mode Date filter
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // 1. Department Filter
      const matchDept = selectedDept === "all" || row.department === selectedDept

      // 2. Individual User Filter
      const matchUser = selectedUser === "all" || row.email === selectedUser

      if (!matchDept || !matchUser) return false

      // 3. Date/Time Filter Mode
      const rowDate = new Date(row.login_at)
      if (isNaN(rowDate.getTime())) return false

      if (filterMode === "time") {
        if (timeRange === "all") return true
        const days = Number.parseInt(timeRange, 10)
        if (isNaN(days)) return true
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        return rowDate >= cutoff
      }

      if (filterMode === "date") {
        const rowDateStr = row.login_at.slice(0, 10) // YYYY-MM-DD
        const { from, to } = selectedDateRange
        if (from && rowDateStr < from) return false
        if (to && rowDateStr > to) return false
        return true
      }

      if (filterMode === "month") {
        if (!selectedMonth) return true
        const rowMonth = row.login_at.slice(0, 7) // YYYY-MM
        return rowMonth === selectedMonth
      }

      if (filterMode === "cycle") {
        if (!selectedCycle) return true
        const month = rowDate.getMonth() + 1
        const year = rowDate.getFullYear()
        const quarter = Math.ceil(month / 3)
        const rowCycle = `Q${quarter}-${year}`
        return rowCycle === selectedCycle
      }

      if (filterMode === "biannual") {
        if (!selectedBiannual) return true
        const month = rowDate.getMonth() + 1
        const year = rowDate.getFullYear()
        const half = month <= 6 ? 1 : 2
        const rowHalf = `H${half}-${year}`
        return rowHalf === selectedBiannual
      }

      if (filterMode === "annual") {
        if (!selectedAnnual) return true
        const rowYear = String(rowDate.getFullYear())
        return rowYear === selectedAnnual
      }

      return true
    })
  }, [
    rows,
    selectedDept,
    selectedUser,
    filterMode,
    timeRange,
    selectedDateRange,
    selectedMonth,
    selectedCycle,
    selectedBiannual,
    selectedAnnual,
  ])

  const stats = useMemo(() => {
    const total = filteredRows.length
    const uniqueUsers = new Set(filteredRows.map((row) => row.email)).size
    const uniqueIps = new Set(filteredRows.map((row) => row.ip_address).filter(Boolean)).size
    const passwordLogins = filteredRows.filter((row) => (row.auth_method || "unknown") === "password").length

    return { total, uniqueUsers, uniqueIps, passwordLogins }
  }, [filteredRows])

  // Chart data calculations
  const chartData = useMemo(() => {
    const timelineMap = new Map<string, number>()
    const methodMap = new Map<string, number>()
    const hourlyMap = new Array(24).fill(0)
    const ipMap = new Map<string, number>()

    filteredRows.forEach((row) => {
      const dateStr = row.login_at.slice(0, 10)
      timelineMap.set(dateStr, (timelineMap.get(dateStr) || 0) + 1)

      const method = row.auth_method || "unknown"
      methodMap.set(method, (methodMap.get(method) || 0) + 1)

      try {
        const hour = new Date(row.login_at).getHours()
        if (hour >= 0 && hour < 24) {
          hourlyMap[hour] += 1
        }
      } catch (e) {}

      if (row.ip_address) {
        ipMap.set(row.ip_address, (ipMap.get(row.ip_address) || 0) + 1)
      }
    })

    const timeline = Array.from(timelineMap.entries())
      .map(([date, count]) => ({
        date,
        formattedDate: formatWATDate(`${date}T00:00:00`, { day: "2-digit", month: "short" }),
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14) // Last 14 active days for visibility

    const methods = Array.from(methodMap.entries()).map(([name, value]) => ({
      name: name.replace(/_/g, " "),
      value,
    }))

    const hourly = hourlyMap.map((count, hour) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      count,
    }))

    const ips = Array.from(ipMap.entries())
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return { timeline, methods, hourly, ips }
  }, [filteredRows])

  const roleOptions = useMemo(
    () =>
      Array.from(new Set(filteredRows.map((row) => row.role).filter((role): role is string => Boolean(role))))
        .sort()
        .map((role) => ({
          value: role,
          label: role,
        })),
    [filteredRows]
  )

  const methodOptions = useMemo(
    () =>
      Array.from(
        new Set(
          filteredRows.map((row) => row.auth_method || "unknown").filter((method): method is string => Boolean(method))
        )
      )
        .sort()
        .map((method) => ({
          value: method,
          label: method,
        })),
    [filteredRows]
  )

  const dateOptions = useMemo(
    () =>
      Array.from(new Set(filteredRows.map((row) => row.login_at.slice(0, 10))))
        .sort()
        .reverse()
        .map((date) => ({
          value: date,
          label: formatWATDate(`${date}T00:00:00`, { day: "2-digit", month: "short", year: "numeric" }),
        })),
    [filteredRows]
  )

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
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department || "",
        hideOnMobile: true,
        render: (row) => row.department || "—",
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
    const csv = toCsv(filteredRows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `dev-login-logs-${new Date().toISOString()}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DataTablePage
      title="Developer Login Logs"
      description="Monitor successful sign-ins with network and actor context."
      backLink={{ href: "/admin/dev", label: "Back to DEV" }}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedDept("all")
              setSelectedUser("all")
              setFilterMode("time")
              setTimeRange("90")
              setSelectedDateRange({ from: "", to: "" })
              setSelectedMonth("")
              setSelectedCycle("")
              setSelectedBiannual("")
              setSelectedAnnual("")
              void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.devLoginLogs() })
            }}
            disabled={isLoading}
            size="sm"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Reset & Refresh
          </Button>
          <Button onClick={exportCsv} disabled={filteredRows.length === 0} size="sm">
            <Download className="mr-2 h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      }
    >
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

        {/* Control Panel (Filters and Actions) */}
        <div className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs font-medium">Filter By</span>
              <Select value={filterMode} onValueChange={(val: any) => setFilterMode(val)}>
                <SelectTrigger className="w-[140px] text-sm">
                  <SelectValue placeholder="Select filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">Relative Time</SelectItem>
                  <SelectItem value="date">Specific Date</SelectItem>
                  <SelectItem value="month">Specific Month</SelectItem>
                  <SelectItem value="cycle">Quarterly Cycle</SelectItem>
                  <SelectItem value="biannual">Bi-annual Cycle</SelectItem>
                  <SelectItem value="annual">Annual Cycle</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {filterMode === "time" && (
              <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                <span className="text-muted-foreground text-xs font-medium">Time Range</span>
                <Select value={timeRange} onValueChange={setTimeRange}>
                  <SelectTrigger className="w-[150px] text-sm">
                    <SelectValue placeholder="Select range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Last 24 Hours</SelectItem>
                    <SelectItem value="7">Last 7 Days</SelectItem>
                    <SelectItem value="30">Last 30 Days</SelectItem>
                    <SelectItem value="90">Last 90 Days</SelectItem>
                    <SelectItem value="180">Last 180 Days (6M)</SelectItem>
                    <SelectItem value="365">Last 365 Days (1Y)</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {filterMode === "date" && (
              <>
                <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                  <span className="text-muted-foreground text-xs font-medium">From Date</span>
                  <Input
                    type="date"
                    value={selectedDateRange.from}
                    onChange={(e) => setSelectedDateRange((prev) => ({ ...prev, from: e.target.value }))}
                    className="h-9 w-[160px] text-sm"
                  />
                </div>
                <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                  <span className="text-muted-foreground text-xs font-medium">To Date</span>
                  <Input
                    type="date"
                    value={selectedDateRange.to}
                    onChange={(e) => setSelectedDateRange((prev) => ({ ...prev, to: e.target.value }))}
                    className="h-9 w-[160px] text-sm"
                  />
                </div>
              </>
            )}

            {filterMode === "month" && (
              <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                <span className="text-muted-foreground text-xs font-medium">Select Month</span>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[180px] text-sm">
                    <SelectValue placeholder="Choose month" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Select Month</SelectItem>
                    {monthOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {filterMode === "cycle" && (
              <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                <span className="text-muted-foreground text-xs font-medium">Quarterly Cycle</span>
                <Select value={selectedCycle} onValueChange={setSelectedCycle}>
                  <SelectTrigger className="w-[180px] text-sm">
                    <SelectValue placeholder="Choose cycle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Select Cycle</SelectItem>
                    {cycleOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {filterMode === "biannual" && (
              <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                <span className="text-muted-foreground text-xs font-medium">Bi-annual Cycle</span>
                <Select value={selectedBiannual} onValueChange={setSelectedBiannual}>
                  <SelectTrigger className="w-[200px] text-sm">
                    <SelectValue placeholder="Choose half-year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Select Half-Year</SelectItem>
                    {biannualOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {filterMode === "annual" && (
              <div className="animate-in fade-in slide-in-from-left-1 flex flex-col gap-1.5 duration-200">
                <span className="text-muted-foreground text-xs font-medium">Annual Cycle</span>
                <Select value={selectedAnnual} onValueChange={setSelectedAnnual}>
                  <SelectTrigger className="w-[140px] text-sm">
                    <SelectValue placeholder="Choose year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Select Year</SelectItem>
                    {annualOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs font-medium">Filter by Department</span>
              <Select
                value={selectedDept}
                onValueChange={(val) => {
                  setSelectedDept(val)
                  setSelectedUser("all")
                }}
              >
                <SelectTrigger className="w-[180px] text-sm">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departmentOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs font-medium">Filter by Person</span>
              <SearchableSelect
                value={selectedUser}
                onValueChange={setSelectedUser}
                placeholder="All Users"
                options={[{ value: "all", label: "All Users" }, ...individualOptions]}
                searchPlaceholder="Search person..."
                className="w-[260px]"
              />
            </div>
          </div>
        </div>

        {meta ? (
          <p className="text-muted-foreground text-xs">
            {meta.days ? `Showing sign-ins from the last ${meta.days} days.` : "Showing all recorded sign-ins."}
            {meta.truncated
              ? ` Capped at ${meta.limit.toLocaleString()} rows — older events in this window are not shown, and the counts above cover only what is loaded.`
              : ""}
          </p>
        ) : null}

        {/* Visual Analytics Charts Grid */}
        {filteredRows.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Top Visited Routes & Operations */}
            <div className="bg-card col-span-full space-y-4 rounded-xl border-2 p-5 shadow-sm">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Top Visited Routes & Operations</h3>
                <p className="text-muted-foreground text-xs">
                  Most frequent user actions and visited sections in the active scope.
                </p>
              </div>
              {isLoadingAudit ? (
                <div className="space-y-3 py-6">
                  <div className="bg-muted h-4 w-3/4 animate-pulse rounded"></div>
                  <div className="bg-muted h-4 w-5/6 animate-pulse rounded"></div>
                  <div className="bg-muted h-4 w-1/2 animate-pulse rounded"></div>
                </div>
              ) : topRoutes.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {topRoutes.map((item) => {
                    const maxCount = topRoutes[0]?.count || 1
                    const percentage = (item.count / maxCount) * 100
                    return (
                      <div
                        key={`${item.action}:${item.route}`}
                        className="space-y-2 border-b pb-3 last:border-0 md:border-b-0 md:pb-0"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground flex max-w-[80%] items-center gap-1.5 truncate font-semibold">
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">
                              {item.action}
                            </Badge>
                            <span className="text-muted-foreground truncate font-mono">{item.route}</span>
                          </span>
                          <span className="text-muted-foreground font-mono text-[10px]">{item.count} ops</span>
                        </div>
                        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full transition-all duration-300"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground py-6 text-center text-xs">No operations recorded in this scope.</p>
              )}
            </div>

            {/* Timeline chart */}
            <div className="bg-card space-y-4 rounded-xl border-2 p-5 shadow-sm">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Sign-in Traffic Trends</h3>
                <p className="text-muted-foreground text-xs">Daily volume of successful sign-ins (last 14 days).</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData.timeline} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="formattedDate" tickLine={false} axisLine={false} className="text-xs" />
                    <YAxis tickLine={false} axisLine={false} className="text-xs" />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.15}
                      name="Sign-ins"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Hourly chart */}
            <div className="bg-card space-y-4 rounded-xl border-2 p-5 shadow-sm">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Peak Access Hours</h3>
                <p className="text-muted-foreground text-xs">Distribution of logins by hour of the day.</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData.hourly} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} className="text-xs" />
                    <YAxis tickLine={false} axisLine={false} className="text-xs" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" fill="oklch(0.65 0.15 250)" radius={[4, 4, 0, 0]} name="Logins" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Methods chart */}
            <div className="bg-card space-y-4 rounded-xl border-2 p-5 shadow-sm">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Preferred Authentication Methods</h3>
                <p className="text-muted-foreground text-xs">Percentage distribution of login methods.</p>
              </div>
              <div className="flex h-60 flex-col items-center justify-between gap-4 md:flex-row">
                <div className="h-48 w-full md:w-1/2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData.methods}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {chartData.methods.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="max-h-48 w-full flex-1 space-y-2 overflow-y-auto text-sm">
                  {chartData.methods.map((entry, index) => (
                    <div key={entry.name} className="text-muted-foreground flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <span className="capitalize">{entry.name}</span>
                      </span>
                      <span className="text-foreground font-semibold">{entry.value} logins</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* IPs chart */}
            <div className="bg-card space-y-4 rounded-xl border-2 p-5 shadow-sm">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Top Active Network Locations</h3>
                <p className="text-muted-foreground text-xs">Most frequent IP addresses used to log in.</p>
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData.ips} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                    <XAxis type="number" tickLine={false} axisLine={false} className="text-xs" />
                    <YAxis
                      dataKey="ip"
                      type="category"
                      tickLine={false}
                      axisLine={false}
                      className="font-mono text-xs"
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" fill="oklch(0.7 0.12 85)" radius={[0, 4, 4, 0]} name="Logins" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        <DataTable<DevLoginLogRow>
          data={filteredRows}
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
          rowActions={[
            {
              label: "View Access Profile",
              onClick: (row) => setSelectedRowForStats(row),
            },
          ]}
          expandable={{
            render: (row) => (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Email</p>
                  <p className="mt-2 text-sm">{row.email}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Department</p>
                  <p className="mt-2 text-sm">{row.department || "—"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">IP Address</p>
                  <p className="mt-2 text-sm">{row.ip_address || "-"}</p>
                </div>
                <div className="col-span-full rounded-lg border p-4">
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
                  <span className="text-muted-foreground">Department</span>
                  <span>{row.department || "—"}</span>
                </div>
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

        <Dialog open={selectedRowForStats !== null} onOpenChange={(open) => !open && setSelectedRowForStats(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Access Profile: {selectedRowForStats?.full_name || "Unknown User"}</DialogTitle>
              <DialogDescription>
                Detailed sign-in history and network access analytics for {selectedRowForStats?.email}.
              </DialogDescription>
            </DialogHeader>

            {selectedRowForStats && (
              <UserStatsView email={selectedRowForStats.email} userId={selectedRowForStats.user_id} allLogs={rows} />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DataTablePage>
  )
}
