"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Eye, Package, Pencil, Plus, Tags, Wallet } from "lucide-react"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import type { BadgeProps } from "@/components/ui/badge"
import { ProductFormDialog } from "./_components/product-form-dialog"

interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  category_id: string | null
  category_name?: string
  unit_cost: number
  selling_price: number
  quantity_on_hand: number
  reorder_level: number
  status: "active" | "inactive" | "discontinued"
  created_at: string
}

const statusColors: Record<Product["status"], BadgeProps["variant"]> = {
  active: "default",
  inactive: "secondary",
  discontinued: "destructive",
}

async function fetchProductsList(): Promise<Product[]> {
  const res = await fetch("/api/admin/inventory/products", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load products")
  const json = await res.json()
  return (json.data || []) as Product[]
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(amount)
}

function getStockBand(product: Product) {
  if (product.quantity_on_hand <= product.reorder_level) return "Low"
  if (product.quantity_on_hand <= product.reorder_level * 2) return "Watch"
  return "Healthy"
}

export default function ProductsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [isCreateOpen, setIsCreateOpen] = useState(searchParams.get("openCreate") === "1")
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  const {
    data: products = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminProducts(),
    queryFn: fetchProductsList,
  })

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          products.map((product) => product.category_name).filter((category): category is string => Boolean(category))
        )
      )
        .sort()
        .map((category) => ({ value: category, label: category })),
    [products]
  )

  const statusOptions = useMemo(
    () =>
      ["active", "inactive", "discontinued"].map((status) => ({
        value: status,
        label: status.charAt(0).toUpperCase() + status.slice(1),
      })),
    []
  )

  const stockBandOptions = useMemo(
    () => [
      { value: "Low", label: "Low" },
      { value: "Watch", label: "Watch" },
      { value: "Healthy", label: "Healthy" },
    ],
    []
  )

  const stats = useMemo(() => {
    const total = products.length
    const active = products.filter((product) => product.status === "active").length
    const lowStock = products.filter((product) => product.quantity_on_hand <= product.reorder_level).length
    const totalValue = products.reduce((sum, product) => sum + product.unit_cost * product.quantity_on_hand, 0)

    return { total, active, lowStock, totalValue }
  }, [products])

  const columns = useMemo<DataTableColumn<Product>[]>(
    () => [
      {
        key: "sku",
        label: "SKU",
        sortable: true,
        hideOnMobile: true,
        accessor: (product) => product.sku,
        render: (product) => <span className="font-mono text-sm">{product.sku}</span>,
      },
      {
        key: "name",
        label: "Product",
        sortable: true,
        accessor: (product) => product.name,
        resizable: true,
        initialWidth: 240,
        render: (product) => (
          <div className="space-y-1">
            <p className="font-medium">{product.name}</p>
            <p className="text-muted-foreground text-xs">{product.description || "No description provided"}</p>
          </div>
        ),
      },
      {
        key: "category_name",
        label: "Category",
        sortable: true,
        hideOnMobile: true,
        accessor: (product) => product.category_name || "",
        render: (product) => <span>{product.category_name || "Uncategorized"}</span>,
      },
      {
        key: "unit_cost",
        label: "Cost",
        sortable: true,
        hideOnMobile: true,
        accessor: (product) => product.unit_cost,
        align: "right",
        render: (product) => formatCurrency(product.unit_cost),
      },
      {
        key: "selling_price",
        label: "Price",
        sortable: true,
        accessor: (product) => product.selling_price,
        align: "right",
        render: (product) => formatCurrency(product.selling_price),
      },
      {
        key: "quantity_on_hand",
        label: "Stock",
        sortable: true,
        accessor: (product) => product.quantity_on_hand,
        align: "right",
        render: (product) => (
          <div className="space-y-1 text-right">
            <p
              className={
                product.quantity_on_hand <= product.reorder_level ? "font-medium text-orange-600" : "font-medium"
              }
            >
              {product.quantity_on_hand}
            </p>
            <p className="text-muted-foreground text-xs">Reorder at {product.reorder_level}</p>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (product) => product.status,
        render: (product) => (
          <Badge variant={statusColors[product.status]} className="capitalize">
            {product.status}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Product>[]>(
    () => [
      {
        key: "category_name",
        label: "Category",
        options: categoryOptions,
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "stock_band",
        label: "Stock Band",
        mode: "custom",
        options: stockBandOptions,
        filterFn: (product, value) => {
          const stockBand = getStockBand(product)
          if (Array.isArray(value)) {
            return value.includes(stockBand)
          }
          return stockBand === value
        },
      },
    ],
    [categoryOptions, statusOptions, stockBandOptions]
  )

  return (
    <DataTablePage
      title="Products"
      description="Manage the product catalog, pricing, and stock posture across inventory."
      icon={Package}
      backLink={{ href: "/admin/inventory", label: "Back to Inventory" }}
      actions={
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Product
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Total Products"
            value={stats.total}
            icon={Package}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={stats.active}
            icon={Tags}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Low Stock"
            value={stats.lowStock}
            icon={AlertTriangle}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Stock Value"
            value={formatCurrency(stats.totalValue)}
            icon={Wallet}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<Product>
        data={products}
        columns={columns}
        filters={filters}
        getRowId={(product) => product.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search product name, SKU, or description..."
        searchFn={(product, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            product.name.toLowerCase().includes(normalizedQuery) ||
            product.sku.toLowerCase().includes(normalizedQuery) ||
            (product.description || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={[
          {
            label: "View Stock",
            icon: Eye,
            onClick: (product) => router.push(`/admin/inventory/products/${product.id}`),
          },
          {
            label: "Edit",
            icon: Pencil,
            onClick: (product) => setEditingProduct(product),
          },
        ]}
        expandable={{
          render: (product) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Description</p>
                <p className="mt-2 text-sm">{product.description || "No description provided"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Category</p>
                <p className="mt-2 text-sm">{product.category_name || "Uncategorized"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Reorder Level</p>
                <p className="mt-2 text-sm font-medium">{product.reorder_level}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Stock Band</p>
                <p className="mt-2 text-sm font-medium">{getStockBand(product)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (product) =>
            product.quantity_on_hand <= 0
              ? "bg-rose-500"
              : product.status === "active"
                ? "bg-emerald-500"
                : "bg-slate-400",
          title: (product) => product.name,
          subtitle: (product) =>
            `${product.sku} · ${product.category_name || "Uncategorized"} · Stock: ${product.quantity_on_hand}`,
          trailing: (product) => (
            <Badge variant={statusColors[product.status]} className="text-[10px] capitalize">
              {product.status}
            </Badge>
          ),
          onSelect: (product) => setEditingProduct(product),
        }}
        cardRenderer={(product) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{product.name}</p>
                <p className="text-muted-foreground text-sm">{product.sku}</p>
              </div>
              <Badge variant={statusColors[product.status]} className="capitalize">
                {product.status}
              </Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Category</span>
                <span>{product.category_name || "Uncategorized"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Stock</span>
                <span>{product.quantity_on_hand}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No products yet"
        emptyDescription="Add your first product to start managing inventory."
        emptyIcon={Package}
        skeletonRows={5}
        urlSync
      />
      <ProductFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} queryClient={queryClient} />
      <ProductFormDialog
        open={editingProduct !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProduct(null)
          }
        }}
        queryClient={queryClient}
        product={
          editingProduct
            ? {
                id: editingProduct.id,
                sku: editingProduct.sku,
                name: editingProduct.name,
                description: editingProduct.description || "",
                category_id: editingProduct.category_id || "",
                unit_cost: editingProduct.unit_cost,
                selling_price: editingProduct.selling_price,
                quantity_on_hand: editingProduct.quantity_on_hand,
                reorder_level: editingProduct.reorder_level,
                status: editingProduct.status,
              }
            : null
        }
      />
    </DataTablePage>
  )
}
