"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle, XCircle, Loader2, PlayCircle, FlaskConical, SkipForward, Route } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { logger } from "@/lib/logger"

const log = logger("leave-flow-test")

type StepResult = {
  step: string
  status: "ok" | "error" | "skipped"
  detail?: string
  data?: unknown
}

type TestResult = {
  ok: boolean
  steps: StepResult[]
  leave_request_id?: string | null
  error?: string
}

type DiagRow = {
  requester_kind: string
  stage_order: number
  approver_role_code: string
  resolved: boolean
  resolved_user_id?: string | null
  resolved_name?: string | null
  fail_reason?: string
}

type DiagnosticsResult = {
  results: DiagRow[]
  broken_count: number
  total: number
}

const FIX_HINTS: Record<string, string> = {
  md: 'Set someone\'s profile: is_department_lead = true AND department = "Executive Management" (or add "Executive Management" to their lead_departments array)',
  hcs: 'Set someone\'s profile: is_department_lead = true AND department = "Corporate Services" (or add it to lead_departments)',
  admin_hr_lead:
    'Set someone\'s profile: is_department_lead = true AND department = "Admin & HR" (or add it to lead_departments)',
  department_lead:
    "Dynamic — the requester's department needs someone with is_department_lead = true, or a department_head_id set in the departments table",
  reliever: "Dynamic per request — no fix needed",
}

