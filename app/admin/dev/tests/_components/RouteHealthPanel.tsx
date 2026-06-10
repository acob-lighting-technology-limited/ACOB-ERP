"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, CheckCircle, Loader2, AlertTriangle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

type RouteCheck = { group: string; label: string; path: string }

// Read-only GET endpoints only — safe to ping without side effects.
const ROUTES: RouteCheck[] = [
  { group: "ACOBot & Directory", label: "Staff directory", path: "/api/directory" },
  { group: "ACOBot & Directory", label: "ACOBot logs — ERP", path: "/api/admin/dev/acobot?source=erp" },
  { group: "ACOBot & Directory", label: "ACOBot logs — Website", path: "/api/admin/dev/acobot?source=website" },
  { group: "HR / Leave", label: "Leave balances", path: "/api/hr/leave/balances" },
  { group: "HR / Leave", label: "Leave approval queue", path: "/api/hr/leave/queue" },
  { group: "HR / Leave", label: "Leave requests", path: "/api/hr/leave/requests" },
  { group: "HR / Attendance", label: "My attendance days", path: "/api/hr/attendance/my-days" },
  { group: "Help Desk", label: "Tickets", path: "/api/help-desk/tickets" },
  { group: "Help Desk", label: "Categories", path: "/api/help-desk/categories" },
  { group: "Admin", label: "Employees list", path: "/api/admin/employees" },
  { group: "Core", label: "Health", path: "/api/health" },
]

type Outcome = "ok" | "warn" | "fail"
type RouteResult = { status: number | null; ms: number; outcome: Outcome }

function classify(status: number | null): Outcome {
  if (status === null) return "fail"
  if (status >= 200 && status < 300) return "ok"
  if (status >= 500) return "fail"
  return "warn" // 4xx — route is reachable, just auth/validation gated
}

export function RouteHealthPanel() {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, RouteResult>>({})

  const run = async () => {
    setLoading(true)
    setResults({})
    const next: Record<string, RouteResult> = {}
    await Promise.all(
      ROUTES.map(async (route) => {
        const started = performance.now()
        try {
          const res = await fetch(route.path, { method: "GET", credentials: "include", cache: "no-store" })
          next[route.path] = {
            status: res.status,
            ms: Math.round(performance.now() - started),
            outcome: classify(res.status),
          }
        } catch {
          next[route.path] = { status: null, ms: Math.round(performance.now() - started), outcome: "fail" }
        }
      })
    )
    setResults(next)
    setLoading(false)
    const failed = Object.values(next).filter((r) => r.outcome === "fail").length
    if (failed === 0) toast.success("All routes reachable ✓")
    else toast.error(`${failed} route(s) failing`)
  }

  const groups = Array.from(new Set(ROUTES.map((r) => r.group)))
  const failCount = Object.values(results).filter((r) => r.outcome === "fail").length
  const tested = Object.keys(results).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          API Route Health
        </CardTitle>
        <CardDescription>
          Pings core read-only API routes (including the Directory and ACOBot endpoints) and reports reachability and
          response time. A 4xx means the route is reachable but auth/validation gated — only 5xx or network errors count
          as failures.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={run} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {loading ? "Pinging…" : "Check All Routes"}
          </Button>
          {tested > 0 && (
            <span className={cn("text-sm font-medium", failCount === 0 ? "text-green-600" : "text-red-500")}>
              {failCount === 0 ? `✓ All ${tested} route(s) reachable` : `✗ ${failCount} / ${tested} failing`}
            </span>
          )}
        </div>

        {tested > 0 && (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group}>
                <p className="mb-1 text-sm font-semibold">{group}</p>
                <div className="space-y-1">
                  {ROUTES.filter((r) => r.group === group).map((route) => {
                    const result = results[route.path]
                    return (
                      <div
                        key={route.path}
                        className={cn(
                          "flex items-center justify-between rounded-md border px-3 py-2 text-xs",
                          result?.outcome === "ok" &&
                            "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30",
                          result?.outcome === "warn" &&
                            "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
                          result?.outcome === "fail" &&
                            "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {result?.outcome === "ok" && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600" />}
                          {result?.outcome === "warn" && (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          )}
                          {result?.outcome === "fail" && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                          <div className="min-w-0">
                            <span className="font-medium">{route.label}</span>
                            <span className="text-muted-foreground ml-2 font-mono">{route.path}</span>
                          </div>
                        </div>
                        {result && (
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {result.status ?? "ERR"}
                            </Badge>
                            <span className="text-muted-foreground tabular-nums">{result.ms}ms</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
