import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"

export const dynamic = "force-dynamic"

// Resolves the caller's own user id server-side — used by admin client
// components that need the current user's id for a follow-up call (e.g.
// notification "assigned by") without querying Supabase from the browser.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  return NextResponse.json({ userId: scopeResult.scope.userId })
}
