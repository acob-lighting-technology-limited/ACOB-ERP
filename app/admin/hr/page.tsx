"use client"

import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Award, Calendar, Clock, Users, CheckCircle, AlertCircle, FileText, Building, MapPin } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { QUERY_KEYS } from "@/lib/query-keys"
import type { Database } from "@/types/database"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"
import { useAdminScope } from "@/components/admin-scope-context"
import type { ClientAdminScope } from "@/components/admin-scope-context"

interface DashboardStats {
  pendingLeaveRequests: number
  todayAttendance: number
  upcomingReviews: number
  totalEmployees: number
  totalDepartments: number
  totalOfficeLocations: number
}

type ProfileIdRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id">
type AttendanceRow = {
  id: string
  user_id: string
}
type ReviewRow = {
  id: string
  user_id: string
}
type LocationRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "office_location" | "department">

function expandScopedDepartments(departments: string[]): string[] {
  return Array.from(
    new Set(departments.flatMap((departmentName) => getDepartmentAliases(departmentName)).filter(Boolean))
  )
}

async function fetchHrDashboardStats(scope: ClientAdminScope): Promise<DashboardStats> {
  const supabase = createClient()

  // Derive scoped departments from the already-resolved AdminScope from context —
  // no extra round-trip to /api/admin/scope-mode needed.
  const isAdminLike = scope.isAdminLike
  const isLeadMode = scope.scopeMode === "lead"
  let scopedDepartments: string[] = []

  if (!isAdminLike || isLeadMode) {
    // Lead or admin in lead mode: scope to managed departments
    scopedDepartments = scope.managedDepartments.filter(Boolean)
  }
  // isAdminLike in global mode: scopedDepartments stays [] → no filter

  const queryScopedDepartments = expandScopedDepartments(scopedDepartments)
  const scopedDepartmentTokens = new Set(
    scopedDepartments.map((departmentName) => normalizeDepartmentName(departmentName))
  )
  const scopedUserIds = queryScopedDepartments.length
    ? (await supabase.from("profiles").select("id").in("department", queryScopedDepartments)).data?.map(
        (row: ProfileIdRow) => row.id
      ) || []
    : []

  let pendingLeaveCount = 0
  try {
    const queueRes = await fetch("/api/hr/leave/queue")
    const queuePayload = await queueRes.json()
    if (queueRes.ok) {
      pendingLeaveCount = Array.isArray(queuePayload.data) ? queuePayload.data.length : 0
    }
  } catch {
    pendingLeaveCount = 0
  }

  const today = new Date().toISOString().split("T")[0]
  const { data: attendance } = await supabase
    .from("attendance_records")
    .select("id, user_id")
    .eq("date", today)
    .returns<AttendanceRow[]>()
  const attendanceRows =
    scopedUserIds.length > 0 ? attendance?.filter((row) => scopedUserIds.includes(row.user_id)) : attendance

  const { data: reviews } = await supabase
    .from("performance_reviews")
    .select("id, user_id")
    .eq("status", "draft")
    .returns<ReviewRow[]>()
  const reviewRows = scopedUserIds.length > 0 ? reviews?.filter((row) => scopedUserIds.includes(row.user_id)) : reviews

  let employeeCountQuery = supabase.from("profiles").select("*", { count: "exact", head: true })
  if (queryScopedDepartments.length > 0) {
    employeeCountQuery = employeeCountQuery.in("department", queryScopedDepartments)
  }
  const { count: employeeCount } = await employeeCountQuery
  let departmentCountQuery = supabase.from("departments").select("*", { count: "exact", head: true })
  if (queryScopedDepartments.length > 0) {
    departmentCountQuery = departmentCountQuery.in("name", queryScopedDepartments)
  }
  const { count: departmentCount } = await departmentCountQuery
  const { data: locations } = await supabase.from("profiles").select("office_location, department, employment_status")
  const locationRows =
    scopedDepartmentTokens.size > 0
      ? (locations || []).filter(
          (row: LocationRow & { employment_status?: string | null }) =>
            isAssignableEmploymentStatus(row.employment_status, { allowLegacyNullStatus: false }) &&
            scopedDepartmentTokens.has(normalizeDepartmentName(String(row.department || "")))
        )
      : (locations || []).filter((row: LocationRow & { employment_status?: string | null }) =>
          isAssignableEmploymentStatus(row.employment_status, { allowLegacyNullStatus: false })
        )

  return {
    pendingLeaveRequests: pendingLeaveCount,
    todayAttendance: attendanceRows?.length || 0,
    upcomingReviews: reviewRows?.length || 0,
    totalEmployees: employeeCount || 0,
    totalDepartments: departmentCount || 0,
    totalOfficeLocations: new Set(
      locationRows.map((location) => (location.office_location || "").trim()).filter(Boolean)
    ).size,
  }
}

export default function HRAdminDashboard() {
  const scope = useAdminScope()
  const canAccessHrResources = scope.isAdminLike && scope.scopeMode !== "lead"

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
    queryFn: () => fetchHrDashboardStats(scope),
  })

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="HR Administration"
        description="Manage leave approvals, attendance reports, and PMS visibility"
        icon={Users}
        backLink={{ href: "/admin", label: "Back to Admin" }}
      />

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
              <Link href="/admin/hr/employees">
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
              <Link href="/admin/hr/departments">
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
              <Link href="/admin/hr/office-location">
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
              <Link href="/admin/hr/leave/approve">
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
                <Link href="/admin/hr/resources">
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
              <Link href="/admin/hr/attendance">
                <Button className="w-full">View Reports</Button>
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
              <Link href="/admin/hr/pms">
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
                  <Link href="/admin/hr/leave/approve">
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
                  <Link href="/admin/hr/pms/reviews">
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
