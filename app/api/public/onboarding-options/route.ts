import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { rateLimit, getClientId } from "@/lib/rate-limit"

export async function GET(req: Request) {
  const rl = await rateLimit(`onboarding-options:${getClientId(req)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "System configuration error" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const [deptsResult, locsResult, catsResult] = await Promise.all([
    supabase.from("departments").select("name").eq("is_active", true).order("name"),
    supabase.from("office_locations").select("name").eq("is_active", true).order("name"),
    supabase.from("contract_categories").select("name, code").eq("is_active", true).order("sort_order"),
  ])

  if (deptsResult.error || locsResult.error || catsResult.error) {
    return NextResponse.json({ error: "Failed to fetch options" }, { status: 500 })
  }

  return NextResponse.json({
    departments: deptsResult.data.map((d) => d.name),
    officeLocations: locsResult.data.map((d) => d.name),
    contractCategories: catsResult.data || [],
  })
}
