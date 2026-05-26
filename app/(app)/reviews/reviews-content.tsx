"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { FileText, Star, TrendingUp, CheckCircle, ClipboardList } from "lucide-react"
import type { Review } from "./page"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"

interface ReviewsContentProps {
  initialReviews: Review[]
  currentUserId: string
}

export function ReviewsContent({ initialReviews, currentUserId }: ReviewsContentProps) {
  const [reviews, setReviews] = useState<Review[]>(initialReviews)
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [detailsReview, setDetailsReview] = useState<Review | null>(null)
  const [employeeComments, setEmployeeComments] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  function normalizeMetric(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null
    const normalized = typeof value === "number" ? value : Number(value)
    return Number.isFinite(normalized) ? normalized : null
  }

  function formatMetric(value: number | string | null | undefined): string {
    const normalized = normalizeMetric(value)
    return normalized === null ? "-" : `${normalized.toFixed(2).replace(/\.00$/, "")}`
  }

  function getQuarterLabel(review: Review) {
    if (review.review_cycle?.name) return review.review_cycle.name
    const date = new Date(review.created_at)
    const quarter = Math.floor(date.getMonth() / 3) + 1
    return `Q${quarter} ${date.getFullYear()}`
  }

  const visibleReviews = useMemo(
    () =>
      reviews.filter((review) => {
        // Filter out CBT only draft entries where current user is the reviewer
        const isCbtOnlyDraft =
          review.status === "draft" &&
          review.reviewer_id === currentUserId &&
          review.cbt_score != null &&
          review.kpi_score == null &&
          review.attendance_score == null &&
          review.behaviour_score == null &&
          !review.manager_comments &&
          !review.strengths &&
          !review.areas_for_improvement
        return !isCbtOnlyDraft
      }),
    [reviews, currentUserId]
  )

  const stats = useMemo(() => {
    const completions = visibleReviews.filter((r) => r.status === "completed").length
    const scores = visibleReviews.map((r) => normalizeMetric(r.final_score)).filter((s): s is number => s !== null)
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

    return {
      total: visibleReviews.length,
      completed: completions,
      avgScore: avgScore.toFixed(1) + "%",
    }
  }, [visibleReviews])

  const columns: DataTableColumn<Review>[] = [
    {
      key: "quarter",
      label: "Cycle",
      sortable: true,
      accessor: (r) => getQuarterLabel(r),
      render: (r) => <span className="font-semibold">{getQuarterLabel(r)}</span>,
    },
    {
      key: "reviewer",
      label: "Reviewer",
      accessor: (r) =>
        r.reviewer_id === currentUserId
          ? "You (Self)"
          : `${r.reviewer?.first_name || ""} ${r.reviewer?.last_name || ""}`.trim(),
      hideOnMobile: true,
    },
    {
      key: "kpi",
      label: "KPI",
      accessor: (r) => normalizeMetric(r.kpi_score) ?? 0,
      render: (r) => <span>{formatMetric(r.kpi_score)}</span>,
      hideOnMobile: true,
    },
    {
      key: "cbt",
      label: "CBT",
      accessor: (r) => normalizeMetric(r.cbt_score) ?? 0,
      render: (r) => <span>{formatMetric(r.cbt_score)}</span>,
      hideOnMobile: true,
    },
    {
      key: "final",
      label: "Final Score",
      sortable: true,
      accessor: (r) => normalizeMetric(r.final_score) ?? 0,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="text-primary font-bold">{formatMetric(r.final_score)}%</span>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      accessor: (r) => r.status,
      render: (r) => (
        <Badge variant={r.status === "completed" ? "default" : "secondary"} className="capitalize">
          {formatName(r.status || "draft")}
        </Badge>
      ),
    },
  ]

  const filters: DataTableFilter<Review>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "submitted", label: "Submitted" },
        { value: "completed", label: "Completed" },
      ],
    },
    {
      key: "quarter",
      label: "Cycle",
      mode: "custom",
      options: Array.from(new Set(visibleReviews.map(getQuarterLabel))).map((q) => ({ value: q, label: q })),
      filterFn: (row, selected) => selected.includes(getQuarterLabel(row)),
    },
  ]

  async function acknowledgeReview() {
    if (!selectedReview) return
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/hr/performance/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedReview.id,
          acknowledge: true,
          employee_comments: employeeComments || null,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Failed to acknowledge")

      setReviews((prev) =>
        prev.map((r) =>
          r.id === selectedReview.id ? { ...r, ...payload.data, acknowledged_at: new Date().toISOString() } : r
        )
      )
      toast.success("Review acknowledged")
      setSelectedReview(null)
      setEmployeeComments("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderReviewDetails = (r: Review) => (
    <div className="bg-muted/30 grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
      <div className="space-y-4">
        <h4 className="text-muted-foreground text-sm font-bold tracking-widest uppercase">Detailed Scores</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-background rounded border p-2">
            <p className="text-muted-foreground text-[10px]">Attendance</p>
            <p className="font-bold">{formatMetric(r.attendance_score)}/100</p>
          </div>
          <div className="bg-background rounded border p-2">
            <p className="text-muted-foreground text-[10px]">Behaviour</p>
            <p className="font-bold">{formatMetric(r.behaviour_score)}/100</p>
          </div>
          <div className="bg-background rounded border p-2">
            <p className="text-muted-foreground text-[10px]">KPI Achievement</p>
            <p className="font-bold">{formatMetric(r.kpi_score)}/100</p>
          </div>
          <div className="bg-background rounded border p-2">
            <p className="text-muted-foreground text-[10px]">CBT Score</p>
            <p className="font-bold">{formatMetric(r.cbt_score)}/100</p>
          </div>
        </div>
        {r.overall_rating && (
          <div className="flex items-center gap-2 pt-2">
            <span className="text-sm font-medium">Overall Rating:</span>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${star <= (r.overall_rating || 0) ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/30"}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <h4 className="text-muted-foreground text-sm font-bold tracking-widest uppercase">Comments & Feedback</h4>
        <div className="space-y-2 text-sm">
          <p>
            <strong>Strengths:</strong> {r.strengths || "None recorded"}
          </p>
          <p>
            <strong>Areas for Improvement:</strong> {r.areas_for_improvement || "None recorded"}
          </p>
          <p>
            <strong>Manager Comments:</strong> {r.manager_comments || "None recorded"}
          </p>
          {r.acknowledged_at && (
            <div className="mt-4 border-t pt-2">
              <p className="text-xs font-medium text-emerald-600">Acknowledged on {formatWATDate(r.acknowledged_at)}</p>
              <p className="text-muted-foreground italic">
                &quot;{r.employee_comments || "No employee comments"}&quot;
              </p>
            </div>
          )}
        </div>
        {r.status === "completed" && !r.acknowledged_at && (
          <Button
            onClick={() => {
              setSelectedReview(r)
              setEmployeeComments(r.employee_comments || "")
            }}
            className="mt-4 w-full"
          >
            Acknowledge Review
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <DataTablePage
      title="My Performance Reviews"
      description="View and acknowledge your quarterly and annual evaluations."
      icon={FileText}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            title="Total Reviews"
            value={stats.total}
            icon={ClipboardList}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Avg. Performance"
            value={stats.avgScore}
            icon={TrendingUp}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            icon={CheckCircle}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<Review>
        data={visibleReviews}
        columns={columns}
        getRowId={(r) => r.id}
        filters={filters}
        searchPlaceholder="Search reviewer or cycle..."
        searchFn={(r, q) =>
          `${getQuarterLabel(r)} ${r.reviewer?.first_name} ${r.reviewer?.last_name}`.toLowerCase().includes(q)
        }
        expandable={{
          render: (r) => renderReviewDetails(r),
        }}
        rowActions={[
          {
            label: "View Detail",
            onClick: (r) => setDetailsReview(r),
          },
          {
            label: "Acknowledge",
            onClick: (r) => {
              setSelectedReview(r)
              setEmployeeComments(r.employee_comments || "")
            },
            hidden: (r) => r.status !== "completed" || !!r.acknowledged_at,
          },
        ]}
        urlSync
      />

      <Dialog open={Boolean(selectedReview)} onOpenChange={(open) => !open && setSelectedReview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Acknowledge Performance Review</DialogTitle>
            <DialogDescription>Confirm that you have read and understood this evaluation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Any comments regarding this review?</p>
              <Textarea
                value={employeeComments}
                onChange={(e) => setEmployeeComments(e.target.value)}
                placeholder="Enter your feedback or comments here..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedReview(null)}>
              Cancel
            </Button>
            <Button onClick={acknowledgeReview} disabled={isSubmitting}>
              {isSubmitting ? "Processing..." : "I Acknowledge this Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailsReview)} onOpenChange={(open) => !open && setDetailsReview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review Details</DialogTitle>
            <DialogDescription>{detailsReview ? getQuarterLabel(detailsReview) : "Review details"}</DialogDescription>
          </DialogHeader>
          {detailsReview ? renderReviewDetails(detailsReview) : null}
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
