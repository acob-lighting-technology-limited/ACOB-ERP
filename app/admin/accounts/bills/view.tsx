"use client"

import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle, CircleDollarSign, Eye, FileClock, Plus, Receipt, Wallet } from "lucide-react"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { BillFormDialog } from "./_components/bill-form-dialog"

export interface Bill {
  id: string
  bill_number: string
  supplier_name: string
  bill_date: string
  due_date: string
  total_amount: number
  amount_paid: number
  balance_due: number
  currency: string
  status: "pending" | "approved" | "paid" | "overdue" | "cancelled"
  created_at: string
}

type BillStatusVariant = "default" | "destructive" | "secondary" | "outline"

const statusColors: Record<Bill["status"], BillStatusVariant> = {
  pending: "secondary",
  approved: "outline",
  paid: "default",
  overdue: "destructive",
  cancelled: "secondary",
}

async function fetchBillsList(): Promise<Bill[]> {
  const res = await fetch("/api/admin/finance/bills", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load bills")
  const json = await res.json()
  return (json.data || []) as Bill[]
}

function formatCurrency(amount: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
  }).format(amount)
}

function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "short", day: "numeric" })
}

function getDateBand(bill: Bill) {
  const dueDate = new Date(bill.due_date).getTime()
  const now = Date.now()
  const differenceInDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))

  if (differenceInDays < 0) return "Past Due"
  if (differenceInDays <= 7) return "Due Soon"
  return "Future"
}

export function BillsPage({
  backLinkHref,
  financeBasePath,
  initialBills,
}: { backLinkHref?: string; financeBasePath?: string; initialBills?: Bill[] } = {}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [isCreateOpen, setIsCreateOpen] = useState(searchParams.get("openCreate") === "1")

  const {
    data: bills = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminBills(),
    queryFn: fetchBillsList,
    initialData: initialBills,
  })

  const supplierOptions = useMemo(
    () =>
      Array.from(new Set(bills.map((bill) => bill.supplier_name).filter(Boolean)))
        .sort()
        .map((supplier) => ({ value: supplier, label: supplier })),
    [bills]
  )

  const dateBandOptions = useMemo(
    () => [
      { value: "Past Due", label: "Past Due" },
      { value: "Due Soon", label: "Due Soon" },
      { value: "Future", label: "Future" },
    ],
    []
  )

  const statusOptions = useMemo(
    () =>
      ["pending", "approved", "paid", "overdue", "cancelled"].map((status) => ({
        value: status,
        label: status.charAt(0).toUpperCase() + status.slice(1),
      })),
    []
  )

  const stats = useMemo(() => {
    const total = bills.length
    const pending = bills.filter((bill) => bill.status === "pending").length
    const paid = bills.filter((bill) => bill.status === "paid").length
    const overdue = bills.filter((bill) => bill.status === "overdue").length
    const totalAmount = bills.reduce((sum, bill) => sum + bill.total_amount, 0)
    const totalPaid = bills.reduce((sum, bill) => sum + bill.amount_paid, 0)

    return {
      total,
      pending,
      paid,
      overdue,
      totalAmount,
      totalPaid,
      outstanding: totalAmount - totalPaid,
    }
  }, [bills])

  const columns = useMemo<DataTableColumn<Bill>[]>(
    () => [
      {
        key: "bill_number",
        label: "Bill",
        sortable: true,
        accessor: (bill) => bill.bill_number,
        resizable: true,
        initialWidth: 180,
        render: (bill) => (
          <div className="space-y-1">
            <p className="font-medium">{bill.bill_number}</p>
            <p className="text-muted-foreground text-xs">Created {formatDate(bill.created_at)}</p>
          </div>
        ),
      },
      {
        key: "supplier_name",
        label: "Supplier",
        sortable: true,
        accessor: (bill) => bill.supplier_name,
        resizable: true,
        initialWidth: 220,
      },
      {
        key: "bill_date",
        label: "Bill Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (bill) => bill.bill_date,
        render: (bill) => formatDate(bill.bill_date),
      },
      {
        key: "due_date",
        label: "Due Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (bill) => bill.due_date,
        render: (bill) => (
          <div className="space-y-1">
            <p>{formatDate(bill.due_date)}</p>
            <p className="text-muted-foreground text-xs">{getDateBand(bill)}</p>
          </div>
        ),
      },
      {
        key: "total_amount",
        label: "Amount",
        sortable: true,
        accessor: (bill) => bill.total_amount,
        resizable: true,
        initialWidth: 180,
        render: (bill) => (
          <div className="space-y-1">
            <p className="font-medium">{formatCurrency(bill.total_amount, bill.currency)}</p>
            <p className="text-muted-foreground text-xs">Paid {formatCurrency(bill.amount_paid, bill.currency)}</p>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (bill) => bill.status,
        render: (bill) => (
          <Badge variant={statusColors[bill.status]} className="capitalize">
            {bill.status}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Bill>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "supplier_name",
        label: "Supplier",
        options: supplierOptions,
      },
      {
        key: "date_band",
        label: "Due Window",
        options: dateBandOptions,
        mode: "custom",
        filterFn: (bill, value) => {
          if (Array.isArray(value)) {
            return value.includes(getDateBand(bill))
          }
          return getDateBand(bill) === value
        },
      },
    ],
    [dateBandOptions, statusOptions, supplierOptions]
  )

  return (
    <DataTablePage
      title="Bills"
      description="Track supplier bills, payment progress, and upcoming due dates."
      icon={Receipt}
      backLink={{ href: backLinkHref ?? "/admin", label: "Back" }}
      actions={
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Bill
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Total Bills"
            value={stats.total}
            icon={Receipt}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={FileClock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Paid Amount"
            value={formatCurrency(stats.totalPaid)}
            icon={CheckCircle}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Outstanding"
            value={formatCurrency(stats.outstanding)}
            icon={Wallet}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<Bill>
        data={bills}
        columns={columns}
        filters={filters}
        getRowId={(bill) => bill.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search bill number or supplier..."
        searchFn={(bill, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            bill.bill_number.toLowerCase().includes(normalizedQuery) ||
            bill.supplier_name.toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={[
          {
            label: "View",
            icon: Eye,
            onClick: (bill) => {
              router.push(`${financeBasePath ?? "/admin/accounts"}/bills/${bill.id}`)
            },
          },
          {
            label: "Open Bill",
            icon: CircleDollarSign,
            onClick: (bill) => {
              router.push(`${financeBasePath ?? "/admin/accounts"}/bills/${bill.id}`)
            },
          },
        ]}
        expandable={{
          render: (bill) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Supplier</p>
                <p className="mt-2 text-sm font-medium">{bill.supplier_name}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Total Amount</p>
                <p className="mt-2 text-sm font-medium">{formatCurrency(bill.total_amount, bill.currency)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Balance Due</p>
                <p className="mt-2 text-sm font-medium">{formatCurrency(bill.balance_due, bill.currency)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Due Window</p>
                <p className="mt-2 text-sm font-medium">{getDateBand(bill)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(bill) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{bill.bill_number}</p>
                <p className="text-muted-foreground text-sm">{bill.supplier_name}</p>
              </div>
              <Badge variant={statusColors[bill.status]} className="capitalize">
                {bill.status}
              </Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span>{formatCurrency(bill.total_amount, bill.currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Due</span>
                <span>{formatDate(bill.due_date)}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No bills yet"
        emptyDescription="Add your first bill to start tracking supplier expenses."
        emptyIcon={Receipt}
        skeletonRows={5}
        urlSync
      />
      <BillFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} queryClient={queryClient} />
    </DataTablePage>
  )
}
