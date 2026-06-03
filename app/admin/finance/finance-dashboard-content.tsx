"use client"

import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DollarSign, CreditCard, Clock, AlertCircle, Package, ShoppingCart } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"

interface FinanceStats {
  totalPayments: number
  pendingPayments: number
  paidPayments: number
  totalAmount: number
  recurringPayments: number
  overduePayments: number
}

interface FinancePayment {
  id: string
  title?: string | null
  category?: string | null
  currency?: string | null
  status: string
  amount?: number | null
  payment_type?: string | null
}

async function fetchPayments(departmentId?: string): Promise<FinancePayment[]> {
  const endpoint = departmentId ? `/api/payments?department_id=${encodeURIComponent(departmentId)}` : "/api/payments"
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error("Failed to load finance data")
  const payload = await response.json()
  return payload.data || []
}

export function FinanceDashboardContent({
  basePath,
  lockedDepartmentId,
}: { basePath?: string; lockedDepartmentId?: string } = {}) {
  const base = basePath ?? "/admin"
  const { data: allPayments = [] } = useQuery({
    queryKey: [...QUERY_KEYS.payments(), lockedDepartmentId ?? "all"],
    queryFn: () => fetchPayments(lockedDepartmentId),
  })

  const stats: FinanceStats = {
    totalPayments: allPayments.length,
    pendingPayments: allPayments.filter((p) => p.status === "pending" || p.status === "due").length,
    paidPayments: allPayments.filter((p) => p.status === "paid").length,
    totalAmount: allPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
    recurringPayments: allPayments.filter((p) => p.payment_type === "recurring").length,
    overduePayments: allPayments.filter((p) => p.status === "overdue").length,
  }
  function formatCurrency(amount: number, currency: string | null = "NGN") {
    const safeCurrency = currency || "NGN"
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: safeCurrency,
    }).format(amount)
  }

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Finance"
        description="Manage finance modules: Payments, Inventory, and Purchasing"
        icon={DollarSign}
        backLink={{ href: base, label: "Back" }}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Amount"
          value={formatCurrency(stats.totalAmount)}
          icon={DollarSign}
          description="Across all payments"
        />
        <StatCard
          title="Total Payments"
          value={stats.totalPayments}
          icon={CreditCard}
          description={`${stats.recurringPayments} recurring`}
        />
        <StatCard
          title="Pending"
          value={stats.pendingPayments}
          icon={Clock}
          iconBgColor="bg-orange-100 dark:bg-orange-900/30"
          iconColor="text-orange-600 dark:text-orange-400"
          description="Awaiting payment"
        />
        <StatCard
          title="Overdue"
          value={stats.overduePayments}
          icon={AlertCircle}
          iconBgColor="bg-red-100 dark:bg-red-900/30"
          iconColor="text-red-600 dark:text-red-400"
          description="Require attention"
        />
      </div>

      {/* Finance Modules */}
      <Section title="Finance Modules">
        <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {/* Payments Folder */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payments
              </CardTitle>
              <CardDescription>Manage department payments and related finance records</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href={`${base}/finance/payments`}>
                <Button className="w-full">Open Payments ({stats.totalPayments})</Button>
              </Link>
              <Link href={`${base}/finance/payments`}>
                <Button className="w-full" variant="outline">
                  By Department
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Inventory Folder */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Inventory
              </CardTitle>
              <CardDescription>Manage products, stock levels, categories, and warehouses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href={`${base}/inventory`}>
                <Button className="w-full">Open Inventory</Button>
              </Link>
              <Link href={`${base}/inventory/products`}>
                <Button className="w-full" variant="outline">
                  Products
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Purchasing Folder */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Purchasing
              </CardTitle>
              <CardDescription>Manage suppliers, purchase orders, and goods receipts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href={`${base}/purchasing`}>
                <Button className="w-full">Open Purchasing</Button>
              </Link>
              <Link href={`${base}/purchasing/orders`}>
                <Button className="w-full" variant="outline">
                  Purchase Orders
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Section>
    </PageWrapper>
  )
}
