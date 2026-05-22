"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Calendar, DollarSign, BarChart3, TrendingDown, TrendingUp } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/patterns"
import { Badge } from "@/components/ui/badge"

interface FinancePaymentRow {
  id: string
  title: string
  amount: number
  category: string | null
  created_at: string
  department_name: string | null
  status: string | null
  currency: string | null
}

interface FinanceReportData {
  rows: FinancePaymentRow[]
  totalRevenue: number
  totalExpenses: number
  netIncome: number
  paymentsByMonth: { month: string; amount: number }[]
  paymentsByCategory: { category: string; amount: number }[]
}

type FinancePaymentQueryRow = {
  id: string
  title: string
  amount: number | null
  category: string | null
  created_at: string
  status: string | null
  currency: string | null
  department?: { name?: string | null } | null
}

async function fetchFinanceReportData(): Promise<FinanceReportData> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("department_payments")
    .select("id, title, amount, category, created_at, status, currency, department:departments(name)")
    .order("created_at", { ascending: false })

  if (error) {
    if (error.code === "42P01") {
      return { totalRevenue: 0, totalExpenses: 0, netIncome: 0, paymentsByMonth: [], paymentsByCategory: [], rows: [] }
    }
    throw new Error(error.message)
  }

  const rows = ((data || []) as FinancePaymentQueryRow[]).map((payment) => ({
    id: payment.id,
    title: payment.title,
    amount: payment.amount || 0,
    category: payment.category || "Other",
    created_at: payment.created_at,
    department_name: payment.department?.name || "Unknown",
    status: payment.status || "unknown",
    currency: payment.currency || "NGN",
  }))

  const totalExpenses = rows.reduce((sum, payment) => sum + payment.amount, 0)

  const categoryMap = new Map<string, number>()
  rows.forEach((payment) => {
    const category = payment.category || "Other"
    categoryMap.set(category, (categoryMap.get(category) || 0) + payment.amount)
  })
  const paymentsByCategory = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  const monthMap = new Map<string, number>()
  rows.forEach((payment) => {
    const date = new Date(payment.created_at)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + payment.amount)
  })
  const paymentsByMonth = Array.from(monthMap.entries())
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)

  return {
    rows,
    totalRevenue: 0,
    totalExpenses,
    netIncome: -totalExpenses,
    paymentsByMonth,
    paymentsByCategory,
  }
}

function formatCurrency(amount: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
  }).format(amount)
}

function formatMonth(monthStr: string) {
  const [year, month] = monthStr.split("-")
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1)
  return date.toLocaleDateString("en-NG", { month: "short", year: "numeric" })
}

