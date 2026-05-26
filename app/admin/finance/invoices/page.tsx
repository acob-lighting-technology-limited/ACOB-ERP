"use client"

import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { CircleDollarSign, Download, Eye, FileClock, FileText, Plus, Send, Wallet } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { InvoiceFormDialog } from "./_components/invoice-form-dialog"
import { logger } from "@/lib/logger"

const log = logger("finance-invoices")

interface Invoice {
  id: string
  invoice_number: string
  customer_name: string
  customer_email: string | null
  issue_date: string
  due_date: string
  total_amount: number
  amount_paid: number
  balance_due: number
  currency: string
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled"
  created_at: string
}

type InvoiceStatusVariant = "default" | "destructive" | "secondary" | "outline"

const statusColors: Record<Invoice["status"], InvoiceStatusVariant> = {
  draft: "secondary",
  sent: "outline",
  paid: "default",
  overdue: "destructive",
  cancelled: "secondary",
}

async function fetchInvoicesList(): Promise<Invoice[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false })

  if (error) {
    if (error.code === "42P01") {
      log.debug("Invoices table does not exist yet")
      return []
    }
    throw new Error(error.message)
  }

  return data || []
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

function getDueWindow(invoice: Invoice) {
  const dueDate = new Date(invoice.due_date).getTime()
  const differenceInDays = Math.ceil((dueDate - Date.now()) / (1000 * 60 * 60 * 24))

  if (differenceInDays < 0) return "Past Due"
  if (differenceInDays <= 7) return "Due Soon"
  return "Future"
}

