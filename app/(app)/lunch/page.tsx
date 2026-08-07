import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { loadMenuForDate, loadVotesForMenu } from "@/lib/hr/lunch-menu-server"
import { isVotingOpen, loadLunchSettings, lunchCostBreakdown, resolveVotingDeadline } from "@/lib/hr/lunch-voting"
import { toLocalISODate } from "@/lib/utils/date"
import { LunchContent, type LunchPollData } from "./lunch-content"

export const dynamic = "force-dynamic"

export default async function LunchPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const today = toLocalISODate()

  const settings = await loadLunchSettings(dataClient)
  const menu = await loadMenuForDate(dataClient, today)
  const votes = menu ? await loadVotesForMenu(dataClient, menu.id) : []
  const { cost, companySubsidy, employeeDeduction } = lunchCostBreakdown(settings)

  const initialData: LunchPollData = {
    date: today,
    menu,
    votes,
    votingOpen: menu ? isVotingOpen(menu, settings) : false,
    deadline: menu ? resolveVotingDeadline(menu, settings).toISOString() : null,
    pricing: { cost, company_subsidy: companySubsidy, employee_deduction: employeeDeduction },
    eatingDays: settings.eating_days,
  }

  return <LunchContent initialData={initialData} currentUserId={user.id} />
}
