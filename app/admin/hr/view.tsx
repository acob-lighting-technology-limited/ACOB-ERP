"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Award,
  Calendar,
  Clock,
  Users,
  CheckCircle,
  AlertCircle,
  FileText,
  Building,
  MapPin,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { QUERY_KEYS } from "@/lib/query-keys"
import { useAdminScope } from "@/components/admin-scope-context"

interface DashboardStats {
  pendingLeaveRequests: number
  todayAttendance: number
  upcomingReviews: number
  totalEmployees: number
  totalDepartments: number
  totalOfficeLocations: number
}

interface HRAdminDashboardProps {
  basePath?: string
  title?: string
  description?: string
  backLink?: { href: string; label: string }
  showResourceBooking?: boolean
}

async function fetchHrDashboardStats(): Promise<DashboardStats> {
  // Department scoping is resolved server-side via getScopedDepartments() —
  // no client-side scope derivation needed.
  const res = await fetch("/api/admin/hr/dashboard-stats", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load HR dashboard stats")
  return res.json()
}

export function HRAdminDashboard({
  basePath = "/admin/hr",
  title = "HR Administration",
  description = "Manage leave approvals, attendance reports, and PMS visibility",
  backLink = { href: "/admin", label: "Back to Admin" },
  showResourceBooking = true,
}: HRAdminDashboardProps = {}) {
  const scope = useAdminScope()
  const canAccessHrResources = showResourceBooking && scope.isAdminLike && scope.scopeMode !== "lead"
  const leavePath = basePath === "/admin/hr" ? `${basePath}/leave/approve` : `${basePath}/leave`

  const {
    data: stats = {
      pendingLeaveRequests: 0,
      todayAttendance: 0,
      upcomingReviews: 0,
      totalEmployees: 0,
      totalDepartments: 0,
      totalOfficeLocations: 0,
    },
  } = useQuery({
    // Include scope-relevant fields so toggling lead mode auto-invalidates
    queryKey: [...QUERY_KEYS.adminHrDashboard(), scope.scopeMode, scope.managedDepartments.join(",")],
    queryFn: () => fetchHrDashboardStats(),
  })

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader title={title} description={description} icon={Users} backLink={backLink} />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-6">
        <StatCard
          title="Pending Leave"
          value={stats.pendingLeaveRequests}
          icon={Calendar}
          description="Requests awaiting approval"
        />
        <StatCard
          title="Today's Attendance"
          value={stats.todayAttendance}
          icon={Clock}
          description="Employees clocked in today"
        />
        <StatCard
          title="Pending Reviews"
          value={stats.upcomingReviews}
          icon={FileText}
          description="Reviews to complete"
        />
        <StatCard
          title="Total Employees"
          value={stats.totalEmployees}
          icon={Users}
          description="Registered employees"
        />
        <StatCard
          title="Total Departments"
          value={stats.totalDepartments}
          icon={Building}
          description="Configured departments"
        />
        <StatCard
          title="Office Locations"
          value={stats.totalOfficeLocations}
          icon={MapPin}
          description="Active office locations"
        />
      </div>

      {/* Admin Actions */}
      <Section title="HR Management">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Employees Management */}
          <Link href={`${basePath}/employees`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-500/60 hover:shadow-xl dark:hover:border-blue-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={Users}
                      fillColor="bg-blue-500"
                      className="h-9 w-9 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:text-blue-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-blue-500">
                      Employees
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-600 dark:text-blue-400"
                  >
                    {stats.totalEmployees} Staff
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Manage employee profiles and information
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Employee Roster</span>
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

          {/* Departments */}
          <Link href={`${basePath}/departments`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/60 hover:shadow-xl dark:hover:border-purple-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={Building}
                      fillColor="bg-purple-500"
                      className="h-9 w-9 rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-600 transition-transform duration-200 group-hover:scale-105 dark:text-purple-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-purple-500">
                      Departments
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-purple-500/20 bg-purple-500/10 px-2.5 py-0.5 text-xs font-bold text-purple-600 dark:text-purple-400"
                  >
                    {stats.totalDepartments} Depts
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">Manage company departments</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Department Units</span>
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

          {/* Office Locations */}
          <Link href={`${basePath}/office-location`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-500/60 hover:shadow-xl dark:hover:border-teal-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={MapPin}
                      fillColor="bg-teal-500"
                      className="h-9 w-9 rounded-lg border border-teal-500/20 bg-teal-500/10 text-teal-600 transition-transform duration-200 group-hover:scale-105 dark:text-teal-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-teal-500">
                      Office Locations
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-teal-500/20 bg-teal-500/10 px-2.5 py-0.5 text-xs font-bold text-teal-600 dark:text-teal-400"
                  >
                    {stats.totalOfficeLocations} Locations
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">View locations and assigned employees</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Physical Offices</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-teal-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-teal-500/60 dark:hover:border-teal-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>

          {/* Leave Approvals */}
          <Link href={leavePath} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/60 hover:shadow-xl dark:hover:border-amber-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={Calendar}
                      fillColor="bg-amber-500"
                      className="h-9 w-9 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 transition-transform duration-200 group-hover:scale-105 dark:text-amber-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-amber-500">
                      Leave Approvals
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400"
                  >
                    {stats.pendingLeaveRequests} Pending
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">Review and approve leave requests</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Leave Queue</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-amber-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-amber-500/60 dark:hover:border-amber-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>

          {/* Resource Booking */}
          {canAccessHrResources && (
            <Link href={`${basePath}/resources`} className="group block">
              <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/60 hover:shadow-xl dark:hover:border-indigo-400/60">
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <IconFill
                        icon={Calendar}
                        fillColor="bg-indigo-500"
                        className="h-9 w-9 rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 transition-transform duration-200 group-hover:scale-105 dark:text-indigo-400"
                        iconClassName="h-5 w-5"
                      />
                      <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-indigo-500">
                        Resource Booking
                      </h3>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 rounded-full border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-bold text-indigo-600 dark:text-indigo-400"
                    >
                      Admin
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Manage shared resources and review booking applications
                  </p>
                </div>
                <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                  <span className="text-muted-foreground text-[11px] font-medium">Shared Assets</span>
                  <IconFill
                    icon={ChevronRight}
                    fillColor="bg-indigo-500"
                    hoverTextClassName="group-hover:text-white"
                    className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-indigo-500/60 dark:hover:border-indigo-400/60"
                    iconClassName="text-muted-foreground h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </Link>
          )}

          {/* Attendance Reports */}
          <Link href={`${basePath}/attendance`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/60 hover:shadow-xl dark:hover:border-emerald-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={Clock}
                      fillColor="bg-emerald-500"
                      className="h-9 w-9 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 transition-transform duration-200 group-hover:scale-105 dark:text-emerald-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-emerald-500">
                      Attendance Reports
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400"
                  >
                    {stats.todayAttendance} Today
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">View and export attendance data</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Clocking Logs</span>
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

          {/* Payroll */}
          <Link href={`${basePath}/payroll`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-500/60 hover:shadow-xl dark:hover:border-blue-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={FileText}
                      fillColor="bg-blue-500"
                      className="h-9 w-9 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:text-blue-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-blue-500">
                      Payroll
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-600 dark:text-blue-400"
                  >
                    Payroll Panel
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Manage payroll periods and calculate payslips
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Payslip Calculations</span>
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

          {/* PMS */}
          <Link href={`${basePath}/pms`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/60 hover:shadow-xl dark:hover:border-amber-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={Award}
                      fillColor="bg-amber-500"
                      className="h-9 w-9 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 transition-transform duration-200 group-hover:scale-105 dark:text-amber-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-amber-500">
                      PMS
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400"
                  >
                    {stats.upcomingReviews} Reviews
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Track live KPI, goals, attendance, CBT, behaviour, and reviews
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Performance System</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-amber-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-amber-500/60 dark:hover:border-amber-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>
        </div>
      </Section>

      {/* Pending Actions */}
      <Section title="Pending Actions">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {stats.pendingLeaveRequests > 0 && (
                <div className="flex items-center gap-4">
                  <AlertCircle className="h-5 w-5 text-orange-500" />
                  <div className="flex-1">
                    <p className="font-medium">{stats.pendingLeaveRequests} pending leave requests</p>
                    <p className="text-muted-foreground text-sm">Require your approval</p>
                  </div>
                  <Link href={leavePath}>
                    <Button size="sm">Review</Button>
                  </Link>
                </div>
              )}

              {stats.todayAttendance > 0 && (
                <div className="flex items-center gap-4">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div className="flex-1">
                    <p className="font-medium">{stats.todayAttendance} employees clocked in</p>
                    <p className="text-muted-foreground text-sm">Today&apos;s attendance</p>
                  </div>
                </div>
              )}

              {stats.upcomingReviews > 0 && (
                <div className="flex items-center gap-4">
                  <FileText className="h-5 w-5 text-blue-500" />
                  <div className="flex-1">
                    <p className="font-medium">{stats.upcomingReviews} reviews pending</p>
                    <p className="text-muted-foreground text-sm">Performance reviews to complete</p>
                  </div>
                  <Link href={`${basePath}/pms/reviews`}>
                    <Button size="sm">Open PMS</Button>
                  </Link>
                </div>
              )}

              {stats.pendingLeaveRequests === 0 && stats.upcomingReviews === 0 && (
                <div className="text-muted-foreground flex items-center gap-4">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <p>All caught up! No pending actions.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}

export default HRAdminDashboard
