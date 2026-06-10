"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatWATDate, formatWATDateTime, toLocalISODate } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Bot, Database, Download, Globe, MessageSquare, RefreshCw, Users } from "lucide-react"

type AcobotSource = "erp" | "website"

type AcobotLogRow = {
  id: string
  user_id: string | null
  source: AcobotSource
  email: string | null
  full_name: string | null
  role: string | null
  department: string | null
  question: string
  answer: string | null
  had_context: boolean
  model: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

const TABS: DataTableTab[] = [
  { key: "erp", label: "ERP", icon: Bot },
  { key: "website", label: "Website", icon: Globe },
]

function truncate(value: string | null, max: number): string {
  if (!value) return ""
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
}

function toCsv(rows: AcobotLogRow[]) {
  const headers = ["time", "source", "person", "email", "department", "question", "answer", "had_context", "model"]
  const body = rows.map((row) => [
    row.created_at,
    row.source,
    row.full_name || "",
    row.email || "",
    row.department || "",
    row.question,
    row.answer || "",
    row.had_context ? "yes" : "no",
    row.model || "",
  ])
  return [headers, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n")
}

async function fetchAcobotLogs(source: AcobotSource): Promise<AcobotLogRow[]> {
  const response = await fetch(`/api/admin/dev/acobot?source=${source}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load ACOBot logs (${response.status})`)
  }
  return (payload?.data || []) as AcobotLogRow[]
}

export function DevAcobotLogsContent() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<AcobotSource>("erp")
  const isWebsite = tab === "website"

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: ["acobot-logs", tab], queryFn: () => fetchAcobotLogs(tab) })

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.department).filter((d): d is string => Boolean(d))))
        .sort()
        .map((d) => ({ value: d, label: d })),
    [rows]
  )

  const dateOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.created_at.slice(0, 10))))
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
    const uniques = new Set(rows.map((row) => (isWebsite ? row.ip_address : row.email)).filter(Boolean)).size
    const withData = rows.filter((row) => row.had_context).length
    const today = toLocalISODate(new Date())
    const todayCount = rows.filter((row) => row.created_at.slice(0, 10) === today).length
    return { total, uniques, withData, todayCount }
  }, [rows, isWebsite])

  const columns = useMemo<DataTableColumn<AcobotLogRow>[]>(() => {
    const base: DataTableColumn<AcobotLogRow>[] = [
      {
        key: "created_at",
        label: "Time",
        sortable: true,
        accessor: (row) => row.created_at,
        resizable: true,
        initialWidth: 190,
        render: (row) => formatWATDateTime(row.created_at),
      },
    ]

    if (isWebsite) {
      base.push(
        {
          key: "question",
          label: "Question",
          accessor: (row) => row.question,
          resizable: true,
          initialWidth: 360,
          render: (row) => <p className="max-w-[420px] text-sm">{truncate(row.question, 160)}</p>,
        },
        {
          key: "ip_address",
          label: "Visitor",
          accessor: (row) => row.ip_address || "",
          hideOnMobile: true,
          render: (row) => row.ip_address || "Anonymous",
        }
      )
    } else {
      base.push(
        {
          key: "full_name",
          label: "Person",
          sortable: true,
          accessor: (row) => row.full_name || row.email || "",
          render: (row) => (
            <div className="space-y-1">
              <p className="font-medium">{row.full_name || "Unknown"}</p>
              <p className="text-muted-foreground text-xs">{row.email}</p>
            </div>
          ),
        },
        {
          key: "department",
          label: "Department",
          sortable: true,
          accessor: (row) => row.department || "",
          hideOnMobile: true,
          render: (row) => row.department || "-",
        },
        {
          key: "question",
          label: "Question",
          accessor: (row) => row.question,
          resizable: true,
          initialWidth: 320,
          render: (row) => <p className="max-w-[360px] text-sm">{truncate(row.question, 140)}</p>,
        }
      )
    }

    base.push({
      key: "had_context",
      label: "Used data",
      accessor: (row) => (row.had_context ? "yes" : "no"),
      render: (row) =>
        row.had_context ? <Badge variant="outline">Live data</Badge> : <Badge variant="secondary">General</Badge>,
    })

    return base
  }, [isWebsite])

  const filters = useMemo<DataTableFilter<AcobotLogRow>[]>(() => {
    const list: DataTableFilter<AcobotLogRow>[] = [
      {
        key: "had_context",
        label: "Used data",
        options: [
          { value: "yes", label: "Live data" },
          { value: "no", label: "General" },
        ],
        mode: "custom",
        filterFn: (row, value) => {
          const v = row.had_context ? "yes" : "no"
          return Array.isArray(value) ? value.includes(v) : v === value
        },
      },
      {
        key: "created_date",
        label: "Date",
        mode: "custom",
        options: dateOptions,
        filterFn: (row, value) => {
          const rowDate = row.created_at.slice(0, 10)
          return Array.isArray(value) ? value.includes(rowDate) : rowDate === value
        },
      },
    ]
    if (!isWebsite) {
      list.unshift({ key: "department", label: "Department", options: departmentOptions })
    }
    return list
  }, [dateOptions, departmentOptions, isWebsite])

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `acobot-${tab}-conversations-${toLocalISODate(new Date())}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => queryClient.invalidateQueries({ queryKey: ["acobot-logs", tab] })}
        disabled={isLoading}
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
      <Button size="sm" onClick={exportCsv} disabled={rows.length === 0}>
        <Download className="mr-2 h-4 w-4" />
        Export
      </Button>
    </div>
  )

  const statsRow = (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <StatCard
        title="Conversations"
        value={stats.total}
        icon={MessageSquare}
        iconBgColor="bg-blue-500/10"
        iconColor="text-blue-500"
      />
      <StatCard
        title={isWebsite ? "Unique Visitors" : "Unique Users"}
        value={stats.uniques}
        icon={Users}
        iconBgColor="bg-emerald-500/10"
        iconColor="text-emerald-500"
      />
      <StatCard
        title="Answered with Data"
        value={stats.withData}
        icon={Database}
        iconBgColor="bg-violet-500/10"
        iconColor="text-violet-500"
      />
      <StatCard
        title="Today"
        value={stats.todayCount}
        icon={isWebsite ? Globe : Bot}
        iconBgColor="bg-amber-500/10"
        iconColor="text-amber-500"
      />
    </div>
  )

  return (
    <DataTablePage
      title="ACOBot Conversations"
      description="Every question staff and website visitors asked ACOBot, its answer, and who asked it."
      backLink={{ href: "/admin/dev", label: "Back to DEV" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={(t) => setTab(t as AcobotSource)}
      actions={headerActions}
      stats={statsRow}
    >
      <DataTable<AcobotLogRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search question, answer, person, or email..."
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          return (
            row.question.toLowerCase().includes(q) ||
            (row.answer || "").toLowerCase().includes(q) ||
            (row.full_name || "").toLowerCase().includes(q) ||
            (row.email || "").toLowerCase().includes(q)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        expandable={{
          render: (row) => (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Question</p>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{row.question}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Answer</p>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{row.answer || "—"}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Used live data</p>
                  <p className="mt-2 text-sm">{row.had_context ? "Yes" : "No"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Model</p>
                  <p className="mt-2 text-sm break-words">{row.model || "-"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">IP Address</p>
                  <p className="mt-2 text-sm">{row.ip_address || "-"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">User Agent</p>
                  <p className="mt-2 text-sm break-words">{row.user_agent || "-"}</p>
                </div>
              </div>
            </div>
          ),
        }}
        emptyTitle={isWebsite ? "No website conversations yet" : "No ERP conversations yet"}
        emptyDescription={
          isWebsite
            ? "Questions asked on the public website chatbot will appear here."
            : "Questions staff ask ACOBot inside the ERP will appear here."
        }
        emptyIcon={isWebsite ? Globe : MessageSquare}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
