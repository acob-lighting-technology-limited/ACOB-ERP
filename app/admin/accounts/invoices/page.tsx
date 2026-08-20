import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { InvoicesPage, type Invoice } from "./view"

const log = logger("finance-invoices-page")

export const dynamic = "force-dynamic"

async function getInitialInvoices(): Promise<Invoice[] | undefined> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false })
    if (error) {
      if (error.code === "42P01") return [] // table doesn't exist yet
      log.error({ err: error }, "Failed to fetch invoices")
      return undefined
    }
    return (data ?? []) as Invoice[]
  } catch (err) {
    log.error({ err }, "Unexpected error fetching initial invoices")
    return undefined
  }
}

export default async function InvoicesPageRoute() {
  const initialInvoices = await getInitialInvoices()
  return <InvoicesPage initialInvoices={initialInvoices} />
}
