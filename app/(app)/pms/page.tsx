import Link from "next/link"
import {
  Award,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ShieldCheck,
  Target,
  TrendingUp,
} from "lucide-react"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"
import { getCurrentUserPmsData } from "./_lib"
import { CycleSelector } from "./_components/cycle-selector"

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-"
}

export default async function PmsPage({ searchParams }: { searchParams: Promise<{ cycle_id?: string }> }) {
  const { cycle_id } = await searchParams
  const { profile, score, cycles, activeCycleId, goalSummary, attendance, latestReview } =
    await getCurrentUserPmsData(cycle_id)

  const pmsAreaCards = [
    {
      title: "KPI",
      description: "See your approved goal breakdown and current KPI score.",
      href: "/pms/kpi",
      icon: Target,
      score: formatPercent(score.kpi_score),
      scoreSub: `${goalSummary.approved} approved goals`,
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      fill: "bg-blue-500",
      hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
      hoverText: "group-hover:text-blue-500",
    },
    {
      title: "Goals",
      description: "Open your goals workspace and track approved deliverables.",
      href: "/pms/goals",
      icon: CheckCircle2,
      score: `${goalSummary.approved}`,
      scoreSub: `${goalSummary.completed} completed goals`,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      fill: "bg-emerald-500",
      hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
      hoverText: "group-hover:text-emerald-500",
    },
    {
      title: "Attendance",
      description: "Watch your attendance score and recent clocking activity.",
      href: "/pms/attendance",
      icon: Clock3,
      score: formatPercent(score.attendance_score),
      scoreSub: `${attendance.presentDays}/${attendance.trackedDays || 0} days positive`,
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      fill: "bg-amber-500",
      hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
      hoverText: "group-hover:text-amber-500",
    },
    {
      title: "CBT",
      description: "View your CBT scores by quarter from PMS.",
      href: "/pms/cbt",
      icon: Brain,
      score: formatPercent(score.cbt_score),
      scoreSub: "Learning score in PMS",
      color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
      fill: "bg-violet-500",
      hoverBorder: "hover:border-violet-500/60 dark:hover:border-violet-400/60",
      hoverText: "group-hover:text-violet-500",
    },
    {
      title: "Behaviour",
      description: "View behaviour scoring from current review and feedback signals.",
      href: "/pms/behaviour",
      icon: ShieldCheck,
      score: formatPercent(score.behaviour_score),
      scoreSub: "Manager & peer feedback",
      color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      fill: "bg-purple-500",
      hoverBorder: "hover:border-purple-500/60 dark:hover:border-purple-400/60",
      hoverText: "group-hover:text-purple-500",
    },
    {
      title: "Performance Reviews",
      description: "Open your completed reviews and acknowledgements.",
      href: "/pms/reviews",
      icon: TrendingUp,
      score:
        latestReview?.final_score !== null && latestReview?.final_score !== undefined
          ? `${latestReview.final_score}%`
          : latestReview?.status || "Draft",
      scoreSub: latestReview ? `Status: ${latestReview.status || "draft"}` : "No review yet",
      color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      fill: "bg-indigo-500",
      hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
      hoverText: "group-hover:text-indigo-500",
    },
    {
      title: "Development Plans",
      description: "View and track your personal development goals and action steps.",
      href: "/pms/development-plans",
      icon: BookOpen,
      score: "Active",
      scoreSub: "Personal growth & actions",
      color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
      fill: "bg-teal-500",
      hoverBorder: "hover:border-teal-500/60 dark:hover:border-teal-400/60",
      hoverText: "group-hover:text-teal-500",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="PMS"
        description={`Track your live performance scores across KPI, goals, attendance, CBT, behaviour, and reviews${profile?.department ? ` in ${profile.department}` : ""}.`}
        icon={Award}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
        actions={<CycleSelector cycles={cycles} activeCycleId={activeCycleId} />}
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5">
        <StatCard
          variant="compact"
          title="Overall PMS"
          value={formatPercent(score.final_score)}
          icon={Award}
          description="Live overall score"
        />
        <StatCard
          variant="compact"
          title="KPI"
          value={formatPercent(score.kpi_score)}
          icon={Target}
          description={`${goalSummary.approved} approved goals`}
        />
        <StatCard
          variant="compact"
          title="Attendance"
          value={formatPercent(score.attendance_score)}
          icon={Clock3}
          description={`${attendance.presentDays}/${attendance.trackedDays || 0} recent days positive`}
        />
        <StatCard
          variant="compact"
          title="CBT"
          value={formatPercent(score.cbt_score)}
          icon={Brain}
          description="Learning score in PMS"
        />
        <StatCard
          variant="compact"
          title="Behaviour"
          value={formatPercent(score.behaviour_score)}
          icon={ShieldCheck}
          description="Manager and peer feedback blend"
        />
      </div>

      <Section title="Performance Areas" description="Open each PMS area to see the live score details behind it.">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {pmsAreaCards.map((item) => (
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
                      {item.score}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{item.description}</p>
                </div>
                <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                  <span className="text-muted-foreground text-[11px] font-medium">{item.scoreSub}</span>
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
        title="How This Updates"
        description="These scores refresh from the same ERP records used for goals, attendance, and review workflows."
      >
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>
              KPI is calculated from approved goals and linked task completion. Attendance reflects your tracked
              workdays, while behaviour comes from review feedback already in the ERP.
            </p>
            <p>
              CBT scores appear here inside PMS, while the live objective test itself runs separately on the standalone
              /cbt page.
            </p>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
