import type { SupabaseClient } from "@supabase/supabase-js"
import { formatWATDate } from "@/lib/utils/date"

export type MeetingDocumentType =
  | "knowledge_sharing_session"
  | "minutes"
  | "action_points"
  | "attendance"
  | "transcript"

type ResolveMeetingDateClient = Pick<SupabaseClient, "rpc" | "from">
export const DEFAULT_MEETING_TIME = "08:30"

type MeetingDocumentNameParams = {
  documentType: MeetingDocumentType
  meetingDate: string | Date
  meetingWeek: number
  extension?: string
  department?: string | null
  presenterName?: string | null
}

function normalizeDateInput(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }

  const raw = String(value || "").trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid meeting date: ${raw}`)
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

export function toIsoDateString(value: string | Date): string {
  const date = normalizeDateInput(value)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function formatMeetingDateLabel(value: string | Date): string {
  return formatWATDate(normalizeDateInput(value), { day: "numeric", month: "long", year: "numeric" })
}

export function normalizeMeetingTime(value?: string | null): string {
  const raw = String(value || "").trim()
  if (!raw) return DEFAULT_MEETING_TIME
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/)
  if (!match) return DEFAULT_MEETING_TIME
  return `${match[1]}:${match[2]}`
}

function normalizeDisplayToken(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
}

function ensurePdfExtension(extension?: string): string {
  const normalized = String(extension || "pdf")
    .trim()
    .replace(/^\./, "")
    .toLowerCase()
  return normalized || "pdf"
}

export function buildMeetingDocumentFileName({
  documentType,
  meetingDate,
  meetingWeek,
  extension = "pdf",
  department,
  presenterName,
}: MeetingDocumentNameParams): string {
  const dateLabel = formatMeetingDateLabel(meetingDate)
  const ext = ensurePdfExtension(extension)

  if (documentType === "knowledge_sharing_session") {
    const dept = normalizeDisplayToken(department || "Unknown Department")
    const presenter = normalizeDisplayToken(presenterName || "Unknown Presenter")
    return `ACOB KSS - ${dept} - ${presenter} - ${dateLabel} - W${meetingWeek}.${ext}`
  }

  if (documentType === "minutes") {
    return `ACOB Minutes of Meeting - ${dateLabel} - W${meetingWeek}.${ext}`
  }

  if (documentType === "attendance") {
    return `ACOB Attendance - ${dateLabel} - W${meetingWeek}.${ext}`
  }

  if (documentType === "transcript") {
    return `ACOB Transcript - ${dateLabel} - W${meetingWeek}.${ext}`
  }

  return `ACOB Action Points - ${dateLabel} - W${meetingWeek}.${ext}`
}

export function sanitizeStoragePathSegment(value: string): string {
  return (
    String(value || "file")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "")
      .trim() || "file"
  )
}

export async function resolveEffectiveMeetingDateIso(
  supabase: ResolveMeetingDateClient,
  week: number,
  year: number
): Promise<string> {
  const { data, error } = await supabase.rpc("weekly_report_effective_meeting_date", {
    p_week: week,
    p_year: year,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error(`Meeting date could not be resolved for W${week}, ${year}`)
  }

  return toIsoDateString(String(data))
}

export async function resolveCanonicalMeetingSetup(
  supabase: ResolveMeetingDateClient,
  week: number,
  year: number
): Promise<{ meetingDate: string; meetingTime: string }> {
  const meetingDate = await resolveEffectiveMeetingDateIso(supabase, week, year)
  const { data, error } = await supabase
    .from("weekly_report_meeting_windows")
    .select("meeting_time")
    .eq("week_number", week)
    .eq("year", year)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return {
    meetingDate,
    meetingTime: normalizeMeetingTime(typeof data?.meeting_time === "string" ? data.meeting_time : null),
  }
}

export async function upsertCanonicalMeetingDate(
  supabase: ResolveMeetingDateClient,
  params: {
    meetingWeek: number
    meetingYear: number
    meetingDate: string
    meetingTime?: string | null
    actorId?: string | null
  }
): Promise<{ meetingDate: string; meetingTime: string }> {
  const payload: Record<string, unknown> = {
    week_number: params.meetingWeek,
    year: params.meetingYear,
    meeting_date: toIsoDateString(params.meetingDate),
    meeting_time: normalizeMeetingTime(params.meetingTime),
  }

  if (params.actorId) {
    payload.created_by = params.actorId
    payload.updated_by = params.actorId
  }

  const { error } = await supabase.from("weekly_report_meeting_windows").upsert(payload, {
    onConflict: "week_number,year",
  })

  if (error) {
    throw new Error(error.message)
  }

  return {
    meetingDate: String(payload.meeting_date),
    meetingTime: String(payload.meeting_time),
  }
}
