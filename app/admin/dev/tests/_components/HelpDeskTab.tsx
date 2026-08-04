"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Loader2, PlayCircle, Ticket } from "lucide-react"
import { HelpDeskRouteDiagnosticsPanel } from "./HelpDeskRouteDiagnosticsPanel"
import { ResultCard } from "./StepList"
import type { TestResult } from "./shared-types"
import { apiFetch } from "@/lib/api-client"

interface HelpDeskTabProps {
  employees: { value: string; label: string }[]
  departments: string[]
}

export function HelpDeskTab({ employees, departments }: HelpDeskTabProps) {
  const [requesterId, setRequesterId] = useState("")
  const [dept, setDept] = useState("")
  const [requestType, setRequestType] = useState<"support" | "procurement">("support")
  const [supportMode, setSupportMode] = useState<"open_queue" | "lead_review_required">("open_queue")
  const [cleanup, setCleanup] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const run = async () => {
    if (!requesterId || !dept) {
      toast.error("Fill in all fields")
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const res = await apiFetch("/api/dev/flow-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "help_desk",
          requester_id: requesterId,
          service_department: dept,
          request_type: requestType,
          support_mode: supportMode,
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
      <HelpDeskRouteDiagnosticsPanel />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-4 w-4" />
            Help Desk Flow Test
          </CardTitle>
          <CardDescription>
            Tests either the support lifecycle or the procurement approval chain, depending on the selected request
            type.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Requester (ticket submitter)</Label>
              <SearchableSelect
                value={requesterId}
                onValueChange={setRequesterId}
                options={employees}
                placeholder="Select requester"
                searchPlaceholder="Search…"
              />
            </div>
            <div className="space-y-2">
              <Label>Service Department</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Request Type</Label>
              <Select value={requestType} onValueChange={(value: "support" | "procurement") => setRequestType(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select request type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="support">Support</SelectItem>
                  <SelectItem value="procurement">Procurement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {requestType === "support" && (
              <div className="space-y-2">
                <Label>Support Mode</Label>
                <Select
                  value={supportMode}
                  onValueChange={(value: "open_queue" | "lead_review_required") => setSupportMode(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select support mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open_queue">Open Queue</SelectItem>
                    <SelectItem value="lead_review_required">Lead Review Required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-end gap-3 pb-1">
              <Switch checked={cleanup} onCheckedChange={setCleanup} id="hd-cleanup" />
              <Label htmlFor="hd-cleanup" className="cursor-pointer">
                Delete test ticket after run
              </Label>
            </div>
          </div>
          <Button onClick={run} disabled={running || !requesterId || !dept} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {running ? "Running…" : "Run Help Desk Test"}
          </Button>
        </CardContent>
      </Card>
      {result && <ResultCard result={result} />}
    </div>
  )
}
