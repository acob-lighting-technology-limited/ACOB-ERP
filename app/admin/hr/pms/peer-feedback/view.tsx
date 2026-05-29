"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, MessageSquare, UserRoundSearch, Users } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { exportPmsRowsToExcel } from "@/lib/pms/export"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type PeerFeedbackRow = {
  id: string
  subject_user_id: string
  reviewer_user_id: string
  review_cycle_id: string
  score: number
  collaboration: number | null
  communication: number | null
  teamwork: number | null
  professionalism: number | null
  comments: string | null
  status: string
  created_at: string
  subject?: Profile | null
  reviewer?: Profile | null
}

type Cycle = {
  id: string
  name: string
}

function formatName(profile: Profile | null | undefined) {
  if (!profile) return "Unknown"
  return `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Unknown"
}

function formatMetric(value: number | null | undefined) {
  return typeof value === "number" ? `${value}%` : "-"
}

function FeedbackCard({ row, onView }: { row: PeerFeedbackRow; onView: (row: PeerFeedbackRow) => void }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{formatName(row.subject)}</p>
          <p className="text-muted-foreground text-xs">{row.subject?.department || "No department"}</p>
        </div>
        <Badge variant={row.score >= 70 ? "default" : "secondary"}>{row.score}%</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Reviewer</p>
          <p>{formatName(row.reviewer)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Status</p>
          <p className="capitalize">{row.status}</p>
        </div>
      </div>
      <p className="text-muted-foreground line-clamp-2 text-sm">{row.comments || "No comments provided."}</p>
      <Button size="sm" variant="outline" onClick={() => onView(row)}>
        View Details
      </Button>
    </div>
  )
}

export function AdminPeerFeedbackPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const [feedback, setFeedback] = useState<PeerFeedbackRow[]>([])
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<PeerFeedbackRow | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [feedbackRes, cyclesRes] = await Promise.all([
        fetch("/api/hr/performance/peer-feedback?subject_user_id=all_admin"),
        fetch("/api/hr/performance/cycles"),
      ])
      const [feedbackData, cyclesData] = await Promise.all([
        feedbackRes.json().catch(() => ({})),
        cyclesRes.json().catch(() => ({})),
      ])
      if (!feedbackRes.ok) {
        throw new Error(feedbackData?.error || "Failed to load feedback")
      }
      setFeedback((feedbackData?.data || []) as PeerFeedbackRow[])
      setCycles((cyclesData?.data || []) as Cycle[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feedback")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const cycleNameMap = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle.name])), [cycles])

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(feedback.map((row) => row.subject?.department).filter(Boolean) as string[]))
        .sort()
        .map((department) => ({ value: department, label: department })),
    [feedback]
  )

  const cycleOptions = useMemo(() => cycles.map((cycle) => ({ value: cycle.id, label: cycle.name })), [cycles])

  const reviewerOptions = useMemo(() => {
    const reviewers = new Map<string, string>()
    for (const row of feedback) {
      const name = formatName(row.reviewer)
      if (row.reviewer_user_id && name !== "Unknown") {
        reviewers.set(row.reviewer_user_id, name)
      }
    }
    return Array.from(reviewers.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [feedback])

  const submittedCount = feedback.filter((row) => row.status === "submitted").length
  const avgScore =
    feedback.length > 0
      ? Math.round((feedback.reduce((sum, row) => sum + row.score, 0) / feedback.length) * 100) / 100
      : null

  const exportRows = feedback.map((row, index) => ({
    "S/N": index + 1,
    Subject: formatName(row.subject),
    Reviewer: formatName(row.reviewer),
    Department: row.subject?.department || "-",
    Cycle: cycleNameMap.get(row.review_cycle_id) || "-",
    Score: row.score,
    Collaboration: row.collaboration ?? "-",
    Communication: row.communication ?? "-",
    Teamwork: row.teamwork ?? "-",
    Professionalism: row.professionalism ?? "-",
    Comments: row.comments || "",
    Status: row.status,
    Date: formatWATDate(row.created_at),
  }))

  const columns: DataTableColumn<PeerFeedbackRow>[] = useMemo(
    () => [
      {
        key: "subject",
        label: "Subject",
        sortable: true,
        accessor: (row) => formatName(row.subject),
        render: (row) => <span className="font-medium">{formatName(row.subject)}</span>,
        resizable: true,
        initialWidth: 190,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.subject?.department || "-",
        hideOnMobile: true,
      },
      {
        key: "reviewer",
        label: "Reviewer",
        sortable: true,
        accessor: (row) => formatName(row.reviewer),
        resizable: true,
        initialWidth: 190,
        hideOnMobile: true,
      },
      {
        key: "cycle",
        label: "Quarter",
        sortable: true,
        accessor: (row) => cycleNameMap.get(row.review_cycle_id) || "-",
        hideOnMobile: true,
      },
      {
        key: "score",
        label: "Score",
        sortable: true,
        accessor: (row) => row.score,
        render: (row) => <Badge variant={row.score >= 70 ? "default" : "secondary"}>{row.score}%</Badge>,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => <Badge variant={row.status === "submitted" ? "default" : "secondary"}>{row.status}</Badge>,
      },
      {
        key: "created_at",
        label: "Date",
        sortable: true,
        accessor: (row) => row.created_at,
        render: (row) => <span className="text-muted-foreground text-sm">{formatWATDate(row.created_at)}</span>,
        hideOnMobile: true,
      },
    ],
    [cycleNameMap]
  )

  const filters: DataTableFilter<PeerFeedbackRow>[] = useMemo(
    () => [
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
        placeholder: "All Departments",
        mode: "custom",
        filterFn: (row, values) => values.length === 0 || values.includes(row.subject?.department || ""),
      },
      {
        key: "cycle",
        label: "Quarter",
        options: cycleOptions,
        placeholder: "All Quarters",
        mode: "custom",
        filterFn: (row, values) => values.length === 0 || values.includes(row.review_cycle_id),
      },
      {
        key: "reviewer",
        label: "Reviewer",
        options: reviewerOptions,
        placeholder: "All Reviewers",
        mode: "custom",
        filterFn: (row, values) => values.length === 0 || values.includes(row.reviewer_user_id),
      },
    ],
    [cycleOptions, departmentOptions, reviewerOptions]
  )

  const rowActions: RowAction<PeerFeedbackRow>[] = useMemo(
    () => [
      {
        label: "View",
        icon: UserRoundSearch,
        onClick: (row) => setSelectedRow(row),
      },
    ],
    []
  )

  return (
    <DataTablePage
      title="Peer Feedback"
      description="Review peer feedback submissions across employees, quarters, and reviewers."
      icon={MessageSquare}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={exportRows.length === 0}
          onClick={() => void exportPmsRowsToExcel(exportRows, `peer-feedback-${toLocalISODate()}`)}
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total"
            value={feedback.length}
            icon={MessageSquare}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Subjects"
            value={new Set(feedback.map((row) => row.subject_user_id)).size}
            icon={Users}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Avg Score"
            value={avgScore !== null ? `${avgScore}%` : "-"}
            icon={UserRoundSearch}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Submitted"
            value={submittedCount}
            icon={MessageSquare}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<PeerFeedbackRow>
        data={feedback}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search subject, reviewer, department, or comments…"
        searchFn={(row, query) => {
          return [
            formatName(row.subject),
            formatName(row.reviewer),
            row.subject?.department || "",
            row.comments || "",
            cycleNameMap.get(row.review_cycle_id) || "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }}
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadData()}
        rowActions={rowActions}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Collaboration</p>
                <p className="mt-1">{formatMetric(row.collaboration)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Communication</p>
                <p className="mt-1">{formatMetric(row.communication)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Teamwork</p>
                <p className="mt-1">{formatMetric(row.teamwork)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Professionalism</p>
                <p className="mt-1">{formatMetric(row.professionalism)}</p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-muted-foreground text-xs">Comments</p>
                <p className="mt-1">{row.comments || "No comments provided."}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(row) => <FeedbackCard row={row} onView={setSelectedRow} />}
        emptyTitle="No peer feedback found"
        emptyDescription="Peer feedback submissions will appear here once employees start reviewing colleagues."
        emptyIcon={MessageSquare}
        skeletonRows={6}
      />

      <Dialog open={Boolean(selectedRow)} onOpenChange={() => setSelectedRow(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Peer Feedback Details</DialogTitle>
            <DialogDescription>
              {selectedRow ? `${formatName(selectedRow.subject)} reviewed by ${formatName(selectedRow.reviewer)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedRow ? (
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Department</p>
                <p className="mt-1">{selectedRow.subject?.department || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Quarter</p>
                <p className="mt-1">{cycleNameMap.get(selectedRow.review_cycle_id) || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Collaboration</p>
                <p className="mt-1">{formatMetric(selectedRow.collaboration)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Communication</p>
                <p className="mt-1">{formatMetric(selectedRow.communication)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Teamwork</p>
                <p className="mt-1">{formatMetric(selectedRow.teamwork)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Professionalism</p>
                <p className="mt-1">{formatMetric(selectedRow.professionalism)}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground text-xs">Comments</p>
                <p className="mt-1 whitespace-pre-wrap">{selectedRow.comments || "No comments provided."}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
