import Link from "next/link"
import { Building2, ChevronRight, ClipboardCheck, CreditCard, Landmark, Wallet } from "lucide-react"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"
import { getCurrentUserAccountsData } from "./_lib"

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—"
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount)
}

export default async function AccountsPage() {
  const { profile, requisitions, payments, payroll, assets } = await getCurrentUserAccountsData()

  const accountsAreaCards = [
    {
      title: "Requisitions",
      description: "Submit purchase and funding requests, track department endorsements, and check payout progress.",
      href: "/requisition",
      icon: ClipboardCheck,
      badge:
        requisitions.pendingCount > 0 ? `${requisitions.pendingCount} In Review` : `${requisitions.totalCount} Total`,
      subLabel: "Funding & Approvals",
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      fill: "bg-amber-500",
      hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
      hoverText: "group-hover:text-amber-500",
    },
    {
      title: "Payments",
      description:
        "View department payment vouchers, disbursement dates, payment categories, and official payment receipts.",
      href: "/payments",
      icon: CreditCard,
      badge: `${payments.totalCount} Vouchers`,
      subLabel: "Disbursements & Receipts",
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      fill: "bg-emerald-500",
      hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
      hoverText: "group-hover:text-emerald-500",
    },
    {
      title: "My Payroll",
      description:
        "Access your monthly pay slips, salary breakdowns, allowances, statutory deductions, and compensation details.",
      href: "/payroll",
      icon: Wallet,
      badge: payroll.latestStatus ? payroll.latestStatus.toUpperCase() : "Payslips",
      subLabel: payroll.latestPeriodName || "Salary & Pay Slips",
      color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
      fill: "bg-cyan-500",
      hoverBorder: "hover:border-cyan-500/60 dark:hover:border-cyan-400/60",
      hoverText: "group-hover:text-cyan-500",
    },
    {
      title: "Assigned Assets",
      description:
        "Track physical equipment, workstations, devices, and company assets assigned to you or report issues.",
      href: "/assets",
      icon: Building2,
      badge: `${assets.assignedCount} Assets`,
      subLabel: "Equipment & Custody",
      color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      fill: "bg-sky-500",
      hoverBorder: "hover:border-sky-500/60 dark:hover:border-sky-400/60",
      hoverText: "group-hover:text-sky-500",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Accounts"
        description={`Track your funding requisitions, payment vouchers, payroll records, and assigned company assets${profile?.department ? ` in ${profile.department}` : ""}.`}
        icon={Landmark}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatCard
          variant="compact"
          title="My Requisitions"
          value={requisitions.totalCount}
          icon={ClipboardCheck}
          description={
            requisitions.pendingCount > 0
              ? `${requisitions.pendingCount} pending approval`
              : "All requisitions processed"
          }
        />
        <StatCard
          variant="compact"
          title="Dept Payments"
          value={payments.totalCount}
          icon={CreditCard}
          description={payments.dueCount > 0 ? `${payments.dueCount} pending / due payments` : "All payments settled"}
        />
        <StatCard
          variant="compact"
          title="Latest Net Pay"
          value={payroll.latestNetSalary !== null ? formatCurrency(payroll.latestNetSalary) : "Available"}
          icon={Wallet}
          description={payroll.latestPeriodName || "Monthly salary records"}
        />
        <StatCard
          variant="compact"
          title="Assigned Assets"
          value={assets.assignedCount}
          icon={Building2}
          description="Equipment in your custody"
          className="hidden sm:block"
        />
      </div>

      <Section title="Accounts Areas" description="Select an accounts module below to view details or perform actions.">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-2">
          {accountsAreaCards.map((item) => (
            <Link key={item.href} href={item.href} className="group block">
              <div
                className={cn(
                  "bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
                  item.hoverBorder
                )}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <IconFill
                        icon={item.icon}
                        fillColor={item.fill}
                        className={cn(
                          "h-9 w-9 rounded-lg border transition-transform duration-200 group-hover:scale-105",
                          item.color
                        )}
                        iconClassName="h-5 w-5"
                      />
                      <h3 className={cn("text-foreground text-base font-semibold transition-colors", item.hoverText)}>
                        {item.title}
                      </h3>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", item.color)}
                    >
                      {item.badge}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{item.description}</p>
                </div>
                <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                  <span className="text-muted-foreground text-[11px] font-medium">{item.subLabel}</span>
                  <IconFill
                    icon={ChevronRight}
                    fillColor={item.fill}
                    hoverTextClassName="group-hover:text-white"
                    className={cn(
                      "border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5",
                      item.hoverBorder
                    )}
                    iconClassName="text-muted-foreground h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        title="How Accounts Works"
        description="Understand how financial requests and payments operate within the ERP."
      >
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>
              Requisitions allow team members to request funding for project activities and operational procurement.
              Once endorsed by your department lead and approved by finance, payments are disbursed.
            </p>
            <p>
              Department payment vouchers keep an auditable ledger of all organizational disbursements, attached with
              official receipts and supplier invoices.
            </p>
            <p>
              Payroll slips are generated at each pay cycle, providing transparent accounting of earnings, taxes, and
              deductions.
            </p>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
