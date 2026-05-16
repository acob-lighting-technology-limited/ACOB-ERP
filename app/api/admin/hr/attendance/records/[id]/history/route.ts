import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { rateLimit, getClientId } from "@/lib/rate-limit"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(`admin-attendance-history:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = String(profile?.role || "")
  if (!["developer", "admin", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await dataClient
    .from("audit_logs")
    .select("id, created_at, user_id, action, operation, old_values, new_values, changed_fields")
    .eq("entity_type", "attendance_record")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 })

  const editorIds = [...new Set((data || []).map((row) => row.user_id).filter(Boolean))]
  const profileMap = new Map<
    string,
    { first_name?: string | null; last_name?: string | null; full_name?: string | null }
  >()
  if (editorIds.length > 0) {
    const { data: editors } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, full_name")
      .in("id", editorIds)
    for (const editor of editors || []) profileMap.set(editor.id, editor)
  }

  const history = (data || []).map((row) => {
    const p = row.user_id ? profileMap.get(row.user_id) : null
    const editor =
      p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || row.user_id || "Unknown"
    return {
      ...row,
      editor_name: editor,
    }
  })

  return NextResponse.json({ data: history })
}
