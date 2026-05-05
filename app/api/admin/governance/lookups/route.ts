import { NextResponse } from "next/server"
import { createGovernanceClient, requireGovernanceActor } from "@/lib/governance/auth"
import type { GovernanceDepartment } from "@/types/governance"

export async function GET() {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "read")
    if (actor instanceof NextResponse) return actor

    const { data, error } = await ((admin as any).from("departments") as any)
      .select("id,name")
      .eq("is_active", true)
      .order("name")

    if (error) throw error

    return NextResponse.json({ data: { departments: (data || []) as GovernanceDepartment[] } })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
