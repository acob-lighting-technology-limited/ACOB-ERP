"use client"

import { useMemo } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, ArrowUpDown, Boxes, ClipboardList, Package2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"

interface StockMovement {
  id: string
  product_id: string
  product_name?: string
  movement_type: "in" | "out" | "adjustment" | "transfer"
  quantity: number
  reference_number: string | null
  notes: string | null
  created_at: string
  created_by_name?: string
}

type BadgeVariant = "default" | "destructive" | "secondary" | "outline"

const typeColors: Record<StockMovement["movement_type"], BadgeVariant> = {
  in: "default",
  out: "destructive",
  adjustment: "secondary",
  transfer: "outline",
}

const typeIcons = {
  in: ArrowDown,
  out: ArrowUp,
  adjustment: ArrowUpDown,
  transfer: ClipboardList,
} satisfies Record<StockMovement["movement_type"], typeof ArrowUpDown>

type StockMovementRow = StockMovement & {
  product?: { name?: string | null } | null
  created_by?: { first_name?: string | null; last_name?: string | null } | null
}

async function fetchMovementsList(): Promise<StockMovement[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("stock_movements")
    .select("*, product:products(name), created_by:profiles(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    if (error.code === "42P01") {
      return []
    }
    throw new Error(error.message)
  }

  return ((data || []) as StockMovementRow[]).map((movement) => ({
    ...movement,
    product_name: movement.product?.name || undefined,
    created_by_name: movement.created_by
      ? `${movement.created_by.first_name || ""} ${movement.created_by.last_name || ""}`.trim() || undefined
      : undefined,
  }))
}

function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "short", day: "numeric" })
}

function getQuantityLabel(movement: StockMovement) {
  if (movement.movement_type === "in") return `+${movement.quantity}`
  if (movement.movement_type === "out") return `-${movement.quantity}`
  return `${movement.quantity}`
}

