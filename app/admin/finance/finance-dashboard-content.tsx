"use client"

import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { DollarSign, CreditCard, Clock, AlertCircle, Package, ShoppingCart, ChevronRight } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"

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
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Payments Folder */}
          <Link href={`${base}/finance/payments`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/60 hover:shadow-xl dark:hover:border-emerald-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={CreditCard}
                      fillColor="bg-emerald-500"
                      className="h-9 w-9 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 transition-transform duration-200 group-hover:scale-105 dark:text-emerald-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-emerald-500">
                      Payments
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400"
                  >
                    {stats.totalPayments} Vouchers
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Manage department payments and related finance records
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Payment Records</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-emerald-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-emerald-500/60 dark:hover:border-emerald-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>

          {/* Inventory Folder */}
          <Link href={`${base}/inventory`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-500/60 hover:shadow-xl dark:hover:border-blue-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={Package}
                      fillColor="bg-blue-500"
                      className="h-9 w-9 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:text-blue-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-blue-500">
                      Inventory
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-600 dark:text-blue-400"
                  >
                    Stock Manager
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Manage products, stock levels, categories, and warehouses
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Stock & Warehouses</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-blue-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-blue-500/60 dark:hover:border-blue-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>

          {/* Purchasing Folder */}
          <Link href={`${base}/purchasing`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/60 hover:shadow-xl dark:hover:border-purple-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={ShoppingCart}
                      fillColor="bg-purple-500"
                      className="h-9 w-9 rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-600 transition-transform duration-200 group-hover:scale-105 dark:text-purple-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-purple-500">
                      Purchasing
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-purple-500/20 bg-purple-500/10 px-2.5 py-0.5 text-xs font-bold text-purple-600 dark:text-purple-400"
                  >
                    Orders & Suppliers
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Manage suppliers, purchase orders, and goods receipts
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Procurement</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-purple-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-purple-500/60 dark:hover:border-purple-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>
        </div>
      </Section>
    </PageWrapper>
  )
}
