import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { CorporateScorecardRegister } from "./_components/corporate-scorecard-register"

export const metadata: Metadata = {
  title: "Corporate Scorecard | Matrix",
  description: "The 2026 strategic plan's 61 corporate KPIs and which departments own them.",
}

type DbClient = Awaited<ReturnType<typeof createClient>>

export default async function CorporateScorecardPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect("/auth/login")

  const scope = await resolveAdminScope(supabase as DbClient, user.id)
  if (!scope) redirect("/profile")

  return <CorporateScorecardRegister />
}
