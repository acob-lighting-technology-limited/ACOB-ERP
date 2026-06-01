import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Calendar, Clock, MapPin, Award, FileText } from "lucide-react"
import Link from "next/link"
import { toLocalISODate } from "@/lib/utils/date"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptHrPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepts = expandDepartmentScopeForQuery([deptName])

  const base = `/dept/${dept_id}/hr`

  const [employeeCount, pendingLeave, attendanceToday] = await Promise.all([
    expandedDepts.length > 0
      ? dataClient.from("profiles").select("*", { count: "exact", head: true }).in("department", expandedDepts)
      : { count: 0 },
    expandedDepts.length > 0
      ? dataClient
          .from("leave_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending")
          .in(
            "user_id",
            await dataClient
              .from("profiles")
              .select("id")
              .in("department", expandedDepts)
              .then((r) => (r.data || []).map((p) => p.id))
          )
      : { count: 0 },
    expandedDepts.length > 0
      ? dataClient
          .from("attendance_records")
          .select("*", { count: "exact", head: true })
          .eq("date", toLocalISODate())
          .in(
            "user_id",
            await dataClient
              .from("profiles")
              .select("id")
              .in("department", expandedDepts)
              .then((r) => (r.data || []).map((p) => p.id))
          )
      : { count: 0 },
  ])

  const cards = [
    {
      title: "Employees",
      description: "View and manage team members in this department.",
      href: `${base}/employees`,
      icon: Users,
      stat: employeeCount.count ?? 0,
      statLabel: "members",
    },
    {
      title: "Attendance",
      description: "Track daily attendance and manage records.",
      href: `${base}/attendance`,
      icon: Clock,
      stat: attendanceToday.count ?? 0,
      statLabel: "checked in today",
    },
    {
      title: "Leave",
      description: "Review and approve leave requests from your team.",
      href: `${base}/leave`,
      icon: Calendar,
      stat: pendingLeave.count ?? 0,
      statLabel: "pending approvals",
    },
    {
      title: "Office Location",
      description: "Manage and view office location assignments.",
      href: `${base}/office-location`,
      icon: MapPin,
      stat: null,
      statLabel: null,
    },
    {
      title: "PMS",
      description: "Performance management — goals, reviews, KPIs and development plans.",
      href: `${base}/pms`,
      icon: Award,
      stat: null,
      statLabel: null,
    },
    {
      title: "Departments",
      description: "View department structure and details.",
      href: `${base}/departments`,
      icon: FileText,
      stat: null,
      statLabel: null,
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader title={`${scope.deptName} — HR`} description="Manage your team's HR operations." icon={Users} />
      <Section title="HR Modules">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Card key={card.href}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <card.icon className="h-5 w-5" />
                  {card.title}
                </CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {card.stat !== null && (
                  <p className="mb-3 text-2xl font-bold">
                    {card.stat} <span className="text-muted-foreground text-sm font-normal">{card.statLabel}</span>
                  </p>
                )}
                <Link href={card.href}>
                  <Button className="w-full" variant="outline">
                    Open {card.title}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </PageWrapper>
  )
}
