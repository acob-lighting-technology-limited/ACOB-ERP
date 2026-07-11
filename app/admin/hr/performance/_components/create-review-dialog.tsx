"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { FormFieldGroup } from "@/components/ui/patterns"
import { QUERY_KEYS } from "@/lib/query-keys"
import type { QueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api-client"

interface User {
  id: string
  first_name: string
  last_name: string
  department_id: string
  department?: string | null
}

interface ReviewCycle {
  id: string
  name: string
  review_type: string
}

interface PerformanceCreateData {
  users: User[]
  cycles: ReviewCycle[]
}

interface BehaviourCompetencies {
  collaboration: number
  accountability: number
  communication: number
  teamwork: number
  loyalty: number
  professional_conduct: number
}

type ExistingReview = {
  kpi_score?: number | null
  cbt_score?: number | null
  attendance_score?: number | null
  behaviour_score?: number | null
  behaviour_competencies?: Record<string, unknown> | null
  strengths?: string | null
  areas_for_improvement?: string | null
  manager_comments?: string | null
}

type ScoreResponse = {
  data?: {
    kpi_score?: number | null
    cbt_score?: number | null
    attendance_score?: number | null
    behaviour_score?: number | null
    existing_review?: ExistingReview | null
  }
  error?: string
}

interface CreateReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queryClient?: QueryClient
  mode?: "individual" | "department"
  onSaved?: () => void
  initialUserId?: string
  initialCycleId?: string
  initialDepartment?: string
  initialStatus?: "draft" | "submitted" | "completed"
}

/**
 * Fetch the employee list and review cycles for the dialog.
 * Uses server-side scoped API routes — leads only see their dept's employees.
 */
