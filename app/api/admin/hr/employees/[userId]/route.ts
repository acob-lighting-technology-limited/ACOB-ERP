import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  const { data: profileData, error: profileError } = await db.from("profiles").select("*").eq("id", userId).single()
  if (profileError || !profileData) {
    return NextResponse.json({ error: profileError?.message ?? "Employee not found" }, { status: 404 })
  }

  const { data: tasksData } = await db
    .from("tasks")
    .select("*")
    .eq("assigned_to", userId)
    .order("created_at", { ascending: false })

  const { data: deviceAssignments } = await db
    .from("device_assignments")
    .select("device_id, assigned_at")
    .eq("assigned_to", userId)
    .eq("is_current", true)

  let devices: Record<string, unknown>[] = []
  if (deviceAssignments && deviceAssignments.length > 0) {
    const deviceIds = deviceAssignments.map((da) => da.device_id)
    const { data: devicesData } = await db.from("devices").select("*").in("id", deviceIds)
    if (devicesData) {
      devices = devicesData.map((device) => {
        const assignment = deviceAssignments.find((da) => da.device_id === device.id)
        return { ...device, assigned_at: assignment?.assigned_at || device.created_at }
      })
    }
  }

  const { data: assetAssignments } = await db
    .from("asset_assignments")
    .select("asset_id, assigned_at")
    .eq("assigned_to", userId)
    .eq("is_current", true)

  let assets: Record<string, unknown>[] = []
  if (assetAssignments && assetAssignments.length > 0) {
    const assetIds = assetAssignments.map((aa) => aa.asset_id)
    const { data: assetsData } = await db.from("assets").select("*").in("id", assetIds).is("deleted_at", null)
    if (assetsData) {
      assets = assetsData.map((asset) => {
        const assignment = assetAssignments.find((aa) => aa.asset_id === asset.id)
        return { ...asset, assigned_at: assignment?.assigned_at || asset.created_at }
      })
    }
  }

  const { data: docsData } = await db
    .from("user_documentation")
    .select("id, title, category, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  const { data: logsData } = await db
    .from("audit_logs")
    .select("*")
    .or(`user_id.eq.${userId},entity_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(50)

  const { data: feedbackData } = await db
    .from("feedback")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  return NextResponse.json({
    data: {
      profile: profileData,
      tasks: tasksData || [],
      devices,
      assets,
      documentation: docsData || [],
      auditLogs: logsData || [],
      feedback: feedbackData || [],
    },
  })
}