export function LeaveFlowTestContent() {
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([])
  const [leaveTypes, setLeaveTypes] = useState<{ value: string; label: string }[]>([])
  const [requesterId, setRequesterId] = useState("")
  const [relieverId, setRelieverId] = useState("")
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [cleanup, setCleanup] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false)
  const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosticsResult | null>(null)

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/hr/leave/test/form-data", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load form data")
      const json = await res.json()
      setEmployees(json.employees || [])
      setLeaveTypes(json.leaveTypes || [])
    }

    load().catch((err) => log.error({ err: String(err) }, "load failed"))
  }, [])

  async function runTest() {
    if (!requesterId || !relieverId || !leaveTypeId) {
      toast.error("Please fill in all three fields")
      return
    }
    if (requesterId === relieverId) {
      toast.error("Requester and reliever must be different people")
      return
    }

    setRunning(true)
    setResult(null)

    try {
      const res = await fetch("/api/dev/leave-flow-test", {
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
        toast.error("One or more stages failed — check results below")
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Network error")
    } finally {
      setRunning(false)
    }
  }

  async function runDiagnostics() {
    setDiagnosticsRunning(true)
    setDiagnosticsResult(null)

    try {
      const res = await fetch("/api/dev/leave-route-diagnostics")

      const payload: DiagnosticsResult = await res.json()
      setDiagnosticsResult(payload)

      if (payload.broken_count === 0) {
        toast.success("All routes are fully configured ✓")
      } else {
        toast.error(`${payload.broken_count} broken stage(s) found — see details below`)
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Network error")
    } finally {
      setDiagnosticsRunning(false)
    }
  }

  const passCount = result?.steps.filter((s) => s.status === "ok").length ?? 0
  const failCount = result?.steps.filter((s) => s.status === "error").length ?? 0

  const brokenRoutesCount = diagnosticsResult?.broken_count ?? 0
  const diagByKind = diagnosticsResult
    ? (diagnosticsResult.results || []).reduce<Record<string, DiagRow[]>>((acc, row) => {
        acc[row.requester_kind] = acc[row.requester_kind] || []
        acc[row.requester_kind].push(row)
        return acc
      }, {})
    : {}

  return (
    <div className="space-y-6">
      {/* Config card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Leave Flow Test
          </CardTitle>
          <CardDescription>
            Simulates a full leave request → reliever → dept lead → HR approval using service-role — no need to log into
            multiple accounts. A test leave request is created 7 days from now for 3 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Requester (employee requesting leave)</Label>
              <SearchableSelect
                value={requesterId}
                onValueChange={setRequesterId}
                options={employees}
                placeholder="Select requester"
                searchPlaceholder="Search employee..."
              />
            </div>

            <div className="space-y-2">
              <Label>Reliever (employee covering)</Label>
              <SearchableSelect
                value={relieverId}
                onValueChange={setRelieverId}
                options={employees.filter((e) => e.value !== requesterId)}
                placeholder="Select reliever"
                searchPlaceholder="Search employee..."
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
              <Switch checked={cleanup} onCheckedChange={setCleanup} id="cleanup-toggle" />
              <Label htmlFor="cleanup-toggle" className="cursor-pointer">
                Delete test request after run
              </Label>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <Button
              onClick={runTest}
              disabled={running || !requesterId || !relieverId || !leaveTypeId}
              className="gap-2"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {running ? "Running…" : "Run Full Flow Test"}
            </Button>

            {result && (
              <div className="flex gap-3 text-sm">
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle className="h-4 w-4" /> {passCount} passed
                </span>
                <span className="flex items-center gap-1 text-red-500">
                  <XCircle className="h-4 w-4" /> {failCount} failed
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.ok ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              {result.ok ? "All Stages Passed" : "Flow Failed"}
            </CardTitle>
            {result.leave_request_id && (
              <CardDescription>
                Test request preserved (cleanup=off): <code className="text-xs">{result.leave_request_id}</code>
              </CardDescription>
            )}
            {result.error && <p className="text-destructive text-sm">{result.error}</p>}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.steps.map((step, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-3 rounded-md border px-3 py-2 text-sm",
                    step.status === "ok" && "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30",
                    step.status === "error" && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
                    step.status === "skipped" && "bg-muted/40 border-dashed"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {step.status === "ok" && <CheckCircle className="h-4 w-4 text-green-600" />}
                    {step.status === "error" && <XCircle className="h-4 w-4 text-red-500" />}
                    {step.status === "skipped" && <SkipForward className="text-muted-foreground h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-medium">{step.step}</code>
                      <Badge
                        variant={
                          step.status === "ok" ? "default" : step.status === "error" ? "destructive" : "secondary"
                        }
                        className="text-xs"
                      >
                        {step.status}
                      </Badge>
                    </div>
                    {step.detail && <p className="text-muted-foreground mt-0.5 text-xs">{step.detail}</p>}
                    {step.data !== undefined && (
                      <pre className="bg-muted mt-1 max-h-32 overflow-auto rounded p-2 text-xs">
                        {JSON.stringify(step.data as Record<string, unknown>, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Route Diagnostics card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="h-5 w-5" />
            Route Diagnostics
          </CardTitle>
          <CardDescription>
            Checks every approval stage in your DB and reports which roles are missing an assigned approver. Run this
            first to understand what needs configuring before running the flow test.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button onClick={runDiagnostics} disabled={diagnosticsRunning} className="gap-2">
              {diagnosticsRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
              {diagnosticsRunning ? "Checking…" : "Check All Routes"}
            </Button>

            {diagnosticsResult && (
              <span className={cn("text-sm font-medium", brokenRoutesCount === 0 ? "text-green-600" : "text-red-500")}>
                {brokenRoutesCount === 0
                  ? `✓ All ${diagnosticsResult.total} stage(s) configured`
                  : `✗ ${brokenRoutesCount} of ${diagnosticsResult.total} stage(s) broken`}
              </span>
            )}
          </div>

          {diagnosticsResult && Object.keys(diagByKind).length > 0 && (
            <div className="space-y-4">
              {Object.entries(diagByKind).map(([kind, rows]) => {
                const broken = rows.filter((r) => !r.resolved)
                return (
                  <div key={kind}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-sm font-semibold capitalize">{kind.replace(/_/g, " ")}</span>
                      {broken.length > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          {broken.length} broken
                        </Badge>
                      ) : (
                        <Badge variant="default" className="text-xs">
                          OK
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      {rows.map((row, i) => (
                        <div
                          key={i}
                          className={cn(
                            "rounded-md border px-3 py-2 text-xs",
                            row.resolved
                              ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
                              : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            {row.resolved ? (
                              <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                            ) : (
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="font-mono font-medium">
                                Stage {row.stage_order}: {row.approver_role_code}
                              </span>
                              {row.resolved ? (
                                <span className="text-muted-foreground ml-2">
                                  → {row.resolved_name || row.resolved_user_id}
                                </span>
                              ) : (
                                <div className="mt-1 space-y-1">
                                  <p className="text-red-600 dark:text-red-400">{row.fail_reason}</p>
                                  {FIX_HINTS[row.approver_role_code] && (
                                    <p className="text-amber-700 dark:text-amber-400">
                                      <strong>Fix:</strong> {FIX_HINTS[row.approver_role_code]}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
