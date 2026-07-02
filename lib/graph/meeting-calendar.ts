import { graphGet } from "@/lib/graph/client"

/**
 * Calendar-backed meeting discovery for the artifact-automation config UI.
 *
 * Microsoft Graph (app-only) cannot list a user's online meetings directly, but
 * it CAN list their calendar events. We read the organizer's calendar view,
 * keep only Teams online meetings, and dedupe by join URL (all occurrences of a
 * recurring series share one join URL) so the admin picks a real meeting from a
 * dropdown. The stored join URL is later resolved to an onlineMeeting id when
 * pulling attendance/transcripts.
 */

export type OrganizerMeetingOption = {
  /** Meeting subject shown in the dropdown. */
  subject: string
  /** Stable Teams join URL — the key we persist and later resolve. */
  joinUrl: string
  /** Most recent occurrence start seen for this join URL (ISO). */
  lastSeen: string | null
}

type GraphEvent = {
  subject?: string | null
  isOnlineMeeting?: boolean | null
  onlineMeeting?: { joinUrl?: string | null } | null
  start?: { dateTime?: string | null } | null
}

type GraphEventsResponse = {
  value?: GraphEvent[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidGraphEmail(value: string): boolean {
  return EMAIL_RE.test(String(value || "").trim())
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * List the organizer's distinct Teams meetings across a window around today.
 * Defaults to the last 90 days through the next 30 days, which reliably
 * surfaces recurring series even between occurrences.
 */
export async function listOrganizerTeamsMeetings(
  organizerEmail: string,
  options?: { pastDays?: number; futureDays?: number }
): Promise<OrganizerMeetingOption[]> {
  const email = organizerEmail.trim()
  if (!email) throw new Error("organizerEmail is required")

  const start = isoDaysFromNow(-(options?.pastDays ?? 90))
  const end = isoDaysFromNow(options?.futureDays ?? 30)

  const endpoint =
    `/users/${encodeURIComponent(email)}/calendarView` +
    `?startDateTime=${encodeURIComponent(start)}` +
    `&endDateTime=${encodeURIComponent(end)}` +
    `&$select=subject,isOnlineMeeting,onlineMeeting,start` +
    `&$orderby=start/dateTime desc&$top=200`

  const payload = await graphGet<GraphEventsResponse>(endpoint)
  const events = payload.value || []

  const byJoinUrl = new Map<string, OrganizerMeetingOption>()
  for (const event of events) {
    const joinUrl = event.onlineMeeting?.joinUrl?.trim()
    if (!event.isOnlineMeeting || !joinUrl) continue

    const start = event.start?.dateTime || null
    const existing = byJoinUrl.get(joinUrl)
    if (!existing) {
      byJoinUrl.set(joinUrl, {
        subject: event.subject?.trim() || "(untitled meeting)",
        joinUrl,
        lastSeen: start,
      })
    } else if (start && (!existing.lastSeen || start > existing.lastSeen)) {
      existing.lastSeen = start
    }
  }

  return Array.from(byJoinUrl.values()).sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
}

/**
 * Confirm a join URL resolves to a real online meeting for the organizer.
 * Returns the onlineMeeting id when valid, or null when Graph finds nothing.
 */
export async function resolveOnlineMeetingId(organizerEmail: string, joinWebUrl: string): Promise<string | null> {
  const email = organizerEmail.trim()
  const url = joinWebUrl.trim()
  if (!email || !url) return null

  // The onlineMeetings API requires the user's object id (GUID), not the UPN.
  const user = await graphGet<{ id?: string }>(`/users/${encodeURIComponent(email)}?$select=id`)
  const userId = user.id
  if (!userId) return null

  // OData string literals escape single quotes by doubling them.
  const filter = `JoinWebUrl eq '${url.replace(/'/g, "''")}'`
  const endpoint = `/users/${encodeURIComponent(userId)}/onlineMeetings?$filter=${encodeURIComponent(filter)}`

  const payload = await graphGet<{ value?: Array<{ id?: string }> }>(endpoint)
  return payload.value?.[0]?.id || null
}
