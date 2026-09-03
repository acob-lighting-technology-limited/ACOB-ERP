import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PmsTablePage } from "@/app/admin/hr/pms/_components/pms-table-page"
import { formatCycleLabel } from "@/lib/pms/cadence"
import { formatWATDateTime } from "@/lib/utils/date"
import { getCurrentUserPmsData } from "../_lib"

type ReviewQueryRow = {
  cbt_score: number | null
  review_cycle_id: string | null
  created_at: string | null
  review_cycles?: { name?: string | null } | { name?: string | null }[] | null
}

type AttemptQueryRow = {
  id: string
  score: number | null
  total_questions: number | null
  correct_answers: number | null
  started_at: string | null
  submitted_at: string | null
  status: string | null
  cbt_details: { tab_switch_count?: number } | null
  review_cycle_id: string | null
  review_cycles?: { name?: string | null } | { name?: string | null }[] | null
}

export default async function PmsCbtPage({ searchParams }: { searchParams: Promise<{ cycle_id?: string }> }) {
  const { cycle_id } = await searchParams
  const { cycles, activeCycleId } = await getCurrentUserPmsData(cycle_id)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const [{ data: reviews }, { data: attempts }] = await Promise.all([
    supabase
      .from("performance_reviews")
      .select("cbt_score, review_cycle_id, created_at, review_cycles(name)")
      .eq("user_id", user.id)
      .not("cbt_score", "is", null)
      .order("created_at", { ascending: false })
      .returns<ReviewQueryRow[]>(),
    supabase
      .from("cbt_attempts")
      .select(
        "id, score, total_questions, correct_answers, started_at, submitted_at, status, cbt_details, review_cycle_id, review_cycles(name)"
      )
      .eq("profile_id", user.id)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .returns<AttemptQueryRow[]>(),
  ])

  const rowsMap = new Map<
    string,
    {
      cycle: string
      cbt_score: string
      num_score: number | null
      date_taken: string
      questions: string
      status: string
      __rawStatus: string
      proctoring: string
      review_cycle_id: string
      user_id: string
    }
  >()

  // Process attempts first for rich details (questions, tab switches, submitted_at)
  for (const attempt of attempts || []) {
    if (attempt.review_cycle_id && !rowsMap.has(attempt.review_cycle_id)) {
      const cycleName = Array.isArray(attempt.review_cycles)
        ? attempt.review_cycles[0]?.name || "-"
        : attempt.review_cycles?.name || "-"
      const numScore = typeof attempt.score === "number" && Number.isFinite(attempt.score) ? attempt.score : null
      const scoreVal = numScore !== null ? `${numScore.toFixed(1).replace(/\.0$/, "")}%` : "-"
      const isPassed = numScore !== null && numScore >= 70
      const tabSwitches = attempt.cbt_details?.tab_switch_count ?? 0

      rowsMap.set(attempt.review_cycle_id, {
        cycle: formatCycleLabel(cycleName),
        cbt_score: scoreVal,
        num_score: numScore,
        date_taken: attempt.submitted_at ? formatWATDateTime(attempt.submitted_at) : "-",
        questions:
          attempt.total_questions && attempt.total_questions > 0
            ? `${attempt.correct_answers ?? 0} / ${attempt.total_questions}`
            : "-",
        status: isPassed ? "passed" : "needs_improvement",
        __rawStatus: isPassed ? "passed" : "needs_improvement",
        proctoring: `${tabSwitches} switch${tabSwitches === 1 ? "" : "es"}`,
        review_cycle_id: attempt.review_cycle_id,
        user_id: user.id,
      })
    }
  }

  // Fall back to reviews for any cycle that only exists in performance_reviews
  for (const review of reviews || []) {
    if (review.review_cycle_id && !rowsMap.has(review.review_cycle_id)) {
      const cycleName = Array.isArray(review.review_cycles)
        ? review.review_cycles[0]?.name || "-"
        : review.review_cycles?.name || "-"
      const numScore =
        typeof review.cbt_score === "number" && Number.isFinite(review.cbt_score) ? review.cbt_score : null
      const scoreVal = numScore !== null ? `${numScore.toFixed(1).replace(/\.0$/, "")}%` : "-"
      const isPassed = numScore !== null && numScore >= 70

      rowsMap.set(review.review_cycle_id, {
        cycle: formatCycleLabel(cycleName),
        cbt_score: scoreVal,
        num_score: numScore,
        date_taken: review.created_at ? formatWATDateTime(review.created_at) : "-",
        questions: "-",
        status: isPassed ? "passed" : "needs_improvement",
        __rawStatus: isPassed ? "passed" : "needs_improvement",
        proctoring: "0 switches",
        review_cycle_id: review.review_cycle_id,
        user_id: user.id,
      })
    }
  }

  const rows = Array.from(rowsMap.values())

  const scoredRows = rows.filter((r) => typeof r.num_score === "number")
  const totalCompleted = scoredRows.length
  const avgScore =
    totalCompleted > 0
      ? Math.round(scoredRows.reduce((acc, r) => acc + (r.num_score as number), 0) / totalCompleted)
      : null
  const latestScore = scoredRows[0]?.num_score ?? null
  const passedCount = scoredRows.filter((r) => (r.num_score as number) >= 70).length
  const passRate = totalCompleted > 0 ? Math.round((passedCount / totalCompleted) * 100) : null

  const summaryCards = [
    { label: "Latest CBT Score", value: latestScore !== null ? `${latestScore}%` : "-" },
    { label: "Average Score", value: avgScore !== null ? `${avgScore}%` : "-" },
    { label: "Tests Completed", value: totalCompleted },
    { label: "Pass Rate", value: passRate !== null ? `${passRate}%` : "-" },
  ]

  return (
    <PmsTablePage
      title="PMS CBT"
      description="Your CBT score history by review cycle. Use the standalone /cbt page only when you are starting a live test."
      backHref="/pms"
      backLabel="Back to PMS"
      icon="cbt"
      cycles={cycles}
      activeCycleId={activeCycleId}
      summaryCards={summaryCards}
      tableTitle="CBT Score History"
      tableDescription="Recorded CBT scores for your review cycles. Expand any row to review questions and answers."
      rows={rows}
      columns={[
        { key: "cycle", label: "Cycle" },
        { key: "date_taken", label: "Date & Time Taken" },
        { key: "cbt_score", label: "Score" },
        { key: "questions", label: "Questions" },
        { key: "status", label: "Result" },
        { key: "proctoring", label: "Focus / Proctoring" },
      ]}
      searchPlaceholder="Search CBT cycles or results..."
      hideSecondaryFilter
      cbtExpandable
    />
  )
}
