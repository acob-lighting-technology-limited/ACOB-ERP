import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"

const log = logger("admin-convert-type")
export const dynamic = "force-dynamic"

const ConvertTypeSchema = z.object({
  profileId: z.string().uuid("Invalid profile ID"),
  newType: z.enum(["full_time", "part_time", "contract"]),
  newCategoryCode: z.string().trim().nullable().optional(),
})

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-convert-type:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = String(profile?.role || "")
  if (!["developer", "admin", "super_admin"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { supabase, user }
}

/** POST /api/admin/employees/convert-type — convert employment type and issue new ID */
export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = ConvertTypeSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const { profileId, newType, newCategoryCode } = parsed.data
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  // Fetch current details for audit logging context before mutating
  const { data: oldProfile, error: oldError } = await dataClient
    .from("profiles")
    .select("employee_number, employment_type, contract_category_id")
    .eq("id", profileId)
    .single()

  if (oldError || !oldProfile) {
    return NextResponse.json({ error: "Employee profile not found" }, { status: 404 })
  }

  // Call the database function to convert type and assign a new number
  const { data: newNumber, error } = await dataClient.rpc("convert_employment_type", {
    p_profile_id: profileId,
    p_new_type: newType,
    p_new_category_code: newCategoryCode || null,
    p_actor: auth.user.id,
  })

  if (error) {
    log.error({ err: String(error) }, "Failed to convert employment type")
    return NextResponse.json({ error: `Conversion failed: ${error.message}` }, { status: 500 })
  }

  // Write audit log
  await writeAuditLog(
    auth.supabase,
    {
      action: "update",
      entityType: "profile",
      entityId: profileId,
      oldValues: {
        employee_number: oldProfile.employee_number,
        employment_type: oldProfile.employment_type,
        contract_category_id: oldProfile.contract_category_id,
      },
      newValues: {
        employee_number: newNumber,
        employment_type: newType,
        contract_category_code: newCategoryCode || null,
      },
      context: { actorId: auth.user.id, source: "api", route: "/api/admin/employees/convert-type" },
    },
    { failOpen: true }
  )

  return NextResponse.json({
    success: true,
    newEmployeeNumber: newNumber,
    message: `Successfully converted employee type to ${newType}. New ID: ${newNumber}`,
  })
}
