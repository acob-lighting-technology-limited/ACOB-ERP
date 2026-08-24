import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { ScorecardSummaryContent } from "../_components/scorecard-summary-content"

export const metadata: Metadata = {
  title: "Scorecard Summary | Corporate Scorecard",
  description: "Company-wide attainment against the 2026 plan, by perspective and by department.",
}

type DbClient = Awaited<ReturnType<typeof createClient>>

export default async function ScorecardSummaryPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect("/auth/login")

  const scope = await resolveAdminScope(supabase as DbClient, user.id)
  if (!scope) redirect("/profile")

  return <ScorecardSummaryContent />
}
