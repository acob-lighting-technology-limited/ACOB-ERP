"use client"

import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { BadgeCheck, CalendarClock, Eye, Plus, ShoppingCart, Wallet } from "lucide-react"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { PurchaseOrderFormDialog } from "./_components/purchase-order-form-dialog"

interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  supplier_name?: string
  order_date: string
  expected_date: string | null
  total_amount: number
  currency: string
  status: "draft" | "pending" | "approved" | "received" | "cancelled"
  created_at: string
}

type BadgeVariant = "default" | "destructive" | "secondary" | "outline"

const statusColors: Record<PurchaseOrder["status"], BadgeVariant> = {
  draft: "secondary",
  pending: "outline",
  approved: "default",
  received: "default",
  cancelled: "destructive",
}

async function fetchPurchaseOrdersList(): Promise<PurchaseOrder[]> {
  const res = await fetch("/api/admin/purchasing/orders", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load purchase orders")
  const json = await res.json()
  return (json.data || []) as PurchaseOrder[]
}

function formatCurrency(amount: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount)
}

function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "short", day: "numeric" })
}

function getDeliveryWindow(order: PurchaseOrder) {
  if (!order.expected_date) return "Unscheduled"
  const daysUntilExpected = Math.ceil((new Date(order.expected_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysUntilExpected < 0) return "Overdue"
  if (daysUntilExpected <= 7) return "Due Soon"
  return "Planned"
}

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [isCreateOpen, setIsCreateOpen] = useState(searchParams.get("openCreate") === "1")

  const {
    data: orders = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminPurchaseOrders(),
    queryFn: fetchPurchaseOrdersList,
  })

  const supplierOptions = useMemo(
    () =>
      Array.from(
        new Set(orders.map((order) => order.supplier_name).filter((supplier): supplier is string => Boolean(supplier)))
      )
        .sort()
        .map((supplier) => ({ value: supplier, label: supplier })),
    [orders]
  )

  const statusOptions = useMemo(
    () =>
      ["draft", "pending", "approved", "received", "cancelled"].map((status) => ({
        value: status,
        label: status.charAt(0).toUpperCase() + status.slice(1),
      })),
    []
  )

  const deliveryWindowOptions = useMemo(
    () => [
      { value: "Overdue", label: "Overdue" },
      { value: "Due Soon", label: "Due Soon" },
      { value: "Planned", label: "Planned" },
      { value: "Unscheduled", label: "Unscheduled" },
    ],
    []
  )

  const stats = useMemo(() => {
    const total = orders.length
    const pending = orders.filter((order) => order.status === "pending").length
    const approved = orders.filter((order) => order.status === "approved").length
    const totalValue = orders.reduce((sum, order) => sum + order.total_amount, 0)

    return { total, pending, approved, totalValue }
  }, [orders])

  const columns = useMemo<DataTableColumn<PurchaseOrder>[]>(
    () => [
      {
        key: "po_number",
        label: "PO",
        sortable: true,
        accessor: (order) => order.po_number,
        render: (order) => <span className="font-mono text-sm">{order.po_number}</span>,
      },
      {
        key: "supplier_name",
        label: "Supplier",
        sortable: true,
        accessor: (order) => order.supplier_name || "",
        resizable: true,
        initialWidth: 220,
        render: (order) => <span className="font-medium">{order.supplier_name || "Unknown supplier"}</span>,
      },
      {
        key: "order_date",
        label: "Order Date",
        sortable: true,
        accessor: (order) => order.order_date,
        render: (order) => formatDate(order.order_date),
        hideOnMobile: true,
      },
      {
        key: "expected_date",
        label: "Expected",
        sortable: true,
        accessor: (order) => order.expected_date || "",
        render: (order) => (
          <div className="space-y-1">
            <p>{order.expected_date ? formatDate(order.expected_date) : "Not set"}</p>
            <p className="text-muted-foreground text-xs">{getDeliveryWindow(order)}</p>
          </div>
        ),
        hideOnMobile: true,
      },
      {
        key: "total_amount",
        label: "Amount",
        sortable: true,
        accessor: (order) => order.total_amount,
        align: "right",
        render: (order) => formatCurrency(order.total_amount, order.currency),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (order) => order.status,
        render: (order) => (
          <Badge variant={statusColors[order.status]} className="capitalize">
            {order.status}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<PurchaseOrder>[]>(
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
        key: "delivery_window",
        label: "Delivery Window",
        mode: "custom",
        options: deliveryWindowOptions,
        filterFn: (order, value) => {
          const deliveryWindow = getDeliveryWindow(order)
          if (Array.isArray(value)) {
            return value.includes(deliveryWindow)
          }
          return deliveryWindow === value
        },
      },
    ],
    [deliveryWindowOptions, statusOptions, supplierOptions]
  )

  return (
    <DataTablePage
      title="Purchase Orders"
      description="Manage purchase orders, supplier commitments, and delivery timing."
      icon={ShoppingCart}
      backLink={{ href: "/admin/purchasing", label: "Back to Purchasing" }}
      actions={
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create PO
        </Button>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Orders"
            value={stats.total}
            icon={ShoppingCart}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={CalendarClock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Approved"
            value={stats.approved}
            icon={BadgeCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Total Value"
            value={formatCurrency(stats.totalValue)}
            icon={Wallet}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<PurchaseOrder>
        data={orders}
        columns={columns}
        filters={filters}
        getRowId={(order) => order.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search purchase order or supplier..."
        searchFn={(order, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            order.po_number.toLowerCase().includes(normalizedQuery) ||
            (order.supplier_name || "").toLowerCase().includes(normalizedQuery)
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
            onClick: (order) => router.push(`/admin/purchasing/orders/${order.id}`),
          },
        ]}
        expandable={{
          render: (order) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Supplier</p>
                <p className="mt-2 text-sm font-medium">{order.supplier_name || "Unknown supplier"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Order Date</p>
                <p className="mt-2 text-sm">{formatDate(order.order_date)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Expected Date</p>
                <p className="mt-2 text-sm">
                  {order.expected_date ? formatDate(order.expected_date) : "Not scheduled"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Delivery Window</p>
                <p className="mt-2 text-sm font-medium">{getDeliveryWindow(order)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(order) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{order.po_number}</p>
                <p className="text-muted-foreground text-sm">{order.supplier_name || "Unknown supplier"}</p>
              </div>
              <Badge variant={statusColors[order.status]} className="capitalize">
                {order.status}
              </Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span>{formatCurrency(order.total_amount, order.currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Expected</span>
                <span>{order.expected_date ? formatDate(order.expected_date) : "Not set"}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No purchase orders yet"
        emptyDescription="Create your first purchase order to begin tracking supplier procurement."
        emptyIcon={ShoppingCart}
        skeletonRows={5}
        urlSync
      />
      <PurchaseOrderFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} queryClient={queryClient} />
    </DataTablePage>
  )
}
