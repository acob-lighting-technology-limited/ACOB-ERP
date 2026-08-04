"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Award, Calendar, Clock, Users, CheckCircle, AlertCircle, FileText, Building, MapPin } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
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
        <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {/* Employees Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Employees
              </CardTitle>
              <CardDescription>Manage employee profiles and information</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/employees`}>
                <Button className="w-full">Manage Employees ({stats.totalEmployees})</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Departments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Departments
              </CardTitle>
              <CardDescription>Manage company departments</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/departments`}>
                <Button className="w-full">Manage Departments ({stats.totalDepartments})</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Office Locations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Office Locations
              </CardTitle>
              <CardDescription>View locations and assigned employees</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/office-location`}>
                <Button className="w-full">Manage Locations ({stats.totalOfficeLocations})</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Leave Approvals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Leave Approvals
              </CardTitle>
              <CardDescription>Review and approve leave requests</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={leavePath}>
                <Button className="w-full">Approve Requests ({stats.pendingLeaveRequests})</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Resource Booking */}
          {canAccessHrResources && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Resource Booking
                </CardTitle>
                <CardDescription>Manage shared resources and review booking applications</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href={`${basePath}/resources`}>
                  <Button className="w-full">Open Resource Booking Admin</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Attendance Reports */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Attendance Reports
              </CardTitle>
              <CardDescription>View and export attendance data</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/attendance`}>
                <Button className="w-full">View Reports</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Payroll */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Payroll
              </CardTitle>
              <CardDescription>Manage payroll periods and calculate payslips</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/payroll`}>
                <Button className="w-full">Open Payroll Panel</Button>
              </Link>
            </CardContent>
          </Card>

          {/* PMS */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5" />
                PMS
              </CardTitle>
              <CardDescription>Track live KPI, goals, attendance, CBT, behaviour, and reviews</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/pms`}>
                <Button className="w-full">Open PMS</Button>
              </Link>
            </CardContent>
          </Card>
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
