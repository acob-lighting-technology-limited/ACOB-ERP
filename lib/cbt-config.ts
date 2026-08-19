import { SupabaseClient } from "@supabase/supabase-js"

export interface CbtSettings {
  time_per_question_seconds: number
  total_questions_count: number
  show_detailed_responses: boolean
  allowed_roles?: string[]
  allowed_user_ids?: string[]
}

export const DEFAULT_CBT_SETTINGS: CbtSettings = {
  time_per_question_seconds: 45,
  total_questions_count: 10,
  show_detailed_responses: false,
  allowed_roles: [],
  allowed_user_ids: [],
}

interface AccessScopeShape {
  userId?: string | null
  role?: string | null
  isDepartmentLead?: boolean | null
}

/**
 * Validates if the given user scope has access to CBT.
 * Super Admins and Developers always return true.
 * Users listed in allowed_user_ids or matching allowed_roles return true.
 */
export function canAccessCbt(scope: AccessScopeShape | null | undefined, settings: CbtSettings): boolean {
  if (!scope) return false

  const normalizedRole = scope.role ? scope.role.trim().toLowerCase() : ""

  // System superusers always have full access
  if (normalizedRole === "super_admin" || normalizedRole === "developer") {
    return true
  }

  // Individual user override access
  if (scope.userId && Array.isArray(settings.allowed_user_ids) && settings.allowed_user_ids.includes(scope.userId)) {
    return true
  }

  // Role-based access
  if (Array.isArray(settings.allowed_roles) && settings.allowed_roles.length > 0) {
    if (normalizedRole && settings.allowed_roles.includes(normalizedRole)) {
      return true
    }

    // Department lead access check if 'department_lead' or 'lead' is allowed
    if (
      scope.isDepartmentLead &&
      (settings.allowed_roles.includes("department_lead") || settings.allowed_roles.includes("lead"))
    ) {
      return true
    }
  }

  return false
}

/**
 * Loads the active CBT settings from system_settings or returns the default.
 */
export async function getCbtSettings(supabase: SupabaseClient): Promise<CbtSettings> {
  try {
    const { data } = await supabase.from("system_settings").select("value").eq("key", "cbt_settings").maybeSingle()

    if (!data?.value || typeof data.value !== "object") {
      return DEFAULT_CBT_SETTINGS
    }

    const val = data.value as Partial<CbtSettings>
    const timePerQ =
      typeof val.time_per_question_seconds === "number" && val.time_per_question_seconds > 0
        ? val.time_per_question_seconds
        : DEFAULT_CBT_SETTINGS.time_per_question_seconds

    const totalQ =
      typeof val.total_questions_count === "number" && val.total_questions_count > 0
        ? val.total_questions_count
        : DEFAULT_CBT_SETTINGS.total_questions_count

    const showDetailed =
      typeof val.show_detailed_responses === "boolean"
        ? val.show_detailed_responses
        : DEFAULT_CBT_SETTINGS.show_detailed_responses

    const allowedRoles = Array.isArray(val.allowed_roles)
      ? val.allowed_roles.filter((r): r is string => typeof r === "string")
      : DEFAULT_CBT_SETTINGS.allowed_roles

    const allowedUserIds = Array.isArray(val.allowed_user_ids)
      ? val.allowed_user_ids.filter((id): id is string => typeof id === "string")
      : DEFAULT_CBT_SETTINGS.allowed_user_ids

    return {
      time_per_question_seconds: timePerQ,
      total_questions_count: totalQ,
      show_detailed_responses: showDetailed,
      allowed_roles: allowedRoles,
      allowed_user_ids: allowedUserIds,
    }
  } catch (error) {
    return DEFAULT_CBT_SETTINGS
  }
}
