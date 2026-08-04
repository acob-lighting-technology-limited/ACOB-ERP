"use client"

import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Package, Boxes, Warehouse, ArrowUpDown, AlertTriangle, TrendingUp } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"

async function fetchInventoryStats(): Promise<InventoryStats> {
  const res = await fetch("/api/admin/inventory/stats", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load inventory stats")
  return res.json()
}

interface InventoryStats {
  totalProducts: number
  totalCategories: number
  totalWarehouses: number
  lowStockItems: number
  totalValue: number
}

export default function InventoryDashboard() {
  const {
    data: stats = { totalProducts: 0, totalCategories: 0, totalWarehouses: 0, lowStockItems: 0, totalValue: 0 },
  } = useQuery({
    queryKey: QUERY_KEYS.adminInventoryDashboard(),
    queryFn: fetchInventoryStats,
  })

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount)
  }

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Inventory"
        description="Manage products, stock levels, and warehouses"
        icon={Package}
        backLink={{ href: "/admin/finance", label: "Back to Finance" }}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Products"
          value={stats.totalProducts}
          icon={Package}
          description={`In ${stats.totalCategories} categories`}
        />
        <StatCard
          title="Inventory Value"
          value={formatCurrency(stats.totalValue)}
          icon={TrendingUp}
          description="Total stock value"
        />
        <StatCard title="Warehouses" value={stats.totalWarehouses} icon={Warehouse} description="Storage locations" />
        <StatCard
          title="Low Stock"
          value={stats.lowStockItems}
          icon={AlertTriangle}
          iconBgColor="bg-orange-100 dark:bg-orange-900/30"
          iconColor="text-orange-600 dark:text-orange-400"
          description="Items need reorder"
        />
      </div>

      {/* Module Cards */}
      <Section title="Inventory Management">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {/* Products */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Products
              </CardTitle>
              <CardDescription>Manage your product catalog</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/admin/inventory/products">
                <Button className="w-full">View Products ({stats.totalProducts})</Button>
              </Link>
              <Link href="/admin/inventory/products?openCreate=1">
                <Button className="w-full" variant="outline">
                  Add Product
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="h-5 w-5" />
                Categories
              </CardTitle>
              <CardDescription>Organize products by category</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/admin/inventory/categories">
                <Button className="w-full">View Categories ({stats.totalCategories})</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Warehouses */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Warehouse className="h-5 w-5" />
                Warehouses
              </CardTitle>
              <CardDescription>Manage storage locations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/admin/inventory/warehouses">
                <Button className="w-full">View Warehouses ({stats.totalWarehouses})</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Stock Movements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5" />
                Stock Movements
              </CardTitle>
              <CardDescription>Track stock in and out</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/admin/inventory/movements">
                <Button className="w-full" variant="outline">
                  View Movements
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Info Banner */}
      <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
        <CardContent className="flex items-start gap-4 p-6">
          <AlertTriangle className="mt-1 h-6 w-6 text-orange-600" />
          <div>
            <h3 className="font-semibold text-orange-800 dark:text-orange-200">Database Tables Required</h3>
            <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
              To use the Inventory module, you need to create the following database tables:
              <code className="mx-1 rounded bg-orange-100 px-1 dark:bg-orange-900">products</code>,
              <code className="mx-1 rounded bg-orange-100 px-1 dark:bg-orange-900">product_categories</code>,
              <code className="mx-1 rounded bg-orange-100 px-1 dark:bg-orange-900">warehouses</code>, and
              <code className="mx-1 rounded bg-orange-100 px-1 dark:bg-orange-900">stock_movements</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </PageWrapper>
  )
}
