import { Calendar, CheckCircle, CreditCard, TriangleAlert, Wallet } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"

interface PaymentStats {
  totalDue: number
  totalPaid: number
  countCompleted: number
  countOverdue: number
  countDue: number
}

interface PaymentStatsCardsProps {
  stats: PaymentStats
  formatCurrency: (amount: number, currency: string) => string
}

export function PaymentStatsCards({ stats, formatCurrency }: PaymentStatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
      <StatCard
        title="Total Outstanding"
        value={formatCurrency(stats.totalDue, "NGN")}
        icon={CreditCard}
        iconBgColor="bg-blue-500/10"
        iconColor="text-blue-500"
      />
      <StatCard
        title="Total Paid"
        value={formatCurrency(stats.totalPaid, "NGN")}
        icon={Wallet}
        iconBgColor="bg-emerald-500/10"
        iconColor="text-emerald-500"
      />
      <StatCard
        title="Completed"
        value={stats.countCompleted}
        icon={CheckCircle}
        iconBgColor="bg-violet-500/10"
        iconColor="text-violet-500"
      />
      <StatCard
        title="Overdue"
        value={stats.countOverdue}
        icon={TriangleAlert}
        iconBgColor="bg-red-500/10"
        iconColor="text-red-500"
      />
      <StatCard
        title="Due Soon"
        value={stats.countDue}
        icon={Calendar}
        iconBgColor="bg-amber-500/10"
        iconColor="text-amber-500"
      />
    </div>
  )
}
