import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PmsTablePage } from "@/app/admin/hr/pms/_components/pms-table-page"
import { getCurrentUserPmsData } from "../_lib"
import { CycleSelector } from "../_components/cycle-selector"

type ReviewQueryRow = {
  cbt_score: number | null
  review_cycle_id: string | null
  review_cycles?: { name?: string | null } | { name?: string | null }[] | null
}

type AttemptQueryRow = {
  score: number | null
  review_cycle_id: string | null
  review_cycles?: { name?: string | null } | { name?: string | null }[] | null
}

export default async function PmsCbtPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle_id?: string }>
}) {
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
      .select("cbt_score, review_cycle_id, review_cycles(name)")
      .eq("user_id", user.id)
      .not("cbt_score", "is", null)
      .order("created_at", { ascending: false })
      .returns<ReviewQueryRow[]>(),
    supabase
      .from("cbt_attempts")
      .select("score, review_cycle_id, review_cycles(name)")
      .eq("profile_id", user.id)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .returns<AttemptQueryRow[]>(),
  ])

  const rowsMap = new Map<string, { cycle: string; cbt_score: string; review_cycle_id: string }>()

  for (const review of reviews || []) {
    const cycleName = Array.isArray(review.review_cycles)
      ? review.review_cycles[0]?.name || "-"
      : review.review_cycles?.name || "-"
    const scoreVal =
      typeof review.cbt_score === "number" && Number.isFinite(review.cbt_score)
        ? `${review.cbt_score.toFixed(2).replace(/\.00$/, "")}%`
        : "-"
    if (review.review_cycle_id) {
      rowsMap.set(review.review_cycle_id, {
        cycle: cycleName,
        cbt_score: scoreVal,
        review_cycle_id: review.review_cycle_id,
      })
    }
  }

  for (const attempt of attempts || []) {
    if (attempt.review_cycle_id && !rowsMap.has(attempt.review_cycle_id)) {
      const cycleName = Array.isArray(attempt.review_cycles)
        ? attempt.review_cycles[0]?.name || "-"
        : attempt.review_cycles?.name || "-"
      const scoreVal =
        typeof attempt.score === "number" && Number.isFinite(attempt.score)
          ? `${Number(attempt.score).toFixed(2).replace(/\.00$/, "")}%`
          : "-"
      rowsMap.set(attempt.review_cycle_id, {
        cycle: cycleName,
        cbt_score: scoreVal,
        review_cycle_id: attempt.review_cycle_id,
      })
    }
  }

  const rows = Array.from(rowsMap.values()).map((row) => ({
    user_id: user.id,
    ...row,
  }))

  return (
    <PmsTablePage
      title="PMS CBT"
      description="Your CBT score history by review cycle. Use the standalone /cbt page only when you are starting the live test."
      backHref="/pms"
      backLabel="Back to PMS"
      icon="cbt"
      cycles={cycles}
      activeCycleId={activeCycleId}
      tableTitle="CBT Score History"
      tableDescription="Recorded CBT scores for your review cycles."
      rows={rows}
      columns={[
        { key: "cycle", label: "Cycle" },
        { key: "cbt_score", label: "CBT Score" },
      ]}
      searchPlaceholder="Search CBT cycles..."
      hideSecondaryFilter
      cbtExpandable
    />
  )
}
