import Link from "next/link"
import {
  Award,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { getAdminPmsData } from "./_lib"
import { getRequestScope } from "@/lib/admin/api-scope"

const adminPmsLinks = [
  {
    title: "KPI",
    href: "/admin/hr/pms/kpi",
    icon: Target,
    description: "View department KPI drivers and current KPI scores.",
  },
  {
    title: "Goals",
    href: "/admin/hr/pms/goals",
    icon: CheckCircle2,
    description: "See goal volume and approval movement by department.",
  },
  {
    title: "Attendance",
    href: "/admin/hr/pms/attendance",
    icon: Clock3,
    description: "Monitor attendance compliance contributing to PMS.",
  },
  {
    title: "CBT",
    href: "/admin/hr/pms/cbt",
    icon: Brain,
    description: "Track learning capability scores across departments.",
  },
  {
    title: "Behaviour",
    href: "/admin/hr/pms/behaviour",
    icon: ShieldCheck,
    description: "Watch behaviour and leadership scoring in scope.",
  },
  {
    title: "Performance Reviews",
    href: "/admin/hr/pms/reviews",
    icon: FileText,
    description: "Create and manage reviews from the PMS area.",
  },
  {
    title: "Peer Feedback",
    href: "/admin/hr/pms/peer-feedback",
    icon: MessageSquare,
    description: "View all peer feedback submissions across departments.",
  },
  {
    title: "Review Cycles",
    href: "/admin/hr/pms/cycles",
    icon: RefreshCw,
    description: "Create and manage performance review cycles.",
  },
  {
    title: "Analytics",
    href: "/admin/hr/pms/analytics",
    icon: Settings,
    description: "Performance distribution, trends, and calibration data.",
  },
  {
    title: "Development Plans",
    href: "/admin/hr/pms/development-plans",
    icon: BookOpen,
    description: "Create and track employee development plans linked to reviews.",
  },
  {
    title: "Competencies",
    href: "/admin/hr/pms/competencies",
    icon: ShieldCheck,
    description: "Manage behaviour competency keys used in performance reviews.",
  },
]

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-"
}

export async function AdminPmsPage({ basePath }: { basePath?: string } = {}) {
  const base = basePath ?? "/admin"
  const { departments, scopedUserCount, summary } = await getAdminPmsData()
  const scope = await getRequestScope()
  const canAccessCbt = scope?.isAdminLike === true && scope.scopeMode !== "lead"
  const visibleLinks = adminPmsLinks
    .filter((item) => item.href !== "/admin/hr/pms/cbt" || canAccessCbt)
    .map((item) => ({ ...item, href: item.href.replace("/admin", base) }))

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="PMS"
        description="Monitor live KPI, goals, attendance, CBT, behaviour, and reviews from one HR performance area."
        icon={Award}
        backLink={{ href: `${base}/hr`, label: "Back to HR" }}
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
        <StatCard title="Departments" value={departments.length} icon={Award} description="Departments in your scope" />
        <StatCard
          title="Employees"
          value={scopedUserCount}
          icon={Users}
          description="People covered by this PMS view"
        />
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleLinks.map((item) => (
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
    </PageWrapper>
  )
}