export default function InvoicesPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [isCreateOpen, setIsCreateOpen] = useState(searchParams.get("openCreate") === "1")

  const {
    data: invoices = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminInvoices(),
    queryFn: fetchInvoicesList,
  })

  const customerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          invoices.map((invoice) => invoice.customer_name).filter((customer): customer is string => Boolean(customer))
        )
      )
        .sort()
        .map((customer) => ({ value: customer, label: customer })),
    [invoices]
  )

  const statusOptions = useMemo(
    () =>
      ["draft", "sent", "paid", "overdue", "cancelled"].map((status) => ({
        value: status,
        label: status.charAt(0).toUpperCase() + status.slice(1),
      })),
    []
  )

  const dueWindowOptions = useMemo(
    () => [
      { value: "Past Due", label: "Past Due" },
      { value: "Due Soon", label: "Due Soon" },
      { value: "Future", label: "Future" },
    ],
    []
  )

  const stats = useMemo(() => {
    const total = invoices.length
    const draft = invoices.filter((invoice) => invoice.status === "draft").length
    const paid = invoices.filter((invoice) => invoice.status === "paid").length
    const overdue = invoices.filter((invoice) => invoice.status === "overdue").length
    const totalAmount = invoices.reduce((sum, invoice) => sum + invoice.total_amount, 0)
    const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.amount_paid, 0)

    return {
      total,
      draft,
      paid,
      overdue,
      totalAmount,
      totalPaid,
      outstanding: totalAmount - totalPaid,
    }
  }, [invoices])

  const columns = useMemo<DataTableColumn<Invoice>[]>(
    () => [
      {
        key: "invoice_number",
        label: "Invoice",
        sortable: true,
        accessor: (invoice) => invoice.invoice_number,
        resizable: true,
        initialWidth: 180,
        render: (invoice) => (
          <div className="space-y-1">
            <p className="font-medium">{invoice.invoice_number}</p>
            <p className="text-muted-foreground text-xs">Created {formatDate(invoice.created_at)}</p>
          </div>
        ),
      },
      {
        key: "customer_name",
        label: "Customer",
        sortable: true,
        accessor: (invoice) => invoice.customer_name,
        resizable: true,
        initialWidth: 230,
        render: (invoice) => (
          <div className="space-y-1">
            <p className="font-medium">{invoice.customer_name}</p>
            <p className="text-muted-foreground text-xs">{invoice.customer_email || "No email on file"}</p>
          </div>
        ),
      },
      {
        key: "issue_date",
        label: "Issue Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (invoice) => invoice.issue_date,
        render: (invoice) => formatDate(invoice.issue_date),
      },
      {
        key: "due_date",
        label: "Due Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (invoice) => invoice.due_date,
        render: (invoice) => (
          <div className="space-y-1">
            <p>{formatDate(invoice.due_date)}</p>
            <p className="text-muted-foreground text-xs">{getDueWindow(invoice)}</p>
          </div>
        ),
      },
      {
        key: "total_amount",
        label: "Amount",
        sortable: true,
        accessor: (invoice) => invoice.total_amount,
        resizable: true,
        initialWidth: 180,
        render: (invoice) => (
          <div className="space-y-1">
            <p className="font-medium">{formatCurrency(invoice.total_amount, invoice.currency)}</p>
            <p className="text-muted-foreground text-xs">Due {formatCurrency(invoice.balance_due, invoice.currency)}</p>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (invoice) => invoice.status,
        render: (invoice) => (
          <Badge variant={statusColors[invoice.status]} className="capitalize">
            {invoice.status}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Invoice>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "customer_name",
        label: "Customer",
        options: customerOptions,
      },
      {
        key: "due_window",
        label: "Due Window",
        mode: "custom",
        options: dueWindowOptions,
        filterFn: (invoice, value) => {
          const dueWindow = getDueWindow(invoice)
          if (Array.isArray(value)) {
            return value.includes(dueWindow)
          }
          return dueWindow === value
        },
      },
    ],
    [customerOptions, dueWindowOptions, statusOptions]
  )

  return (
    <DataTablePage
      title="Invoices"
      description="Create and manage customer invoices, collections, and overdue balances."
      icon={FileText}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Invoice
        </Button>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Invoices"
            value={stats.total}
            icon={FileText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Drafts"
            value={stats.draft}
            icon={FileClock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Collected"
            value={formatCurrency(stats.totalPaid)}
            icon={CircleDollarSign}
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
      <DataTable<Invoice>
        data={invoices}
        columns={columns}
        filters={filters}
        getRowId={(invoice) => invoice.id}
        searchPlaceholder="Search invoice number, customer, or email..."
        searchFn={(invoice, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            invoice.invoice_number.toLowerCase().includes(normalizedQuery) ||
            invoice.customer_name.toLowerCase().includes(normalizedQuery) ||
            (invoice.customer_email || "").toLowerCase().includes(normalizedQuery)
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
            onClick: (invoice) => router.push(`/admin/finance/invoices/${invoice.id}`),
          },
          {
            label: "Send",
            icon: Send,
            onClick: (invoice) => router.push(`/admin/finance/invoices/${invoice.id}`),
          },
          {
            label: "Download",
            icon: Download,
            onClick: (invoice) => router.push(`/admin/finance/invoices/${invoice.id}`),
          },
        ]}
        expandable={{
          render: (invoice) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Customer</p>
                <p className="mt-2 text-sm font-medium">{invoice.customer_name}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Email</p>
                <p className="mt-2 text-sm">{invoice.customer_email || "No email on file"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Paid</p>
                <p className="mt-2 text-sm">{formatCurrency(invoice.amount_paid, invoice.currency)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Balance Due</p>
                <p className="mt-2 text-sm font-medium">{formatCurrency(invoice.balance_due, invoice.currency)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(invoice) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{invoice.invoice_number}</p>
                <p className="text-muted-foreground text-sm">{invoice.customer_name}</p>
              </div>
              <Badge variant={statusColors[invoice.status]} className="capitalize">
                {invoice.status}
              </Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span>{formatCurrency(invoice.total_amount, invoice.currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Due</span>
                <span>{formatDate(invoice.due_date)}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No invoices yet"
        emptyDescription="Create your first invoice to start tracking customer revenue."
        emptyIcon={FileText}
        skeletonRows={5}
        urlSync
      />
      <InvoiceFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} queryClient={queryClient} />
    </DataTablePage>
  )
}
