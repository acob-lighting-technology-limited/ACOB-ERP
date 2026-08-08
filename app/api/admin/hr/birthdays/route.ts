import { NextRequest, NextResponse } from "next/server"
import { getScopedDepartments, requireApiAdminScope } from "@/lib/admin/api-scope"
import { canAccessAdminSection } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getAvatarSignedUrls } from "@/lib/profile-photos"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const MMDD_PATTERN = /^\d{2}-\d{2}$/

/** Inclusive MM-DD range check that handles wraparound (e.g. Dec 28 – Jan 3). */
function isInRange(mmdd: string, start: string, end: string): boolean {
  if (start <= end) return mmdd >= start && mmdd <= end
  return mmdd >= start || mmdd <= end
}

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-birthdays:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult

  if (!canAccessAdminSection(scope, "hr")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const start = searchParams.get("start") || ""
  const end = searchParams.get("end") || ""

  if (!MMDD_PATTERN.test(start) || !MMDD_PATTERN.test(end)) {
    return NextResponse.json({ error: "start and end must be MM-DD" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)

  // Department leads (and admins inside a department console) only see their
  // own department's celebrants; global admins see everyone.
  const scopedDepartments = getScopedDepartments(scope)
  if (scopedDepartments !== null && scopedDepartments.length === 0) {
    return NextResponse.json({ data: [] })
  }

  let profilesQuery = dataClient
    .from("profiles")
    .select("first_name, last_name, birthday, department, avatar_path")
    .eq("employment_status", "active")
    .not("birthday", "is", null)

  if (scopedDepartments !== null) {
    profilesQuery = profilesQuery.in("department", scopedDepartments)
  }

  const { data: profiles, error } = await profilesQuery

  if (error) {
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 })
  }

  const matches = (profiles || []).filter((p) => p.birthday && isInRange(p.birthday, start, end))

  const avatarPaths = matches.map((p) => p.avatar_path).filter((path): path is string => Boolean(path))
  const signedUrlsByPath = await getAvatarSignedUrls(dataClient, avatarPaths)

  const celebrants = matches
    .map((p) => ({
      firstName: p.first_name,
      lastName: p.last_name,
      department: p.department || "Organization",
      birthday: p.birthday as string,
      avatarUrl: p.avatar_path ? (signedUrlsByPath.get(p.avatar_path) ?? null) : null,
    }))
    .sort((a, b) => a.birthday.localeCompare(b.birthday))

  return NextResponse.json({ data: celebrants })
}
