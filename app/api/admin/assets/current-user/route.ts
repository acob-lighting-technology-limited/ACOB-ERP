import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"

export const dynamic = "force-dynamic"

// Resolves the caller's own user id server-side (used to default "assigned by" /
// "created by" fields in the assets dialogs without querying Supabase from the browser).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  return NextResponse.json({ userId: scopeResult.scope.userId })
}
