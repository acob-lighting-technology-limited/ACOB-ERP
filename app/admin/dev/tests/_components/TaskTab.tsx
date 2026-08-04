"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Loader2, PlayCircle, ClipboardList } from "lucide-react"
import { TaskRouteDiagnosticsPanel } from "./TaskRouteDiagnosticsPanel"
import { ResultCard } from "./StepList"
import type { TestResult } from "./shared-types"
import { apiFetch } from "@/lib/api-client"

interface TaskTabProps {
  employees: { value: string; label: string }[]
}

export function TaskTab({ employees }: TaskTabProps) {
  const [assignerId, setAssignerId] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [cleanup, setCleanup] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const run = async () => {
    if (!assignerId || !assigneeId) {
      toast.error("Fill in all fields")
      return
    }
    if (assignerId === assigneeId) {
      toast.error("Assigner and assignee must be different")
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const res = await apiFetch("/api/dev/flow-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "task", assigner_id: assignerId, assignee_id: assigneeId, cleanup }),
      })
      const payload: TestResult = await res.json()
      setResult(payload)
      if (payload.ok) {
        toast.success("All stages passed ✓")
      } else {
        toast.error("One or more stages failed")
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <TaskRouteDiagnosticsPanel />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Task Flow Test
          </CardTitle>
          <CardDescription>
            Creates an individual task, moves it from pending → in_progress → completed, then verifies the final status.
            Tests the core task lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Assigner (admin creating the task)</Label>
              <SearchableSelect
                value={assignerId}
                onValueChange={setAssignerId}
                options={employees}
                placeholder="Select assigner"
                searchPlaceholder="Search…"
              />
            </div>
            <div className="space-y-2">
              <Label>Assignee (employee receiving the task)</Label>
              <SearchableSelect
                value={assigneeId}
                onValueChange={setAssigneeId}
                options={employees.filter((e) => e.value !== assignerId)}
                placeholder="Select assignee"
                searchPlaceholder="Search…"
              />
            </div>
            <div className="flex items-end gap-3 pb-1">
              <Switch checked={cleanup} onCheckedChange={setCleanup} id="task-cleanup" />
              <Label htmlFor="task-cleanup" className="cursor-pointer">
                Delete test task after run
              </Label>
            </div>
          </div>
          <Button onClick={run} disabled={running || !assignerId || !assigneeId} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {running ? "Running…" : "Run Task Test"}
          </Button>
        </CardContent>
      </Card>
      {result && <ResultCard result={result} />}
    </div>
  )
}