function getPeriodLabel(date: string) {
  const parsedDate = new Date(date)
  return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}`
}

export default function FinanceReportsPage() {
  const [period, setPeriod] = useState("year")

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.adminFinanceReports(),
    queryFn: fetchFinanceReportData,
  })

  const reportData = data ?? {
    totalRevenue: 0,
    totalExpenses: 0,
    netIncome: 0,
    paymentsByMonth: [],
    paymentsByCategory: [],
    rows: [],
  }

  const maxMonthAmount = useMemo(
    () => Math.max(...reportData.paymentsByMonth.map((item) => item.amount), 0),
    [reportData.paymentsByMonth]
  )

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(reportData.rows.map((row) => row.category).filter((category): category is string => Boolean(category)))
      )
        .sort()
        .map((category) => ({ value: category, label: category })),
    [reportData.rows]
  )

  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          reportData.rows
            .map((row) => row.department_name)
            .filter((department): department is string => Boolean(department))
        )
      )
        .sort()
        .map((department) => ({ value: department, label: department })),
    [reportData.rows]
  )

  const periodOptions = useMemo(
    () =>
      Array.from(new Set(reportData.rows.map((row) => getPeriodLabel(row.created_at))))
        .sort()
        .reverse()
        .map((entry) => ({ value: entry, label: formatMonth(entry) })),
    [reportData.rows]
  )

  const periodFilteredRows = useMemo(() => {
    const now = new Date()
    return reportData.rows.filter((row) => {
      const createdAt = new Date(row.created_at)
      if (period === "month") {
        return createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth()
      }
      if (period === "quarter") {
        const currentQuarter = Math.floor(now.getMonth() / 3)
        return createdAt.getFullYear() === now.getFullYear() && Math.floor(createdAt.getMonth() / 3) === currentQuarter
      }
      if (period === "year") {
        return createdAt.getFullYear() === now.getFullYear()
      }
      return true
    })
  }, [period, reportData.rows])

  const columns = useMemo<DataTableColumn<FinancePaymentRow>[]>(
    () => [
      {
        key: "title",
        label: "Title",
        sortable: true,
        accessor: (row) => row.title,
        resizable: true,
        initialWidth: 240,
        render: (row) => (
          <div className="space-y-1">
            <p className="font-medium">{row.title}</p>
            <p className="text-muted-foreground text-xs">{new Date(row.created_at).toLocaleDateString("en-NG")}</p>
          </div>
        ),
      },
      {
        key: "department_name",
        label: "Department",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => row.department_name || "",
      },
      {
        key: "category",
        label: "Category",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => row.category || "",
        render: (row) => <Badge variant="outline">{row.category || "Other"}</Badge>,
      },
      {
        key: "amount",
        label: "Amount",
        sortable: true,
        accessor: (row) => row.amount,
        align: "right",
        render: (row) => formatCurrency(row.amount, row.currency || "NGN"),
      },
      {
        key: "period",
        label: "Period",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) => getPeriodLabel(row.created_at),
        render: (row) => formatMonth(getPeriodLabel(row.created_at)),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<FinancePaymentRow>[]>(
    () => [
      {
        key: "department_name",
        label: "Department",
        options: departmentOptions,
      },
      {
        key: "category",
        label: "Category",
        options: categoryOptions,
      },
      {
        key: "period",
        label: "Month",
        options: periodOptions,
      },
    ],
    [categoryOptions, departmentOptions, periodOptions]
  )

  return (
    <DataTablePage
      title="Financial Reports"
      description="Review spending patterns, category concentration, and month-by-month finance activity."
      icon={BarChart3}
      backLink={{ href: "/admin/finance", label: "Back to Finance" }}
      actions={
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <Calendar className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="quarter">This Quarter</SelectItem>
            <SelectItem value="year">This Year</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Revenue"
            value={formatCurrency(reportData.totalRevenue)}
            icon={TrendingUp}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Total Expenses"
            value={formatCurrency(reportData.totalExpenses)}
            icon={TrendingDown}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Net Income"
            value={formatCurrency(reportData.netIncome)}
            icon={DollarSign}
            iconBgColor={reportData.netIncome >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}
            iconColor={reportData.netIncome >= 0 ? "text-emerald-500" : "text-red-500"}
          />
          <StatCard
            title="Entries"
            value={periodFilteredRows.length}
            icon={BarChart3}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expenses by Month</CardTitle>
            <CardDescription>Monthly payment trends</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="bg-muted h-8 animate-pulse rounded-md" />
                ))}
              </div>
            ) : reportData.paymentsByMonth.length === 0 ? (
              <EmptyState title="No data available" description="No monthly expense data was found for this period." />
            ) : (
              <div className="space-y-4">
                {reportData.paymentsByMonth.map((item) => (
                  <div key={item.month} className="flex items-center justify-between gap-4">
                    <span className="text-sm">{formatMonth(item.month)}</span>
                    <div className="flex items-center gap-4">
                      <div className="bg-muted h-2 w-32 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{
                            width: `${maxMonthAmount > 0 ? Math.min(100, (item.amount / maxMonthAmount) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="w-32 text-right text-sm font-medium">{formatCurrency(item.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category</CardTitle>
            <CardDescription>Where the spending is concentrated</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="bg-muted h-8 animate-pulse rounded-md" />
                ))}
              </div>
            ) : reportData.paymentsByCategory.length === 0 ? (
              <EmptyState title="No data available" description="No category expense data was found for this period." />
            ) : (
              <div className="space-y-4">
                {reportData.paymentsByCategory.map((item) => (
                  <div key={item.category} className="flex items-center justify-between gap-4">
                    <span className="text-sm">{item.category}</span>
                    <div className="flex items-center gap-4">
                      <div className="bg-muted h-2 w-32 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{
                            width: `${reportData.totalExpenses > 0 ? (item.amount / reportData.totalExpenses) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="w-32 text-right text-sm font-medium">{formatCurrency(item.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DataTable<FinancePaymentRow>
        data={periodFilteredRows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search title, department, or category..."
        searchFn={(row, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            row.title.toLowerCase().includes(normalizedQuery) ||
            (row.department_name || "").toLowerCase().includes(normalizedQuery) ||
            (row.category || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Title</p>
                <p className="mt-2 text-sm font-medium">{row.title}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Department</p>
                <p className="mt-2 text-sm">{row.department_name || "Unknown"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Category</p>
                <p className="mt-2 text-sm">{row.category || "Other"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Created</p>
                <p className="mt-2 text-sm">{new Date(row.created_at).toLocaleString("en-NG")}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{row.title}</p>
                <p className="text-muted-foreground text-sm">{row.department_name || "Unknown"}</p>
              </div>
              <Badge variant="outline">{row.category || "Other"}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span>{formatCurrency(row.amount, row.currency || "NGN")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Period</span>
                <span>{formatMonth(getPeriodLabel(row.created_at))}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No finance entries found"
        emptyDescription="Payment activity will appear here once finance records are available for the selected period."
        emptyIcon={BarChart3}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