async function fetchPerformanceCreateData(): Promise<PerformanceCreateData> {
  const [employeesRes, cyclesRes] = await Promise.all([
    apiFetch("/api/hr/performance/employees", { cache: "no-store" }),
    apiFetch("/api/hr/performance/cycles", { cache: "no-store" }),
  ])

  if (!employeesRes.ok) throw new Error("Failed to load employees")

  const employeesData = (await employeesRes.json()) as { data?: User[]; error?: string }
  const cyclesData = (await cyclesRes.json()) as { data?: ReviewCycle[]; cycles?: ReviewCycle[] }

  const cycles = Array.isArray(cyclesData.data)
    ? cyclesData.data
    : Array.isArray(cyclesData.cycles)
      ? cyclesData.cycles
      : []

  return { users: employeesData.data || [], cycles }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function buildCompetencies(
  payload: Record<string, unknown> | null | undefined,
  fallback: number
): BehaviourCompetencies {
  const read = (key: keyof BehaviourCompetencies) => {
    const raw = payload?.[key]
    const parsed = typeof raw === "number" ? raw : Number(raw)
    return clampScore(Number.isFinite(parsed) ? parsed : fallback)
  }

  return {
    collaboration: read("collaboration"),
    accountability: read("accountability"),
    communication: read("communication"),
    teamwork: read("teamwork"),
    loyalty: read("loyalty"),
    professional_conduct: read("professional_conduct"),
  }
}

export function CreateReviewDialog({
  open,
  onOpenChange,
  queryClient,
  mode = "individual",
  onSaved,
  initialUserId = "",
  initialCycleId = "",
  initialDepartment = "",
  initialStatus = "draft",
}: CreateReviewDialogProps) {
  const [saving, setSaving] = useState(false)
  const [loadingScore, setLoadingScore] = useState(false)
  const [loadedSelectionKey, setLoadedSelectionKey] = useState("")
  const [formData, setFormData] = useState({
    department: "",
    user_id: "",
    review_cycle_id: "",
    strengths: "",
    areas_for_improvement: "",
    manager_comments: "",
    kpi_score: 0,
    cbt_score: 0,
    attendance_score: 0,
    status: "draft" as "draft" | "submitted" | "completed",
  })
  const [competencies, setCompetencies] = useState<BehaviourCompetencies>({
    collaboration: 0,
    accountability: 0,
    communication: 0,
    teamwork: 0,
    loyalty: 0,
    professional_conduct: 0,
  })

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.performanceCreateData(),
    queryFn: () => fetchPerformanceCreateData(),
    enabled: open,
  })

  const users = useMemo(() => data?.users ?? [], [data?.users])
  const cycles = useMemo(() => data?.cycles ?? [], [data?.cycles])
  const departments = useMemo(
    () =>
      Array.from(new Set(users.map((user) => user.department).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [users]
  )

  const visibleUsers =
    mode === "department" && formData.department
      ? users.filter((user) => user.department === formData.department)
      : users

  const isSelectionComplete = Boolean(formData.user_id && formData.review_cycle_id)
  const selectedKey = isSelectionComplete ? `${formData.user_id}:${formData.review_cycle_id}` : ""
  const isSelectionDataReady = isSelectionComplete && loadedSelectionKey === selectedKey && !loadingScore

  const behaviourAvg = Math.round(
    Object.values(competencies).reduce((sum, value) => sum + value, 0) / Object.keys(competencies).length
  )
  const finalScore = Math.round(
    formData.kpi_score * 0.7 + formData.cbt_score * 0.1 + formData.attendance_score * 0.1 + behaviourAvg * 0.1
  )

  const loadScoresForSelection = useCallback(async (userId: string, cycleId: string) => {
    if (!userId || !cycleId) return
    setLoadingScore(true)
    setLoadedSelectionKey("")
    const requestKey = `${userId}:${cycleId}`
    try {
      const res = await apiFetch(`/api/hr/performance/score?user_id=${userId}&cycle_id=${cycleId}`, {
        cache: "no-store",
      })
      const json = (await res.json()) as ScoreResponse
      if (!res.ok) throw new Error(json.error || "Failed to load performance data")
      const scoreData = json.data
      const existingReview = scoreData?.existing_review

      const fallbackBehaviour = clampScore(Number(scoreData?.behaviour_score ?? existingReview?.behaviour_score ?? 0))

      setFormData((prev) => ({
        ...prev,
        kpi_score: clampScore(Number(scoreData?.kpi_score ?? 0)),
        cbt_score: clampScore(Number(scoreData?.cbt_score ?? 0)),
        attendance_score: clampScore(Number(scoreData?.attendance_score ?? 0)),
        strengths: String(existingReview?.strengths || ""),
        areas_for_improvement: String(existingReview?.areas_for_improvement || ""),
        manager_comments: String(existingReview?.manager_comments || ""),
      }))

      setCompetencies(buildCompetencies(existingReview?.behaviour_competencies, fallbackBehaviour))
    } catch {
      toast.error("Failed to load selected employee data for this quarter")
    } finally {
      setLoadedSelectionKey(requestKey)
      setLoadingScore(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoadedSelectionKey("")
    setFormData({
      department: initialDepartment,
      user_id: initialUserId,
      review_cycle_id: initialCycleId,
      strengths: "",
      areas_for_improvement: "",
      manager_comments: "",
      kpi_score: 0,
      cbt_score: 0,
      attendance_score: 0,
      status: initialStatus,
    })
    setCompetencies({
      collaboration: 0,
      accountability: 0,
      communication: 0,
      teamwork: 0,
      loyalty: 0,
      professional_conduct: 0,
    })
  }, [open, initialDepartment, initialUserId, initialCycleId, initialStatus])

  useEffect(() => {
    if (!open || !formData.user_id || !formData.review_cycle_id) return
    void loadScoresForSelection(formData.user_id, formData.review_cycle_id)
  }, [open, formData.user_id, formData.review_cycle_id, loadScoresForSelection])

  useEffect(() => {
    if (!open || formData.review_cycle_id || cycles.length === 0) return
    if (initialCycleId) return
    setFormData((prev) => ({ ...prev, review_cycle_id: cycles[0]?.id || "" }))
  }, [open, formData.review_cycle_id, cycles, initialCycleId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await apiFetch("/api/hr/performance/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          overall_rating: finalScore,
          behaviour_score: behaviourAvg,
          behaviour_competencies: competencies,
        }),
      })
      const responseData = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(responseData?.error || "Failed to create review")

      toast.success("Performance review saved successfully")
      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.performanceCreateData() })
      onSaved?.()
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save review")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {mode === "department" ? "Create Department Review" : "Create Individual Review"}
          </DialogTitle>
          <DialogDescription>
            {mode === "department"
              ? "Choose department, employee, and quarter before entering scores."
              : "Choose employee and quarter first. Existing data will populate automatically."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading employees and review cycles...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Review Setup</CardTitle>
                <CardDescription>Select employee and review cycle to load existing quarter data.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {mode === "department" ? (
                  <FormFieldGroup label="Department">
                    <Select
                      value={formData.department}
                      onValueChange={(value) => {
                        setLoadedSelectionKey("")
                        setFormData((prev) => ({ ...prev, department: value, user_id: "" }))
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((department) => (
                          <SelectItem key={department} value={department}>
                            {department}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormFieldGroup>
                ) : null}

                <FormFieldGroup label="Employee">
                  <Select
                    value={formData.user_id}
                    onValueChange={(value) => {
                      setLoadedSelectionKey("")
                      setFormData((prev) => ({ ...prev, user_id: value }))
                    }}
                    disabled={mode === "department" && !formData.department}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          mode === "department" && !formData.department ? "Select department first" : "Select employee"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.first_name} {user.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormFieldGroup>

                <FormFieldGroup label="Review Cycle">
                  <Select
                    value={formData.review_cycle_id}
                    onValueChange={(value) => {
                      setLoadedSelectionKey("")
                      setFormData((prev) => ({ ...prev, review_cycle_id: value }))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select review cycle" />
                    </SelectTrigger>
                    <SelectContent>
                      {cycles.map((cycle) => (
                        <SelectItem key={cycle.id} value={cycle.id}>
                          {cycle.name} ({cycle.review_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {cycles.length === 0 ? (
                    <p className="text-muted-foreground text-xs">No review cycle is configured yet.</p>
                  ) : null}
                </FormFieldGroup>
              </CardContent>
            </Card>

            {!isSelectionComplete ? (
              <Card>
                <CardContent className="text-muted-foreground py-6 text-sm">
                  Select employee and quarter to load KPI, CBT, attendance, behaviour competencies, strengths, areas for
                  improvement, and manager comments.
                </CardContent>
              </Card>
            ) : !isSelectionDataReady ? (
              <Card>
                <CardContent className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading selected employee quarter data...
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Review Form
                    {loadingScore ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : null}
                  </CardTitle>
                  <CardDescription>
                    Complete the review details. Existing values are pre-filled when available for this quarter, but
                    manual score entry is still allowed for now.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4 rounded-lg border p-4">
                    <h3 className="font-semibold">Performance Score Components</h3>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <FormFieldGroup label="KPI Score">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={formData.kpi_score}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, kpi_score: clampScore(Number(e.target.value)) }))
                          }
                        />
                      </FormFieldGroup>
                      <FormFieldGroup label="CBT Score">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={formData.cbt_score}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, cbt_score: clampScore(Number(e.target.value)) }))
                          }
                        />
                      </FormFieldGroup>
                      <FormFieldGroup label="Attendance Score">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={formData.attendance_score}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, attendance_score: clampScore(Number(e.target.value)) }))
                          }
                        />
                      </FormFieldGroup>
                      <FormFieldGroup label="Status">
                        <Select
                          value={formData.status}
                          onValueChange={(value: "draft" | "submitted" | "completed") =>
                            setFormData((prev) => ({ ...prev, status: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="submitted">Submitted</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormFieldGroup>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4">
                    <h3 className="font-semibold">Behaviour</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(competencies).map(([key, value]) => (
                        <FormFieldGroup
                          key={key}
                          label={key
                            .replace("_", " ")
                            .split(" ")
                            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                            .join(" ")}
                        >
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={value}
                            onChange={(e) =>
                              setCompetencies((prev) => ({ ...prev, [key]: clampScore(Number(e.target.value)) }))
                            }
                          />
                        </FormFieldGroup>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Strengths">
                      <Textarea
                        value={formData.strengths}
                        onChange={(e) => setFormData((prev) => ({ ...prev, strengths: e.target.value }))}
                        rows={3}
                      />
                    </FormFieldGroup>
                    <FormFieldGroup label="Areas for Improvement">
                      <Textarea
                        value={formData.areas_for_improvement}
                        onChange={(e) => setFormData((prev) => ({ ...prev, areas_for_improvement: e.target.value }))}
                        rows={3}
                      />
                    </FormFieldGroup>
                  </div>

                  <FormFieldGroup label="Manager Comments">
                    <Textarea
                      value={formData.manager_comments}
                      onChange={(e) => setFormData((prev) => ({ ...prev, manager_comments: e.target.value }))}
                      rows={4}
                    />
                  </FormFieldGroup>

                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium">Final Score</p>
                    <p className="text-3xl font-bold">{finalScore}%</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !isSelectionComplete} loading={saving}>
                Save Review
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
