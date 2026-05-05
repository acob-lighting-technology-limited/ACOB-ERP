import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import type { UserRole } from "@/types/database"

const GOVERNANCE_READ_ROLES: UserRole[] = ["developer", "super_admin", "admin"]
const GOVERNANCE_MUTATE_ROLES: UserRole[] = ["developer", "super_admin"]

export async function createGovernanceClient() {
  const supabase = await createClient()
  const admin = getServiceRoleClientOrFallback(supabase as SupabaseClient)
  return { supabase, admin }
}

export async function requireGovernanceActor(
  supabase: SupabaseClient,
  mode: "read" | "mutate"
): Promise<{ role: UserRole } | NextResponse> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (error || !profile?.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const role = profile.role as UserRole
  const allowed = mode === "mutate" ? GOVERNANCE_MUTATE_ROLES : GOVERNANCE_READ_ROLES
  if (!allowed.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return { role }
}
