import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { BillsPage, type Bill } from "./view"

const log = logger("finance-bills-page")

async function getInitialBills(): Promise<Bill[] | undefined> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("bills")
      .select("*")
      .order("created_at", { ascending: false })
    if (error) {
      if (error.code === "42P01") return [] // table doesn't exist yet
      log.error({ err: error }, "Failed to fetch bills")
      return undefined
    }
    return (data ?? []) as Bill[]
  } catch (err) {
    log.error({ err }, "Unexpected error fetching initial bills")
    return undefined
  }
}

export default async function BillsPageRoute() {
  const initialBills = await getInitialBills()
  return <BillsPage initialBills={initialBills} />
}
