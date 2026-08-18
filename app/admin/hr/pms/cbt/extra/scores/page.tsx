"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Brain, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"
import { formatWATDateTime } from "@/lib/utils/date"

type BonusQuestionDetail = {
  id: string
  prompt: string
  options: Record<"A" | "B" | "C" | "D", string>
  correct_option: "A" | "B" | "C" | "D"
  explanation?: string | null
  chosen: "A" | "B" | "C" | "D" | null
}

type BonusScoreRow = {
  attempt_id: string
  profile_id: string
  employee: string
  department: string
  company_email: string
  review_cycle_id: string | null
  cycle: string
  submitted_at: string | null
  bonus_score: number | null
  bonus_correct_answers: number
  bonus_total_questions: number
  bonus_questions: BonusQuestionDetail[]
}

function scoreLabel(score: number | null) {
  return typeof score === "number" ? `${score}%` : "-"
}

export default function AdminPmsCbtExtraScoresPage() {
  const [rows, setRows] = useState<BonusScoreRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadScores = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiFetch("/api/admin/hr/performance/cbt/extra/scores", { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as { data?: BonusScoreRow[]; error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to load bonus question scores")
      setRows(payload?.data || [])
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load bonus question scores"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadScores()
  }, [loadScores])

  const cycleOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.cycle)))
        .sort()
        .map((cycle) => ({ value: cycle, label: cycle })),
    [rows]
  )

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.department).filter((d) => d && d !== "-")))
        .sort()
        .map((department) => ({ value: department, label: department })),
    [rows]
  )

  const filters: DataTableFilter<BonusScoreRow>[] = [
    { key: "cycle", label: "Cycle", options: cycleOptions, placeholder: "All Cycles" },
    { key: "department", label: "Department", options: departmentOptions, placeholder: "All Departments" },
  ]

  const columns: DataTableColumn<BonusScoreRow>[] = [
    {
      key: "employee",
      label: "Employee",
      sortable: true,
      accessor: (row) => row.employee,
      render: (row) => <span className="font-medium">{row.employee}</span>,
      resizable: true,
      initialWidth: 200,
    },
    { key: "department", label: "Department", sortable: true, accessor: (row) => row.department, hideOnMobile: true },
    {
      key: "cycle",
      label: "Cycle",
      sortable: true,
      accessor: (row) => row.cycle,
      resizable: true,
      initialWidth: 220,
      hideOnMobile: true,
    },
    {
      key: "bonus_score",
      label: "Bonus Score",
      sortable: true,
      accessor: (row) => row.bonus_score ?? -1,
      render: (row) => <Badge variant="secondary">{scoreLabel(row.bonus_score)}</Badge>,
    },
    {
      key: "bonus_correct_answers",
      label: "Correct",
      sortable: true,
      accessor: (row) => row.bonus_correct_answers,
      render: (row) => (
        <span>
          {row.bonus_correct_answers} / {row.bonus_total_questions}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "submitted_at",
      label: "Submitted",
      sortable: true,
      accessor: (row) => row.submitted_at || "",
      render: (row) => (row.submitted_at ? formatWATDateTime(row.submitted_at) : "-"),
      hideOnMobile: true,
    },
  ]

  return (
    <DataTablePage
      title="CBT Bonus Question Scores"
      description="Only visible here — bonus/joke question results never appear on the candidate's own CBT results or score."
      icon={Brain}
      backLink={{ href: "/admin/hr/pms/cbt/extra", label: "Back to Bonus Questions" }}
      actions={
        <Button variant="outline" size="sm" onClick={() => void loadScores()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            title="Responses"
            value={rows.length}
            icon={Brain}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Correct"
            value={rows.filter((r) => r.bonus_score === 100).length}
            icon={Brain}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Wrong"
            value={rows.filter((r) => r.bonus_score !== null && r.bonus_score < 100).length}
            icon={Brain}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<BonusScoreRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.attempt_id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search employee, department, cycle..."
        searchFn={(row, query) =>
          [row.employee, row.department, row.cycle, row.company_email].join(" ").toLowerCase().includes(query)
        }
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadScores()}
        expandable={{
          render: (row) => (
            <div className="space-y-3">
              {row.bonus_questions.length === 0 ? (
                <p className="text-muted-foreground text-xs italic">No bonus question details found.</p>
              ) : (
                row.bonus_questions.map((question) => {
                  const isCorrect = question.chosen === question.correct_option
                  return (
                    <div key={question.id} className="bg-card space-y-2 rounded-xl border p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{question.prompt}</p>
                        {question.chosen ? (
                          <Badge
                            variant="outline"
                            className={
                              isCorrect
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
                                : "border-red-500/20 bg-red-500/10 text-red-500"
                            }
                          >
                            {isCorrect ? "Correct" : "Incorrect"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-500">
                            Unanswered
                          </Badge>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(["A", "B", "C", "D"] as const).map((letter) => (
                          <div
                            key={letter}
                            className={`rounded-lg border p-2 text-xs ${
                              question.chosen === letter
                                ? isCorrect
                                  ? "border-emerald-500/30 bg-emerald-500/10"
                                  : "border-red-500/30 bg-red-500/10"
                                : question.correct_option === letter
                                  ? "border-dashed border-emerald-500/20"
                                  : "border-border"
                            }`}
                          >
                            <span className="font-bold">{letter}.</span> {question.options[letter]}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ),
        }}
        emptyTitle="No bonus question responses yet"
        emptyDescription="Scores will appear here once a targeted candidate answers a bonus question."
        emptyIcon={Brain}
        skeletonRows={6}
      />
    </DataTablePage>
  )
}
