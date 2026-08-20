"use client"

import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Package, Boxes, Warehouse, ArrowUpDown, AlertTriangle, TrendingUp } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { IconFill } from "@/components/ui/icon-fill"

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
        backLink={{ href: "/admin/accounts", label: "Back to Accounts" }}
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
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Package}
                  fillColor="bg-blue-500"
                  className="h-8 w-8 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:text-blue-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-blue-500">Products</span>
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
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Boxes}
                  fillColor="bg-purple-500"
                  className="h-8 w-8 rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-600 transition-transform duration-200 group-hover:scale-105 dark:text-purple-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-purple-500">Categories</span>
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
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Warehouse}
                  fillColor="bg-teal-500"
                  className="h-8 w-8 rounded-lg border border-teal-500/20 bg-teal-500/10 text-teal-600 transition-transform duration-200 group-hover:scale-105 dark:text-teal-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-teal-500">Warehouses</span>
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
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={ArrowUpDown}
                  fillColor="bg-emerald-500"
                  className="h-8 w-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 transition-transform duration-200 group-hover:scale-105 dark:text-emerald-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-emerald-500">Stock Movements</span>
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
