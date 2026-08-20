"use client"

import { useMemo } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery } from "@tanstack/react-query"
import { CalendarDays, Package, PackageCheck, ReceiptText, ShoppingBag } from "lucide-react"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"

interface Receipt {
  id: string
  receipt_number: string
  po_number?: string
  supplier_name?: string
  received_date: string
  total_items: number
  created_at: string
}

async function fetchReceipts(): Promise<Receipt[]> {
  const res = await fetch("/api/admin/purchasing/receipts", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load receipts")
  const json = await res.json()
  return (json.data || []) as Receipt[]
}

function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "short", day: "numeric" })
}

function getItemBand(totalItems: number) {
  if (totalItems <= 5) return "Small"
  if (totalItems <= 20) return "Medium"
  return "Large"
}

export default function ReceiptsPage() {
  const {
    data: receipts = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminReceiptsList(),
    queryFn: fetchReceipts,
  })

  const stats = useMemo(() => {
    const total = receipts.length
    const items = receipts.reduce((sum, receipt) => sum + (receipt.total_items || 0), 0)
    const linkedOrders = receipts.filter((receipt) => Boolean(receipt.po_number)).length
    const uniqueSuppliers = new Set(receipts.map((receipt) => receipt.supplier_name).filter(Boolean)).size

    return { total, items, linkedOrders, uniqueSuppliers }
  }, [receipts])

  const supplierOptions = useMemo(
    () =>
      Array.from(
        new Set(
          receipts.map((receipt) => receipt.supplier_name).filter((supplier): supplier is string => Boolean(supplier))
        )
      )
        .sort()
        .map((supplier) => ({
          value: supplier,
          label: supplier,
        })),
    [receipts]
  )

  const itemBandOptions = useMemo(
    () => [
      { value: "Small", label: "Small" },
      { value: "Medium", label: "Medium" },
      { value: "Large", label: "Large" },
    ],
    []
  )

  const poLinkOptions = useMemo(
    () => [
      { value: "linked", label: "Linked to PO" },
      { value: "unlinked", label: "No PO Link" },
    ],
    []
  )

  const columns = useMemo<DataTableColumn<Receipt>[]>(
    () => [
      {
        key: "receipt_number",
        label: "Receipt",
        sortable: true,
        accessor: (receipt) => receipt.receipt_number,
        render: (receipt) => <span className="font-mono text-sm">{receipt.receipt_number}</span>,
      },
      {
        key: "po_number",
        label: "PO",
        sortable: true,
        accessor: (receipt) => receipt.po_number || "",
        render: (receipt) => <span className="font-mono text-sm">{receipt.po_number || "No PO"}</span>,
        hideOnMobile: true,
      },
      {
        key: "supplier_name",
        label: "Supplier",
        sortable: true,
        accessor: (receipt) => receipt.supplier_name || "",
        resizable: true,
        initialWidth: 220,
        render: (receipt) => <span className="font-medium">{receipt.supplier_name || "Unknown supplier"}</span>,
      },
      {
        key: "received_date",
        label: "Received Date",
        sortable: true,
        accessor: (receipt) => receipt.received_date,
        render: (receipt) => formatDate(receipt.received_date),
        hideOnMobile: true,
      },
      {
        key: "total_items",
        label: "Items",
        sortable: true,
        accessor: (receipt) => receipt.total_items,
        align: "center",
        render: (receipt) => <Badge variant="secondary">{receipt.total_items}</Badge>,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Receipt>[]>(
    () => [
      {
        key: "supplier_name",
        label: "Supplier",
        options: supplierOptions,
      },
      {
        key: "item_band",
        label: "Item Volume",
        mode: "custom",
        options: itemBandOptions,
        filterFn: (receipt, value) => {
          const itemBand = getItemBand(receipt.total_items)
          if (Array.isArray(value)) {
            return value.includes(itemBand)
          }
          return itemBand === value
        },
      },
      {
        key: "po_link",
        label: "PO Link",
        mode: "custom",
        options: poLinkOptions,
        filterFn: (receipt, value) => {
          const isLinked = Boolean(receipt.po_number)
          const evaluate = (entry: string) => {
            if (entry === "linked") return isLinked
            if (entry === "unlinked") return !isLinked
            return false
          }
          if (Array.isArray(value)) {
            return value.some(evaluate)
          }
          return evaluate(value)
        },
      },
    ],
    [itemBandOptions, poLinkOptions, supplierOptions]
  )

  return (
    <DataTablePage
      title="Goods Receipts"
      description="Track received deliveries, linked purchase orders, and inbound item volume."
      icon={Package}
      backLink={{ href: "/admin/purchasing", label: "Back to Purchasing" }}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Receipts"
            value={stats.total}
            icon={ReceiptText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Total Items"
            value={stats.items}
            icon={PackageCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Linked Orders"
            value={stats.linkedOrders}
            icon={ShoppingBag}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Suppliers"
            value={stats.uniqueSuppliers}
            icon={CalendarDays}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<Receipt>
        data={receipts}
        columns={columns}
        filters={filters}
        getRowId={(receipt) => receipt.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search receipt number, PO, or supplier..."
        searchFn={(receipt, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            receipt.receipt_number.toLowerCase().includes(normalizedQuery) ||
            (receipt.po_number || "").toLowerCase().includes(normalizedQuery) ||
            (receipt.supplier_name || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        expandable={{
          render: (receipt) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Receipt Number</p>
                <p className="mt-2 text-sm font-medium">{receipt.receipt_number}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">PO Reference</p>
                <p className="mt-2 text-sm">{receipt.po_number || "No linked purchase order"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Supplier</p>
                <p className="mt-2 text-sm">{receipt.supplier_name || "Unknown supplier"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Item Volume</p>
                <p className="mt-2 text-sm font-medium">{getItemBand(receipt.total_items)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(receipt) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{receipt.receipt_number}</p>
                <p className="text-muted-foreground text-sm">{receipt.supplier_name || "Unknown supplier"}</p>
              </div>
              <Badge variant="secondary">{receipt.total_items}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">PO</span>
                <span>{receipt.po_number || "No PO"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Received</span>
                <span>{formatDate(receipt.received_date)}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No receipts yet"
        emptyDescription="Receipts will appear here once purchase orders are received."
        emptyIcon={Package}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
