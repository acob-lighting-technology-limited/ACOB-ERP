"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Loader2, PlayCircle, FlaskConical } from "lucide-react"
import { RouteDiagnosticsPanel } from "./RouteDiagnosticsPanel"
import { ResultCard } from "./StepList"
import type { TestResult } from "./shared-types"
import { apiFetch } from "@/lib/api-client"

interface LeaveTabProps {
  employees: { value: string; label: string }[]
  leaveTypes: { value: string; label: string }[]
}

export function LeaveTab({ employees, leaveTypes }: LeaveTabProps) {
  const [requesterId, setRequesterId] = useState("")
  const [relieverId, setRelieverId] = useState("")
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [cleanup, setCleanup] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const run = async () => {
    if (!requesterId || !relieverId || !leaveTypeId) {
      toast.error("Fill in all fields")
      return
    }
    if (requesterId === relieverId) {
      toast.error("Requester and reliever must be different")
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const res = await apiFetch("/api/dev/leave-flow-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester_id: requesterId,
          reliever_id: relieverId,
          leave_type_id: leaveTypeId,
          cleanup,
        }),
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
      <RouteDiagnosticsPanel />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Leave Flow Test
          </CardTitle>
          <CardDescription>
            Simulates the full leave request → reliever → dept lead → HR approval chain. A test request is created 7
            days from now for 3 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Requester</Label>
              <SearchableSelect
                value={requesterId}
                onValueChange={setRequesterId}
                options={employees}
                placeholder="Select requester"
                searchPlaceholder="Search…"
              />
            </div>
            <div className="space-y-2">
              <Label>Reliever</Label>
              <SearchableSelect
                value={relieverId}
                onValueChange={setRelieverId}
                options={employees.filter((e) => e.value !== requesterId)}
                placeholder="Select reliever"
                searchPlaceholder="Search…"
              />
            </div>
            <div className="space-y-2">
              <Label>Leave Type</Label>
              <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3 pb-1">
              <Switch checked={cleanup} onCheckedChange={setCleanup} id="leave-cleanup" />
              <Label htmlFor="leave-cleanup" className="cursor-pointer">
                Delete test request after run
              </Label>
            </div>
          </div>
          <Button onClick={run} disabled={running || !requesterId || !relieverId || !leaveTypeId} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {running ? "Running…" : "Run Leave Test"}
          </Button>
        </CardContent>
      </Card>

      {result && <ResultCard result={result} />}
    </div>
  )
}
