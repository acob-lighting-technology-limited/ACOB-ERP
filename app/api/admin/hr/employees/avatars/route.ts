import { NextRequest, NextResponse } from "next/server"
import { getScopedDepartments, requireApiAdminScope } from "@/lib/admin/api-scope"
import { canAccessAdminSection } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getAvatarSignedUrls } from "@/lib/profile-photos"
import { getClientId, rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

/**
 * Profile photos live in a private bucket, so a raw `avatar_path` is not renderable —
 * it has to be signed server-side. This returns `{ [profileId]: signedUrl }` for every
 * employee in the caller's scope, which is what the HR employee list needs to show real
 * faces instead of initials. Same signing helper the birthday celebrant list uses.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-employee-avatars:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult

  if (!canAccessAdminSection(scope, "hr")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const scopedDepartments = getScopedDepartments(scope)
  if (scopedDepartments !== null && scopedDepartments.length === 0) {
    return NextResponse.json({ data: {} })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)

  let query = dataClient.from("profiles").select("id, avatar_path").not("avatar_path", "is", null)
  if (scopedDepartments !== null) {
    query = query.in("department", scopedDepartments)
  }

  const { data: rows, error } = await query
  if (error) {
    return NextResponse.json({ error: "Failed to load avatars" }, { status: 500 })
  }

  const profiles = (rows ?? []) as { id: string; avatar_path: string | null }[]
  const paths = profiles.map((p) => p.avatar_path).filter((path): path is string => Boolean(path))
  const signedUrlsByPath = await getAvatarSignedUrls(dataClient, paths)

  const data: Record<string, string> = {}
  for (const profile of profiles) {
    const signed = profile.avatar_path ? signedUrlsByPath.get(profile.avatar_path) : undefined
    if (signed) data[profile.id] = signed
  }

  return NextResponse.json({ data })
}
