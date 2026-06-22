import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PmsTablePage } from "@/app/admin/hr/pms/_components/pms-table-page"

export default async function PmsCbtPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: reviews } = await supabase
    .from("performance_reviews")
    .select("cbt_score, review_cycle_id, review_cycles(name)")
    .eq("user_id", user.id)
    .not("cbt_score", "is", null)
    .order("created_at", { ascending: false })

  const rows = (
    (reviews as Array<{
      cbt_score: number | null
      review_cycle_id: string
      review_cycles?: { name?: string } | { name?: string }[] | null
    }> | null) || []
  ).map((review) => ({
    user_id: user.id,
    review_cycle_id: review.review_cycle_id,
    cycle: Array.isArray(review.review_cycles)
      ? review.review_cycles[0]?.name || "-"
      : review.review_cycles?.name || "-",
    cbt_score:
      typeof review.cbt_score === "number" && Number.isFinite(review.cbt_score)
        ? `${review.cbt_score.toFixed(2).replace(/\.00$/, "")}%`
        : "-",
  }))

  return (
    <PmsTablePage
      title="PMS CBT"
      description="Your CBT score history by review cycle. Use the standalone /cbt page only when you are starting the live test."
      backHref="/pms"
      backLabel="Back to PMS"
      icon="cbt"
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
