import Link from "next/link"
import {
  Award,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldCheck,
  Target,
} from "lucide-react"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"
import { getAdminPmsData } from "./_lib"
import { getRequestScope } from "@/lib/admin/api-scope"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getCbtSettings, canAccessCbt } from "@/lib/cbt-config"
import { CycleSelector } from "@/app/(app)/pms/_components/cycle-selector"

const adminPmsLinks = [
  {
    title: "KPI",
    href: "/admin/hr/pms/kpi",
    icon: Target,
    description: "View department KPI drivers and current KPI scores.",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    fill: "bg-blue-500",
    hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
    hoverText: "group-hover:text-blue-500",
    subLabel: "KPI drivers & scores",
  },
  {
    title: "Goals",
    href: "/admin/hr/pms/goals",
    icon: CheckCircle2,
    description: "See goal volume and approval movement by department.",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    fill: "bg-emerald-500",
    hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
    hoverText: "group-hover:text-emerald-500",
    subLabel: "Goal approvals & deliverables",
  },
  {
    title: "Attendance",
    href: "/admin/hr/pms/attendance",
    icon: Clock3,
    description: "Monitor attendance compliance contributing to PMS.",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    fill: "bg-amber-500",
    hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
    hoverText: "group-hover:text-amber-500",
    subLabel: "Clocking compliance in PMS",
  },
  {
    title: "CBT",
    href: "/admin/hr/pms/cbt",
    icon: Brain,
    description: "Track learning capability scores across departments.",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    fill: "bg-violet-500",
    hoverBorder: "hover:border-violet-500/60 dark:hover:border-violet-400/60",
    hoverText: "group-hover:text-violet-500",
    subLabel: "Learning scores",
  },
  {
    title: "Behaviour",
    href: "/admin/hr/pms/behaviour",
    icon: ShieldCheck,
    description: "Watch behaviour and leadership scoring in scope.",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    fill: "bg-purple-500",
    hoverBorder: "hover:border-purple-500/60 dark:hover:border-purple-400/60",
    hoverText: "group-hover:text-purple-500",
    subLabel: "Feedback & leadership blend",
  },
  {
    title: "Performance Reviews",
    href: "/admin/hr/pms/reviews",
    icon: FileText,
    description: "Create and manage reviews from the PMS area.",
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    fill: "bg-indigo-500",
    hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
    hoverText: "group-hover:text-indigo-500",
    subLabel: "Review forms & acknowledgements",
  },
  {
    title: "Peer Feedback",
    href: "/admin/hr/pms/peer-feedback",
    icon: MessageSquare,
    description: "View all peer feedback submissions across departments.",
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
    fill: "bg-teal-500",
    hoverBorder: "hover:border-teal-500/60 dark:hover:border-teal-400/60",
    hoverText: "group-hover:text-teal-500",
    subLabel: "Peer evaluation logs",
  },
  {
    title: "Review Cycles",
    href: "/admin/hr/pms/cycles",
    icon: RefreshCw,
    description: "Create and manage performance review cycles.",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    fill: "bg-blue-500",
    hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
    hoverText: "group-hover:text-blue-500",
    subLabel: "Quarterly & annual cycles",
  },
  {
    title: "Analytics",
    href: "/admin/hr/pms/analytics",
    icon: Settings,
    description: "Performance distribution, trends, and calibration data.",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    fill: "bg-orange-500",
    hoverBorder: "hover:border-orange-500/60 dark:hover:border-orange-400/60",
    hoverText: "group-hover:text-orange-500",
    subLabel: "Calibration & distribution",
  },
  {
    title: "Development Plans",
    href: "/admin/hr/pms/development-plans",
    icon: BookOpen,
    description: "Create and track employee development plans linked to reviews.",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    fill: "bg-emerald-500",
    hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
    hoverText: "group-hover:text-emerald-500",
    subLabel: "Personal growth & actions",
  },
  {
    title: "Competencies",
    href: "/admin/hr/pms/competencies",
    icon: ShieldCheck,
    description: "Manage behaviour competency keys used in performance reviews.",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    fill: "bg-purple-500",
    hoverBorder: "hover:border-purple-500/60 dark:hover:border-purple-400/60",
    hoverText: "group-hover:text-purple-500",
    subLabel: "Scoring rubric keys",
  },
]

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-"
}

export async function AdminPmsPage({ basePath, cycleId }: { basePath?: string; cycleId?: string } = {}) {
  const base = basePath ?? "/admin"
  const supabase = await createClient()
  const db = getServiceRoleClientOrFallback(supabase)
  const [{ summary, cycles, activeCycleId }, scope, cbtSettings] = await Promise.all([
    getAdminPmsData(cycleId),
    getRequestScope(),
    getCbtSettings(db),
  ])
  const canAccessCbtCard = canAccessCbt(scope, cbtSettings)
  const visibleLinks = adminPmsLinks
    .filter((item) => item.href !== "/admin/hr/pms/cbt" || canAccessCbtCard)
    .map((item) => ({ ...item, href: item.href.replace("/admin", base) }))

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="PMS"
        description="Monitor live KPI, goals, attendance, CBT, behaviour, and reviews from one HR performance area."
        icon={Award}
        backLink={{ href: `${base}/hr`, label: "Back to HR" }}
        actions={<CycleSelector cycles={cycles} activeCycleId={activeCycleId} />}
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5">
        <StatCard
          title="Avg PMS"
          value={formatPercent(summary.overallPms)}
          icon={Award}
          description="Average department PMS"
        />
        <StatCard
          title="Avg KPI"
          value={formatPercent(summary.overallKpi)}
          icon={Target}
          description="Average department KPI"
        />
        <StatCard
          title="Avg CBT"
          value={formatPercent(summary.cbt)}
          icon={Brain}
          description="Average learning capability score"
        />
        <StatCard
          title="Avg Attendance"
          value={formatPercent(summary.attendance)}
          icon={Clock3}
          description="Attendance compliance"
        />
        <StatCard
          title="Approved Goals"
          value={summary.approvedGoals}
          icon={CheckCircle2}
          description="Approved goals in scope"
        />
      </div>

      <Section
        title="PMS Areas"
        description="Open each route from here as the new home for performance visibility and review actions."
      >
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleLinks.map((item) => (
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
    </PageWrapper>
  )
}
