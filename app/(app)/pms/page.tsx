import Link from "next/link"
import { Award, BookOpen, Brain, CheckCircle2, Clock3, ShieldCheck, Target, TrendingUp } from "lucide-react"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { getCurrentUserPmsData } from "./_lib"
import { CycleSelector } from "./_components/cycle-selector"

const pmsLinks = [
  {
    title: "KPI",
    description: "See your approved goal breakdown and current KPI score.",
    href: "/pms/kpi",
    icon: Target,
  },
  {
    title: "Goals",
    description: "Open your goals workspace and track approved deliverables.",
    href: "/pms/goals",
    icon: CheckCircle2,
  },
  {
    title: "Attendance",
    description: "Watch your attendance score and recent clocking activity.",
    href: "/pms/attendance",
    icon: Clock3,
  },
  {
    title: "CBT",
    description: "View your CBT scores by quarter from PMS.",
    href: "/pms/cbt",
    icon: Brain,
  },
  {
    title: "Behaviour",
    description: "View behaviour scoring from current review and feedback signals.",
    href: "/pms/behaviour",
    icon: ShieldCheck,
  },
  {
    title: "Performance Reviews",
    description: "Open your completed reviews and acknowledgements.",
    href: "/pms/reviews",
    icon: TrendingUp,
  },
  {
    title: "Development Plans",
    description: "View and track your personal development goals and action steps.",
    href: "/pms/development-plans",
    icon: BookOpen,
  },
]

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-"
}

export default async function PmsPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle_id?: string }>
}) {
  const { cycle_id } = await searchParams
  const { profile, score, cycles, activeCycleId, goalSummary, attendance, latestReview } =
    await getCurrentUserPmsData(cycle_id)
  const employeeName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Employee"

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="PMS"
        description={`Track your live performance scores across KPI, goals, attendance, CBT, behaviour, and reviews${profile?.department ? ` in ${profile.department}` : ""}.`}
        icon={Award}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
        actions={<CycleSelector cycles={cycles} activeCycleId={activeCycleId} />}
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
        <StatCard
          title="Overall PMS"
          value={formatPercent(score.final_score)}
          icon={Award}
          description="Live overall score"
        />
        <StatCard
          title="KPI"
          value={formatPercent(score.kpi_score)}
          icon={Target}
          description={`${goalSummary.approved} approved goals`}
        />
        <StatCard
          title="Attendance"
          value={formatPercent(score.attendance_score)}
          icon={Clock3}
          description={`${attendance.presentDays}/${attendance.trackedDays || 0} recent days positive`}
        />
        <StatCard title="CBT" value={formatPercent(score.cbt_score)} icon={Brain} description="Learning score in PMS" />
        <StatCard
          title="Behaviour"
          value={formatPercent(score.behaviour_score)}
          icon={ShieldCheck}
          description="Manager and peer feedback blend"
        />
        <StatCard
          title="Last Review"
          value={
            latestReview?.final_score !== null && latestReview?.final_score !== undefined
              ? `${latestReview.final_score}%`
              : "No review"
          }
          icon={TrendingUp}
          description={
            latestReview ? `Status: ${latestReview.status || "draft"}` : `${employeeName} has no recorded review yet`
          }
        />
      </div>

      <Section title="Performance Areas" description="Open each PMS area to see the live score details behind it.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pmsLinks.map((item) => (
            <Card key={item.href}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <item.icon className="text-primary h-5 w-5" />
                  {item.title}
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href={item.href}>
                  <Button className="w-full">Open {item.title}</Button>
                </Link>
              </CardContent>
            </Card>
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
