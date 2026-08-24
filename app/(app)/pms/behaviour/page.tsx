import { createClient } from "@/lib/supabase/server"
import { BehaviourContent } from "./page-content"
import { getCurrentUserPmsData } from "../_lib"
import { CycleSelector } from "../_components/cycle-selector"

type ReviewDetailRow = {
  behaviour_score: number | null
  behaviour_competencies: Record<string, unknown> | null
  strengths: string | null
  areas_for_improvement: string | null
  manager_comments: string | null
  review_cycles?: { name?: string } | { name?: string }[] | null
}

type CompetencyFrameworkRow = {
  key: string
  label: string
}

function normalizeValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null
}

export default async function PmsBehaviourPage({ searchParams }: { searchParams: Promise<{ cycle_id?: string }> }) {
  const { cycle_id } = await searchParams
  const supabase = await createClient()
  const { profile, score, cycles, activeCycleId } = await getCurrentUserPmsData(cycle_id)

  let reviewQuery = supabase
    .from("performance_reviews")
    .select(
      "behaviour_score, behaviour_competencies, strengths, areas_for_improvement, manager_comments, review_cycles(name)"
    )
    .eq("user_id", profile?.id || "")

  if (activeCycleId) {
    reviewQuery = reviewQuery.eq("review_cycle_id", activeCycleId)
  }

  const [{ data: latestReview }, { data: frameworks }] = await Promise.all([
    reviewQuery.order("created_at", { ascending: false }).limit(1).maybeSingle<ReviewDetailRow>(),
    // The competencies actually rated on are whatever the admin Competencies
    // page has configured, not a fixed list — this page used to hard-code six
    // keys, so a competency added or renamed there never showed up here.
    supabase
      .from("competency_frameworks")
      .select("key, label")
      .eq("is_active", true)
      .eq("category", "behaviour")
      .order("sort_order")
      .returns<CompetencyFrameworkRow[]>(),
  ])

  const competenciesSource = latestReview?.behaviour_competencies || {}
  const rows = (frameworks || [])
    .map((framework) => ({
      competency: framework.label,
      value: normalizeValue(competenciesSource[framework.key]),
    }))
    .filter((row): row is { competency: string; value: number } => row.value !== null)

  const average =
    rows.length > 0
      ? Math.round((rows.reduce((sum, row) => sum + row.value, 0) / rows.length) * 100) / 100
      : score.behaviour_score

  return (
    <BehaviourContent
      rows={rows}
      average={average}
      cycle={
        score.cycle_name ||
        (Array.isArray(latestReview?.review_cycles)
          ? latestReview?.review_cycles[0]?.name || "-"
          : latestReview?.review_cycles?.name || "-")
      }
      strengths={latestReview?.strengths || ""}
      areasForImprovement={latestReview?.areas_for_improvement || ""}
      managerComments={latestReview?.manager_comments || ""}
      cycles={cycles}
      activeCycleId={activeCycleId}
    />
  )
}
