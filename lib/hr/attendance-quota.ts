import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

const log = logger("attendance-quota")

/**
 * Department leads can grant a maximum of 3 LWP/AWP permissions per employee per month.
 * Any additional permission beyond 3 must be approved by a global admin.
 */
export async function validateLwpAwpMonthlyQuota(params: {
  dataClient: SupabaseClient
  userId: string
  targetStatus: string
  date: string // YYYY-MM-DD
  isAdminLike: boolean
  excludeRecordId?: string | null
}): Promise<{ allowed: boolean; error?: string }> {
  // Only enforce quota for LWP (lateness_with_permission) and AWP (absent_with_permission)
  if (!["lateness_with_permission", "absent_with_permission"].includes(params.targetStatus)) {
    return { allowed: true }
  }

  // Global Admins are exempt from the 3 per month limit
  if (params.isAdminLike) {
    return { allowed: true }
  }

  const parts = params.date.split("-")
  if (parts.length < 2) return { allowed: true }
  const year = parts[0]
  const month = parts[1]

  const monthStart = `${year}-${month}-01`
  const lastDay = new Date(Number(year), Number(month), 0).getDate()
  const monthEnd = `${year}-${month}-${String(lastDay).padStart(2, "0")}`

  try {
    let query = params.dataClient
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", params.userId)
      .in("status", ["lateness_with_permission", "absent_with_permission"])
      .gte("date", monthStart)
      .lte("date", monthEnd)

    if (params.excludeRecordId) {
      query = query.neq("id", params.excludeRecordId)
    }

    const { count, error } = await query

    if (error) {
      log.error({ err: error.message, userId: params.userId, date: params.date }, "Error checking LWP/AWP monthly quota")
      return { allowed: true }
    }

    const currentCount = count ?? 0
    if (currentCount >= 3) {
      return {
        allowed: false,
        error:
          "Department leads can only grant a maximum of 3 LWP/AWP permissions per employee per calendar month. This employee already has 3 LWP/AWP permissions for this month. Additional permissions must be approved by an admin.",
      }
    }

    return { allowed: true }
  } catch (err) {
    log.error({ err: String(err) }, "Failed to validate LWP/AWP monthly quota")
    return { allowed: true }
  }
}
