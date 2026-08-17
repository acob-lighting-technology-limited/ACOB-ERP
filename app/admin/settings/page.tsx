import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Settings, Users, Building2, Shield, Mail, Clock, Brain } from "lucide-react"
import Link from "next/link"
import { PageHeader, PageWrapper } from "@/components/layout"
import { IconFill } from "@/components/ui/icon-fill"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { canManageMaintenanceMode } from "@/lib/maintenance"

export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    redirect("/profile")
  }

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Settings"
        description={
          scope.isAdminLike
            ? "Manage users, roles, and company settings"
            : "Manage department-scoped settings and access controls"
        }
        icon={Settings}
        backLink={{ href: "/admin", label: "Back to Admin" }}
      />

      {/* Settings Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <IconFill
                icon={Users}
                fillColor="bg-blue-500"
                className="h-8 w-8 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:text-blue-400"
                iconClassName="h-4 w-4"
              />
              <span className="transition-colors group-hover:text-blue-500">User Management</span>
            </CardTitle>
            <CardDescription>Manage user accounts and permissions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/admin/settings/users" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
              Manage Users
            </Link>
            <Link
              href="/admin/settings/users?invite=1"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Invite User
            </Link>
          </CardContent>
        </Card>

        <Card className="group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <IconFill
                icon={Shield}
                fillColor="bg-purple-500"
                className="h-8 w-8 rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-600 transition-transform duration-200 group-hover:scale-105 dark:text-purple-400"
                iconClassName="h-4 w-4"
              />
              <span className="transition-colors group-hover:text-purple-500">Roles & Permissions</span>
            </CardTitle>
            <CardDescription>Configure user roles and access levels</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/admin/settings/roles" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
              Manage Roles
            </Link>
          </CardContent>
        </Card>

        <Card className="group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <IconFill
                icon={Building2}
                fillColor="bg-teal-500"
                className="h-8 w-8 rounded-lg border border-teal-500/20 bg-teal-500/10 text-teal-600 transition-transform duration-200 group-hover:scale-105 dark:text-teal-400"
                iconClassName="h-4 w-4"
              />
              <span className="transition-colors group-hover:text-teal-500">Company Settings</span>
            </CardTitle>
            <CardDescription>
              {scope.isAdminLike ? "Configure company information" : "View company information (read-only for leads)"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/admin/settings/company" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
              Company Profile
            </Link>
          </CardContent>
        </Card>

        {canManageMaintenanceMode(scope.role) && (
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Settings}
                  fillColor="bg-amber-500"
                  className="h-8 w-8 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 transition-transform duration-200 group-hover:scale-105 dark:text-amber-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-amber-500">Maintenance Control</span>
              </CardTitle>
              <CardDescription>Toggle maintenance mode and review its current state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/admin/settings/maintenance" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
                Open Maintenance
              </Link>
            </CardContent>
          </Card>
        )}

        {(scope.role === "super_admin" || scope.role === "developer") && (
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Mail}
                  fillColor="bg-indigo-500"
                  className="h-8 w-8 rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 transition-transform duration-200 group-hover:scale-105 dark:text-indigo-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-indigo-500">Mail Settings</span>
              </CardTitle>
              <CardDescription>Control system-wide in-app/email notification delivery by module.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/admin/settings/mail" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
                Open Mail Settings
              </Link>
            </CardContent>
          </Card>
        )}

        {(scope.role === "super_admin" || scope.role === "developer") && (
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Brain}
                  fillColor="bg-violet-500"
                  className="h-8 w-8 rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-600 transition-transform duration-200 group-hover:scale-105 dark:text-violet-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-violet-500">CBT Assessment Settings</span>
              </CardTitle>
              <CardDescription>Configure questions per test and duration per question (exam timer).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/admin/settings/cbt" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
                Configure CBT Settings
              </Link>
            </CardContent>
          </Card>
        )}

        {scope.isAdminLike && (
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Clock}
                  fillColor="bg-emerald-500"
                  className="h-8 w-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 transition-transform duration-200 group-hover:scale-105 dark:text-emerald-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-emerald-500">Attendance Policy</span>
              </CardTitle>
              <CardDescription>Configure working hours, grace cutoff, and incomplete penalty.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/admin/settings/attendance" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
                Configure Attendance
              </Link>
            </CardContent>
          </Card>
        )}

        {scope.role === "developer" && (
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={Settings}
                  fillColor="bg-orange-500"
                  className="h-8 w-8 rounded-lg border border-orange-500/20 bg-orange-500/10 text-orange-600 transition-transform duration-200 group-hover:scale-105 dark:text-orange-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-orange-500">Developer Control Plane</span>
              </CardTitle>
              <CardDescription>Developer-only diagnostics, security, and test tooling.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/admin/dev" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
                Open DEV
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </PageWrapper>
  )
}
