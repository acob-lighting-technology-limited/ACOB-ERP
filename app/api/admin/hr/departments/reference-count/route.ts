import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Counts correspondence_records referencing a department_code — used to warn
// before renaming/changing a department's code.
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike || scope.scopeMode === "lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const code = request.nextUrl.searchParams.get("code")
  if (!code) return NextResponse.json({ count: 0 })

  const db = getServiceRoleClientOrFallback(supabase)
  const { count } = await db
    .from("correspondence_records")
    .select("id", { count: "exact", head: true })
    .eq("department_code", code)

  return NextResponse.json({ count: count ?? 0 })
}
