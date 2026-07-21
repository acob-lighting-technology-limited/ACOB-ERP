import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { notFound } from "next/navigation"
import { PayrollWorksheetPage } from "./view"

const log = logger("payroll-worksheet-page")
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

async function getWorksheetData(id: string) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) return undefined

    const { data: period, error } = await supabase.from("payroll_periods").select("*").eq("id", id).single()

    if (error || !period) {
      log.error({ err: error?.message }, "Failed to fetch payroll period detail")
      return undefined
    }

    return {
      period,
      isAdmin: scope.scopeMode !== "lead",
    }
  } catch (err) {
    log.error({ err: String(err) }, "Unexpected error fetching payroll worksheet details")
    return undefined
  }
}

export default async function PayrollWorksheetRoute({ params }: PageProps) {
  const { id } = await params
  const initialData = await getWorksheetData(id)
  if (!initialData) {
    return notFound()
  }

  return <PayrollWorksheetPage initialData={initialData} />
}
