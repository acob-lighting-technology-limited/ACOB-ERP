import { SupabaseClient } from "@supabase/supabase-js"

export interface CbtSettings {
  time_per_question_seconds: number
  total_questions_count: number
  show_detailed_responses: boolean
}

export const DEFAULT_CBT_SETTINGS: CbtSettings = {
  time_per_question_seconds: 45,
  total_questions_count: 10,
  show_detailed_responses: false,
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

    return {
      time_per_question_seconds: timePerQ,
      total_questions_count: totalQ,
      show_detailed_responses: showDetailed,
    }
  } catch (error) {
    return DEFAULT_CBT_SETTINGS
  }
}