export default function MovementsPage() {
  const {
    data: movements = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminInventoryMovements(),
    queryFn: fetchMovementsList,
  })

  const stats = useMemo(() => {
    const total = movements.length
    const stockIn = movements
      .filter((movement) => movement.movement_type === "in")
      .reduce((sum, movement) => sum + movement.quantity, 0)
    const stockOut = movements
      .filter((movement) => movement.movement_type === "out")
      .reduce((sum, movement) => sum + movement.quantity, 0)
    const transfers = movements.filter((movement) => movement.movement_type === "transfer").length

    return { total, stockIn, stockOut, transfers }
  }, [movements])

  const productOptions = useMemo(
    () =>
      Array.from(
        new Set(
          movements.map((movement) => movement.product_name).filter((product): product is string => Boolean(product))
        )
      )
        .sort()
        .map((product) => ({
          value: product,
          label: product,
        })),
    [movements]
  )

  const movementTypeOptions = useMemo(
    () =>
      ["in", "out", "adjustment", "transfer"].map((type) => ({
        value: type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
      })),
    []
  )

  const quantityBandOptions = useMemo(
    () => [
      { value: "1-10", label: "1-10" },
      { value: "11-50", label: "11-50" },
      { value: "51+", label: "51+" },
    ],
    []
  )

  const columns = useMemo<DataTableColumn<StockMovement>[]>(
    () => [
      {
        key: "created_at",
        label: "Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (movement) => movement.created_at,
        resizable: true,
        initialWidth: 210,
        render: (movement) => formatDate(movement.created_at),
      },
      {
        key: "product_name",
        label: "Product",
        sortable: true,
        accessor: (movement) => movement.product_name || "",
        resizable: true,
        initialWidth: 220,
        render: (movement) => <span className="font-medium">{movement.product_name || "Unknown product"}</span>,
      },
      {
        key: "movement_type",
        label: "Type",
        sortable: true,
        accessor: (movement) => movement.movement_type,
        render: (movement) => {
          const Icon = typeIcons[movement.movement_type]
          return (
            <Badge variant={typeColors[movement.movement_type]} className="capitalize">
              <Icon className="mr-1 h-3 w-3" />
              {movement.movement_type}
            </Badge>
          )
        },
      },
      {
        key: "quantity",
        label: "Quantity",
        sortable: true,
        accessor: (movement) => movement.quantity,
        align: "right",
        render: (movement) => (
          <span
            className={
              movement.movement_type === "in"
                ? "font-medium text-emerald-600"
                : movement.movement_type === "out"
                  ? "font-medium text-red-600"
                  : "font-medium"
            }
          >
            {getQuantityLabel(movement)}
          </span>
        ),
      },
      {
        key: "reference_number",
        label: "Reference",
        hideOnMobile: true,
        accessor: (movement) => movement.reference_number || "",
        render: (movement) => (
          <span className="text-muted-foreground text-sm">{movement.reference_number || "None"}</span>
        ),
      },
      {
        key: "created_by_name",
        label: "By",
        accessor: (movement) => movement.created_by_name || "",
        hideOnMobile: true,
        render: (movement) => (
          <span className="text-muted-foreground text-sm">{movement.created_by_name || "System"}</span>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<StockMovement>[]>(
    () => [
      {
        key: "movement_type",
        label: "Movement Type",
        options: movementTypeOptions,
      },
      {
        key: "product_name",
        label: "Product",
        options: productOptions,
      },
      {
        key: "quantity_band",
        label: "Quantity Range",
        mode: "custom",
        options: quantityBandOptions,
        filterFn: (movement, value) => {
          const quantity = movement.quantity
          const resolve = (entry: string) => {
            if (entry === "1-10") return quantity >= 1 && quantity <= 10
            if (entry === "11-50") return quantity >= 11 && quantity <= 50
            if (entry === "51+") return quantity >= 51
            return false
          }
          if (Array.isArray(value)) {
            return value.some(resolve)
          }
          return resolve(value)
        },
      },
    ],
    [movementTypeOptions, productOptions, quantityBandOptions]
  )

  return (
    <DataTablePage
      title="Stock Movements"
      description="Review stock inflows, outflows, adjustments, and transfer activity."
      icon={Boxes}
      backLink={{ href: "/admin/inventory", label: "Back to Inventory" }}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Movements"
            value={stats.total}
            icon={ArrowUpDown}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Stock In"
            value={`+${stats.stockIn}`}
            icon={ArrowDown}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Stock Out"
            value={`-${stats.stockOut}`}
            icon={ArrowUp}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Transfers"
            value={stats.transfers}
            icon={ClipboardList}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<StockMovement>
        data={movements}
        columns={columns}
        filters={filters}
        getRowId={(movement) => movement.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search product, reference, note, or operator..."
        searchFn={(movement, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            (movement.product_name || "").toLowerCase().includes(normalizedQuery) ||
            (movement.reference_number || "").toLowerCase().includes(normalizedQuery) ||
            (movement.notes || "").toLowerCase().includes(normalizedQuery) ||
            (movement.created_by_name || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        expandable={{
          render: (movement) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Product</p>
                <p className="mt-2 text-sm font-medium">{movement.product_name || "Unknown product"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Operator</p>
                <p className="mt-2 text-sm">{movement.created_by_name || "System"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Reference</p>
                <p className="mt-2 text-sm">{movement.reference_number || "No reference number"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Notes</p>
                <p className="mt-2 text-sm">{movement.notes || "No notes added"}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(movement) => {
          const Icon = typeIcons[movement.movement_type]
          return (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{movement.product_name || "Unknown product"}</p>
                  <p className="text-muted-foreground text-sm">{formatDate(movement.created_at)}</p>
                </div>
                <Badge variant={typeColors[movement.movement_type]} className="capitalize">
                  <Icon className="mr-1 h-3 w-3" />
                  {movement.movement_type}
                </Badge>
              </div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Quantity</span>
                  <span>{getQuantityLabel(movement)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Reference</span>
                  <span>{movement.reference_number || "None"}</span>
                </div>
              </div>
            </div>
          )
        }}
        emptyTitle="No movements yet"
        emptyDescription="Stock movements will appear here as inventory changes happen."
        emptyIcon={Package2}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
