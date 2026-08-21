import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { PortfoliosContent } from "./_components/portfolios-content"

export const metadata: Metadata = {
  title: "Project Portfolios | Matrix",
  description: "Programmes and client groupings holding the company's project portfolio.",
}

type DbClient = Awaited<ReturnType<typeof createClient>>

export default async function AdminPortfoliosPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect("/auth/login")

  const scope = await resolveAdminScope(supabase as DbClient, user.id)
  if (!scope) redirect("/profile")

  return <PortfoliosContent />
}
