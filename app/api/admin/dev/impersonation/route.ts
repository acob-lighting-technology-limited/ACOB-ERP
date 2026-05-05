import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"

const StartImpersonationSchema = z.object({
  targetUserId: z.string().uuid("Invalid user id"),
  nextPath: z.string().optional(),
})

type DevImpersonationProfileRow = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
  department?: string | null
  role?: string | null
  employment_status?: string | null
}

function sanitizeNextPath(input?: string): string {
  const fallback = "/profile"
  if (!input) return fallback
  const value = String(input || "").trim()
  if (!value.startsWith("/")) return fallback
  if (value.startsWith("//")) return fallback
  if (value.includes(":")) return fallback
  return value
}

function getCanonicalAppUrl(request: NextRequest): string {
  const requestOrigin = String(request.headers.get("origin") || "").trim()
  const requestUrlOrigin = new URL(request.url).origin
  const envAppUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").trim()
  const envSiteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim()

  const candidates = [requestOrigin, envAppUrl, envSiteUrl, requestUrlOrigin, "https://erp.acoblighting.com"]
    .map((value) => value.replace(/\/+$/, ""))
    .filter(Boolean)

  for (const candidate of candidates) {
    if (candidate.includes(".vercel.app")) continue
    return candidate
  }

  return "https://erp.acoblighting.com"
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope || !canAccessAdminSection(scope, "dev")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await dataClient
    .from("profiles")
    .select("id, full_name, first_name, last_name, company_email, department, role, employment_status")
    .order("full_name", { ascending: true })
    .limit(3000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = ((data || []) as DevImpersonationProfileRow[])
    .filter((row) => row.id !== user.id)
    .map((row) => ({
      id: row.id,
      full_name: row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unnamed User",
      company_email: row.company_email || "",
      department: row.department || "Unassigned",
      role: row.role || "employee",
      employment_status: row.employment_status || "active",
    }))

  return NextResponse.json({ data: rows })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope || !canAccessAdminSection(scope, "dev")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service-role credentials are required for impersonation." }, { status: 500 })
  }

  const parsed = StartImpersonationSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload" }, { status: 400 })
  }

  const { targetUserId, nextPath } = parsed.data
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "You are already signed in as this user." }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: targetProfile, error: targetError } = await dataClient
    .from("profiles")
    .select("id, full_name, first_name, last_name, company_email, role, department")
    .eq("id", targetUserId)
    .single<DevImpersonationProfileRow>()

  if (targetError || !targetProfile) {
    return NextResponse.json({ error: "Target user not found." }, { status: 404 })
  }

  const targetEmail = String(targetProfile.company_email || "")
    .trim()
    .toLowerCase()
  if (!targetEmail) {
    return NextResponse.json({ error: "Target user has no company email configured for login." }, { status: 400 })
  }

  const safeNextPath = sanitizeNextPath(nextPath)
  const appUrl = getCanonicalAppUrl(request)
  const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent(safeNextPath)}`

  const { data: linkData, error: linkError } = await dataClient.auth.admin.generateLink({
    type: "magiclink",
    email: targetEmail,
    options: {
      redirectTo,
    },
  })

  const actionLink = linkData?.properties?.action_link
  const hashedToken = linkData?.properties?.hashed_token
  if (linkError || !actionLink) {
    return NextResponse.json({ error: linkError?.message || "Failed to generate impersonation link." }, { status: 500 })
  }

  const directConfirmLink = hashedToken
    ? `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${encodeURIComponent(safeNextPath)}`
    : null

  await writeAuditLog(
    dataClient,
    {
      action: "update",
      entityType: "profile",
      entityId: targetUserId,
      newValues: {
        event: "developer_impersonation_started",
        target_email: targetEmail,
        target_role: targetProfile.role || null,
        target_department: targetProfile.department || null,
        next_path: safeNextPath,
      },
      context: {
        actorId: user.id,
        source: "api",
        route: "/api/admin/dev/impersonation",
      },
      metadata: {
        event: "developer_impersonation_started",
      },
    },
    { failOpen: true }
  )

  return NextResponse.json({
    data: {
      directConfirmLink,
      actionLink,
      target: {
        id: targetProfile.id,
        full_name:
          targetProfile.full_name || `${targetProfile.first_name || ""} ${targetProfile.last_name || ""}`.trim(),
        company_email: targetEmail,
      },
    },
  })
}
