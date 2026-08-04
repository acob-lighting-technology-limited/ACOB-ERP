"use client"

import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatName } from "@/lib/utils"
import { Edit } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { PageLoader } from "@/components/ui/query-states"
import { EmployeeProfileCard } from "@/components/employees/EmployeeProfileCard"
import { EmployeeDetailTabs } from "@/components/employees/EmployeeDetailTabs"
import type { EmployeeDetailData } from "@/components/employees/employee-detail-types"

import { logger } from "@/lib/logger"

const log = logger("hr-employees-[userId]")

async function fetchEmployeeDetail(userId: string): Promise<EmployeeDetailData> {
  const res = await fetch(`/api/admin/hr/employees/${userId}`, { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Employee not found")
  const json = await res.json()
  return json.data as EmployeeDetailData
}

export default function UserDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params?.userId as string

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminEmployeeDetail(userId),
    queryFn: () => fetchEmployeeDetail(userId),
    enabled: !!userId,
  })

  const profile = data?.profile ?? null
  const tasks = data?.tasks ?? []
  const devices = data?.devices ?? []
  const assets = data?.assets ?? []
  const documentation = data?.documentation ?? []
  const auditLogs = data?.auditLogs ?? []
  const feedback = data?.feedback ?? []

  if (isLoading) {
    return <PageLoader />
  }

  if (!profile) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">Employee not found</p>
            <Button onClick={() => router.push("/admin/hr/employees")} className="mt-4">
              Back to Employees
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const fullName = `${formatName(profile.first_name)} ${formatName(profile.last_name)}`
  const initials = `${profile.first_name?.[0] || ""}${profile.last_name?.[0] || ""}`.toUpperCase()

  log.debug("Rendering employee detail", { userId, fullName })

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader
        title={fullName}
        description={profile.company_email}
        backLink={{ href: "/admin/hr/employees", label: "Back to Employees" }}
        actions={
          <Button onClick={() => router.push(`/admin/hr/employees?userId=${userId}`)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Profile
          </Button>
        }
      />

      <EmployeeProfileCard profile={profile} fullName={fullName} initials={initials} />

      <EmployeeDetailTabs
        tasks={tasks}
        devices={devices}
        assets={assets}
        documentation={documentation}
        auditLogs={auditLogs}
        feedback={feedback}
        taskLinkBase="/admin/tasks"
        deviceLinkBase="/admin/devices"
        assetLinkBase="/admin/assets"
        docLinkBase="/admin/documentation/internal"
        feedbackLinkBase="/admin/feedback"
        auditLinkBase="/admin/audit-logs"
      />
    </div>
  )
}
