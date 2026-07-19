// App-only Microsoft Graph helpers for pulling Teams meeting artifacts.
// Deno runtime (edge function) — cannot import from the Next.js `lib/`, so the
// client-credentials token logic is duplicated minimally here.

const AZURE_TENANT_ID = Deno.env.get("AZURE_TENANT_ID") || ""
const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID") || ""
const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET") || ""

let cachedToken: { token: string; expiresAt: number } | null = null

export function isGraphConfigured(): boolean {
  return Boolean(AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET)
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  if (!isGraphConfigured()) throw new Error("Microsoft Graph is not configured (AZURE_* secrets missing)")

  const res = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: AZURE_CLIENT_ID,
      client_secret: AZURE_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }).toString(),
  })
  if (!res.ok) throw new Error(`Graph token error: ${await res.text()}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

async function graphGet<T>(endpoint: string): Promise<T> {
  const token = await getToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })
  if (!res.ok) throw new Error(`Graph GET ${endpoint} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function graphGetText(endpoint: string): Promise<string> {
  const token = await getToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Graph GET(text) ${endpoint} → ${res.status}: ${await res.text()}`)
  return res.text()
}

export type AttendanceRecord = {
  emailAddress?: string | null
  totalAttendanceInSeconds?: number | null
  role?: string | null
  identity?: { displayName?: string | null } | null
  attendanceIntervals?: Array<{ joinDateTime?: string; leaveDateTime?: string }> | null
}

export type AttendanceReport = {
  id: string
  totalParticipantCount?: number | null
  meetingStartDateTime?: string | null
  meetingEndDateTime?: string | null
}

export type TranscriptRef = {
  id: string
  createdDateTime?: string | null
}

/**
 * Resolve a user's directory object id (GUID) from their email/UPN.
 * The onlineMeetings API requires the GUID in the URL, not the UPN.
 */
export async function resolveUserId(email: string): Promise<string | null> {
  const payload = await graphGet<{ id?: string }>(`/users/${encodeURIComponent(email)}?$select=id`)
  return payload.id || null
}

/** Resolve the onlineMeeting id for a join URL. `userId` must be a GUID. */
export async function resolveOnlineMeetingId(userId: string, joinWebUrl: string): Promise<string | null> {
  const filter = `JoinWebUrl eq '${joinWebUrl.replace(/'/g, "''")}'`
  const payload = await graphGet<{ value?: Array<{ id?: string }> }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings?$filter=${encodeURIComponent(filter)}`
  )
  return payload.value?.[0]?.id || null
}

export async function listAttendanceReports(userId: string, meetingId: string): Promise<AttendanceReport[]> {
  const payload = await graphGet<{ value?: AttendanceReport[] }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/attendanceReports`
  )
  return payload.value || []
}

export async function listAttendanceRecords(
  userId: string,
  meetingId: string,
  reportId: string
): Promise<AttendanceRecord[]> {
  const payload = await graphGet<{ value?: AttendanceRecord[] }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/attendanceReports/${reportId}/attendanceRecords`
  )
  return payload.value || []
}

export type RecordingRef = {
  id: string
  createdDateTime?: string | null
}

/** List recordings for an online meeting. Requires OnlineMeetingRecording.Read.All. */
export async function listRecordings(userId: string, meetingId: string): Promise<RecordingRef[]> {
  const payload = await graphGet<{ value?: RecordingRef[] }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/recordings`
  )
  return payload.value || []
}

export async function listTranscripts(userId: string, meetingId: string): Promise<TranscriptRef[]> {
  const payload = await graphGet<{ value?: TranscriptRef[] }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/transcripts`
  )
  return payload.value || []
}

export async function getTranscriptVtt(userId: string, meetingId: string, transcriptId: string): Promise<string> {
  return graphGetText(
    `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content?$format=text/vtt`
  )
}

function csvEscape(value: string): string {
  const v = value ?? ""
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function secondsToHuman(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h ? `${h}h` : "", m ? `${m}m` : "", `${s}s`].filter(Boolean).join(" ")
}

/** Build an attendance CSV mirroring the Teams export shape. */
export function buildAttendanceCsv(records: AttendanceRecord[]): string {
  const header = ["Name", "Email", "In-Meeting Duration", "Role", "First Join", "Last Leave"]
  const lines = [header.join(",")]
  for (const rec of records) {
    const intervals = rec.attendanceIntervals || []
    const firstJoin = intervals.length ? intervals[intervals.length - 1].joinDateTime || "" : ""
    const lastLeave = intervals.length ? intervals[0].leaveDateTime || "" : ""
    lines.push(
      [
        csvEscape(rec.identity?.displayName || ""),
        csvEscape(rec.emailAddress || ""),
        csvEscape(secondsToHuman(rec.totalAttendanceInSeconds || 0)),
        csvEscape(rec.role || ""),
        csvEscape(firstJoin),
        csvEscape(lastLeave),
      ].join(",")
    )
  }
  return lines.join("\n")
}
