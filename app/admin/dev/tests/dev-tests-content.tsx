"use client"

import { useEffect, useState, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FlaskConical, Route, Ticket, ClipboardList, Package, Activity } from "lucide-react"
import { PageHeader, PageWrapper } from "@/components/layout"
import { logger } from "@/lib/logger"
import { LeaveTab } from "./_components/LeaveTab"
import { HelpDeskTab } from "./_components/HelpDeskTab"
import { TaskTab } from "./_components/TaskTab"
import { AssetMailRoutingPanel } from "./_components/AssetMailRoutingPanel"
import { RouteHealthPanel } from "./_components/RouteHealthPanel"

const log = logger("dev-tests")

// ── Root Content Component ────────────────────────────────────────────────────
export function DevTestsContent() {
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([])
  const [leaveTypes, setLeaveTypes] = useState<{ value: string; label: string }[]>([])
  const [departments, setDepartments] = useState<string[]>([])

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/dev/tests/form-data", { cache: "no-store" })
    if (!res.ok) throw new Error("Failed to load form data")
    const json = await res.json()
    setEmployees(json.employees || [])
    setLeaveTypes(json.leaveTypes || [])
    setDepartments(json.departments || [])
  }, [])

  useEffect(() => {
    load().catch((err) => log.error({ err: String(err) }, "load failed"))
  }, [load])

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Developer Tests"
        description="End-to-end flow tests for leave, help desk, task management, asset routing, and API route health"
        icon={FlaskConical}
        backLink={{ href: "/admin/dev", label: "Back to DEV" }}
      />

      <Tabs defaultValue="leave" className="space-y-4">
        <TabsList>
          <TabsTrigger value="leave" className="gap-2">
            <Route className="h-4 w-4" />
            Leave
          </TabsTrigger>
          <TabsTrigger value="helpdesk" className="gap-2">
            <Ticket className="h-4 w-4" />
            Help Desk
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="assets" className="gap-2">
            <Package className="h-4 w-4" />
            Assets
          </TabsTrigger>
          <TabsTrigger value="routes" className="gap-2">
            <Activity className="h-4 w-4" />
            Routes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leave">
          <LeaveTab employees={employees} leaveTypes={leaveTypes} />
        </TabsContent>

        <TabsContent value="helpdesk">
          <HelpDeskTab employees={employees} departments={departments} />
        </TabsContent>

        <TabsContent value="tasks">
          <TaskTab employees={employees} />
        </TabsContent>

        <TabsContent value="assets">
          <div className="space-y-4">
            <AssetMailRoutingPanel />
          </div>
        </TabsContent>

        <TabsContent value="routes">
          <div className="space-y-4">
            <RouteHealthPanel />
          </div>
        </TabsContent>
      </Tabs>
    </PageWrapper>
  )
}
