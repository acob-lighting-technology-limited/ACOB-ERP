import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts"
import { Document, Packer, Paragraph, TextRun } from "npm:docx@8.5.0"
import { sendEmail } from "../_shared/email.ts"
import { EDGE_SENDERS } from "../_shared/senders.ts"
import { buildArtifactEmailHtml } from "../_shared/artifact-email.ts"
import {
  getCurrentOfficeWeek,
  getOfficeWeekFromDate,
  initOfficeYearAnchors,
  formatMeetingDateLabel,
  resolveEffectiveMeetingDateIso,
  toIsoDateString,
} from "../_shared/meeting-date.ts"
import {
  type AttendanceRecord,
  buildAttendanceCsv,
  getTranscriptVtt,
  isGraphConfigured,
  listAttendanceRecords,
  listAttendanceReports,
  listRecordings,
  listTranscripts,
  resolveOnlineMeetingId,
  resolveUserId,
} from "../_shared/graph-meetings.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const MATRIX_BASE_URL = (Deno.env.get("SITE_URL") || "https://matrix.acoblighting.com").replace(/\/$/, "")
const BUCKET = "meeting_documents"
// Max time to hold a freshly-imported artifact waiting for its sibling (attendance
// ↔ transcript) so the two land in one email. After this, send whatever is ready —
// a transcript may never arrive (unrecorded meetings), and attendance must not be
// trapped behind it.
const ARTIFACT_HOLD_MS = 2 * 60 * 60 * 1000
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/** Parse a WebVTT transcript into speaker turns, merging consecutive same-speaker cues. */
function parseVtt(vtt: string): Array<{ speaker: string; text: string }> {
  const turns: Array<{ speaker: string; text: string }> = []
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split("\n")
    const cueLines = lines.filter((l) => (l.includes("-->") ? false : !/^WEBVTT/i.test(l) && l.trim() !== ""))
    // Drop a lone numeric/uuid cue identifier line that precedes the timestamp.
    const textLines = cueLines.filter((l, i) => !(i === 0 && !/<v\s/i.test(l) && /^[\w-]+$/.test(l.trim())))
    const raw = textLines.join(" ").trim()
    if (!raw) continue
    const speakerMatch = raw.match(/<v\s+([^>]+)>/i)
    const speaker = speakerMatch ? speakerMatch[1].trim() : ""
    let text = raw
    let prev = ""
    while (text !== prev) {
      prev = text
      text = text.replace(/<[^>]*>/g, "")
    }
    text = text.trim()
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last && last.speaker === speaker) last.text += " " + text
    else turns.push({ speaker, text })
  }
  return turns
}

/** Build a readable DOCX (speaker + text) from a WebVTT transcript. */
async function vttToDocx(vtt: string, title: string): Promise<Uint8Array> {
  const turns = parseVtt(vtt)
  const paragraphs: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }),
    new Paragraph({ text: "" }),
  ]
  if (turns.length === 0) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: "(No transcript content)", italics: true })] }))
  }
  for (const turn of turns) {
    paragraphs.push(
      new Paragraph({
        children: [
          ...(turn.speaker ? [new TextRun({ text: `${turn.speaker}: `, bold: true })] : []),
          new TextRun({ text: turn.text }),
        ],
        spacing: { after: 120 },
      })
    )
  }
  const doc = new Document({ sections: [{ children: paragraphs }] })
  const buffer = await Packer.toBuffer(doc)
  return new Uint8Array(buffer)
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// deno-lint-ignore no-explicit-any
type Supa = any

type ArtifactType = "attendance" | "transcript"

type SourceRow = {
  id: string
  label: string
  join_web_url: string
  organizer_email: string
  recipients: string[]
  email_enabled: boolean
  is_active: boolean
  created_by: string | null
}

type NewArtifact = { type: ArtifactType; filename: string; base64: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function lagosToday(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function sanitizeSegment(value: string): string {
  return String(value || "file").replace(/[^a-zA-Z0-9._-]/g, "_")
}

async function storeArtifact(
  supabase: Supa,
  params: {
    source: SourceRow
    type: ArtifactType
    bytes: Uint8Array
    fileName: string
    mimeType: string
    week: number
    year: number
  }
): Promise<string> {
  const path = `${params.type}/${params.year}/W${params.week}/${sanitizeSegment(params.fileName)}`

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, params.bytes, {
    contentType: params.mimeType,
    upsert: true,
  })
  if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`)

  // Version any existing current row for this week/type, then insert the new one.
  const { data: currentRows } = await supabase
    .from("meeting_week_documents")
    .select("id, version_no")
    .eq("meeting_week", params.week)
    .eq("meeting_year", params.year)
    .eq("document_type", params.type)
    .eq("is_current", true)
    .is("department", null)
    .order("version_no", { ascending: false })

  const current = currentRows?.[0] || null
  const nextVersion = (current?.version_no || 0) + 1
  if (current?.id) {
    await supabase.from("meeting_week_documents").update({ is_current: false }).eq("id", current.id)
  }

  const { data: saved, error: saveError } = await supabase
    .from("meeting_week_documents")
    .insert({
      meeting_week: params.week,
      meeting_year: params.year,
      document_type: params.type,
      department: null,
      source_label: params.source.label,
      notes: `Auto-synced from Teams (${params.source.label})`,
      file_name: params.fileName,
      file_path: path,
      mime_type: params.mimeType,
      file_size: params.bytes.byteLength,
      version_no: nextVersion,
      is_current: true,
      uploaded_by: params.source.created_by,
    })
    .select("id")
    .single()

  if (saveError) throw new Error(`insert document failed: ${saveError.message}`)
  if (current?.id) {
    await supabase.from("meeting_week_documents").update({ replaced_by: saved.id }).eq("id", current.id)
  }
  return saved.id as string
}

async function notifyRecipients(supabase: Supa, recipients: string[], label: string) {
  try {
    const lowered = recipients.map((r) => r.toLowerCase())
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, company_email, additional_email")
      .or(`company_email.in.(${lowered.join(",")}),additional_email.in.(${lowered.join(",")})`)

    for (const profile of profiles || []) {
      const { error } = await supabase.from("notifications").insert({
        user_id: profile.id,
        type: "system",
        category: "reports",
        priority: "normal",
        title: "New meeting artifacts",
        message: `Attendance and/or transcript for "${label}" are now available.`,
        link_url: "/admin/reports/general-meeting/records",
      })
      if (error) console.error(`[sync-meeting-artifacts] notification failed: ${error.message}`)
    }
  } catch (err) {
    console.error(`[sync-meeting-artifacts] notify recipients failed: ${String(err)}`)
  }
}

/** Human-readable description of which artifact types an email actually carries. */
function artifactTypesLabel(types: ArtifactType[]): string {
  const hasAttendance = types.includes("attendance")
  const hasTranscript = types.includes("transcript")
  if (hasAttendance && hasTranscript) return "attendance & transcript"
  if (hasAttendance) return "attendance"
  return "transcript"
}

/** Download the current stored document(s) for an occurrence, as email attachments. */
async function loadOccurrenceAttachments(
  supabase: Supa,
  sourceLabel: string,
  week: number,
  year: number,
  types: ArtifactType[]
): Promise<Array<{ filename: string; content: string }>> {
  const attachments: Array<{ filename: string; content: string }> = []
  for (const type of types) {
    const { data } = await supabase
      .from("meeting_week_documents")
      .select("file_name, file_path")
      .eq("document_type", type)
      .eq("is_current", true)
      .eq("source_label", sourceLabel)
      .eq("meeting_week", week)
      .eq("meeting_year", year)
      .order("version_no", { ascending: false })
      .limit(1)
    const doc = data?.[0]
    if (!doc) continue
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(doc.file_path)
    if (error || !blob) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    attachments.push({ filename: doc.file_name, content: encodeBase64(bytes) })
  }
  return attachments
}

async function processSource(
  supabase: Supa,
  source: SourceRow
): Promise<{ id: string; label: string; imported: number; emailed: boolean; error?: string }> {
  const newArtifacts: NewArtifact[] = []
  let imported = 0

  try {
    // onlineMeetings APIs need the organizer's object id (GUID), not the UPN.
    const userId = await resolveUserId(source.organizer_email)
    if (!userId) throw new Error("organizer not found in directory")

    const meetingId = await resolveOnlineMeetingId(userId, source.join_web_url)
    if (!meetingId) throw new Error("online meeting could not be resolved from join URL")

    // If a recording exists, the email gets a "Download recording" link into the ERP
    // (the video is too large to attach). Best-effort: a missing recording permission
    // or no recording must not break the artifact sync.
    let recordingUrl: string | undefined
    try {
      const recordings = await listRecordings(userId, meetingId)
      if (recordings.length > 0) {
        recordingUrl = `${MATRIX_BASE_URL}/api/reports/meetings/recording?source_id=${encodeURIComponent(source.id)}&download=1`
      }
    } catch (recErr) {
      console.error(`[sync-meeting-artifacts] recording check failed for ${source.label}: ${String(recErr)}`)
    }

    // ── Attendance reports (merged per office week) ─────────────────────────────
    // Teams generates a separate report per meeting *session*, so one week can have
    // several (e.g. a 1-person early-join plus the real meeting). Group all reports
    // by office week and merge their participants, so the stored sheet reflects
    // everyone who attended rather than whichever session synced last.
    const reports = await listAttendanceReports(userId, meetingId)
    const reportsByWeek = new Map<string, { week: number; year: number; dateIso: string; reports: typeof reports }>()
    for (const report of reports) {
      const dateIso = toIsoDateString(
        report.meetingEndDateTime || report.meetingStartDateTime || new Date().toISOString()
      )
      const { week, year } = getOfficeWeekFromDate(new Date(dateIso))
      const key = `${year}-W${week}`
      const bucket = reportsByWeek.get(key) ?? { week, year, dateIso, reports: [] as typeof reports }
      if (dateIso > bucket.dateIso) bucket.dateIso = dateIso
      bucket.reports.push(report)
      reportsByWeek.set(key, bucket)
    }

    for (const [, grp] of reportsByWeek) {
      const reportIds = grp.reports.map((r) => r.id)
      const { data: seenRows } = await supabase
        .from("meeting_artifact_ledger")
        .select("artifact_graph_id")
        .eq("artifact_type", "attendance")
        .in("artifact_graph_id", reportIds)
      const seenIds = new Set((seenRows ?? []).map((r: { artifact_graph_id: string }) => r.artifact_graph_id))
      // Every session for this week already merged — nothing new to do.
      if (reportIds.every((id) => seenIds.has(id))) continue

      try {
        // Union participants across the week's sessions: dedupe by email keeping the
        // longest attendance; records without an email are all kept.
        const byEmail = new Map<string, { rec: AttendanceRecord; secs: number }>()
        const noEmail: AttendanceRecord[] = []
        for (const report of grp.reports) {
          const records = await listAttendanceRecords(userId, meetingId, report.id)
          for (const rec of records) {
            const email = (rec.emailAddress || "").trim().toLowerCase()
            const secs = rec.totalAttendanceInSeconds || 0
            if (!email) {
              noEmail.push(rec)
              continue
            }
            const existing = byEmail.get(email)
            if (!existing || secs > existing.secs) byEmail.set(email, { rec, secs })
          }
        }
        const merged = [...[...byEmail.values()].map((v) => v.rec), ...noEmail]

        const csv = buildAttendanceCsv(merged)
        const bytes = new TextEncoder().encode(csv)
        const fileName = `ACOB Attendance - ${formatMeetingDateLabel(grp.dateIso)} - W${grp.week}.csv`

        const documentId = await storeArtifact(supabase, {
          source,
          type: "attendance",
          bytes,
          fileName,
          mimeType: "text/csv",
          week: grp.week,
          year: grp.year,
        })

        // Ledger every session id in the week, all pointing at the merged doc.
        for (const id of reportIds) {
          if (seenIds.has(id)) continue
          await supabase
            .from("meeting_artifact_ledger")
            .insert({
              source_id: source.id,
              graph_online_meeting_id: meetingId,
              artifact_type: "attendance",
              artifact_graph_id: id,
              meeting_week: grp.week,
              meeting_year: grp.year,
              document_id: documentId,
            })
            .then(undefined, () => {})
        }

        newArtifacts.push({ type: "attendance", filename: fileName, base64: encodeBase64(bytes) })
        imported += 1
      } catch (artifactErr) {
        console.error(
          `[sync-meeting-artifacts] attendance week ${grp.year}-W${grp.week} failed: ${String(artifactErr)}`
        )
        // Stub the unseen sessions so a permanently-broken week isn't retried forever.
        for (const id of reportIds) {
          if (seenIds.has(id)) continue
          await supabase
            .from("meeting_artifact_ledger")
            .insert({
              source_id: source.id,
              graph_online_meeting_id: meetingId,
              artifact_type: "attendance",
              artifact_graph_id: id,
              document_id: null,
            })
            .then(undefined, () => {})
        }
      }
    }

    // ── Transcripts ────────────────────────────────────────────────────────────
    // Listing itself can fail tenant-wide (e.g. Graph transcript API access disabled),
    // which must not take down the rest of the run — attendance still has to reach the
    // hold-expiry fallback and get emailed on its own below.
    let transcripts: Awaited<ReturnType<typeof listTranscripts>> = []
    try {
      transcripts = await listTranscripts(userId, meetingId)
    } catch (listErr) {
      console.error(`[sync-meeting-artifacts] listTranscripts failed for ${source.label}: ${String(listErr)}`)
    }
    for (const transcript of transcripts) {
      const { data: seen } = await supabase
        .from("meeting_artifact_ledger")
        .select("id")
        .eq("artifact_type", "transcript")
        .eq("artifact_graph_id", transcript.id)
        .maybeSingle()
      if (seen) continue

      try {
        const vtt = await getTranscriptVtt(userId, meetingId, transcript.id)
        const dateIso = toIsoDateString(transcript.createdDateTime || new Date().toISOString())
        const { week, year } = getOfficeWeekFromDate(new Date(dateIso))
        const fileName = `ACOB Transcript - ${formatMeetingDateLabel(dateIso)} - W${week}.docx`
        const bytes = await vttToDocx(vtt, `${source.label} — Transcript — ${formatMeetingDateLabel(dateIso)}`)

        const documentId = await storeArtifact(supabase, {
          source,
          type: "transcript",
          bytes,
          fileName,
          mimeType: DOCX_MIME,
          week,
          year,
        })

        await supabase.from("meeting_artifact_ledger").insert({
          source_id: source.id,
          graph_online_meeting_id: meetingId,
          artifact_type: "transcript",
          artifact_graph_id: transcript.id,
          meeting_week: week,
          meeting_year: year,
          document_id: documentId,
        })

        newArtifacts.push({ type: "transcript", filename: fileName, base64: encodeBase64(bytes) })
        imported += 1
      } catch (artifactErr) {
        console.error(`[sync-meeting-artifacts] transcript ${transcript.id} failed: ${String(artifactErr)}`)
        await supabase
          .from("meeting_artifact_ledger")
          .insert({
            source_id: source.id,
            graph_online_meeting_id: meetingId,
            artifact_type: "transcript",
            artifact_graph_id: transcript.id,
            document_id: null,
          })
          .then(undefined, () => {})
      }
    }

    // ── Email (best-effort) + in-app notification parity ───────────────────────
    // Attendance and transcript become available from Graph at different times, so
    // hold a freshly-imported artifact until its sibling arrives (one combined
    // email) — but only up to ARTIFACT_HOLD_MS, after which send whatever is ready.
    let emailed = false
    if (source.email_enabled && source.recipients.length > 0) {
      try {
        // Every successfully-stored artifact for this source, so we can tell which
        // occurrences already have both types and which are still un-emailed.
        const { data: storedRows } = await supabase
          .from("meeting_artifact_ledger")
          .select("artifact_type, meeting_week, meeting_year, emailed_at, processed_at")
          .eq("source_id", source.id)
          .not("document_id", "is", null)

        const occKey = (week: number, year: number) => `${year}-W${week}`
        const typesPresent = new Map<string, Set<ArtifactType>>()
        const pendingByOcc = new Map<string, { week: number; year: number; types: Set<ArtifactType>; oldest: number }>()

        for (const row of (storedRows ?? []) as Array<{
          artifact_type: ArtifactType
          meeting_week: number | null
          meeting_year: number | null
          emailed_at: string | null
          processed_at: string
        }>) {
          if (row.meeting_week == null || row.meeting_year == null) continue
          const key = occKey(row.meeting_week, row.meeting_year)
          if (!typesPresent.has(key)) typesPresent.set(key, new Set())
          typesPresent.get(key)!.add(row.artifact_type)
          if (!row.emailed_at) {
            const bucket = pendingByOcc.get(key) ?? {
              week: row.meeting_week,
              year: row.meeting_year,
              types: new Set<ArtifactType>(),
              oldest: Infinity,
            }
            bucket.types.add(row.artifact_type)
            bucket.oldest = Math.min(bucket.oldest, new Date(row.processed_at).getTime())
            pendingByOcc.set(key, bucket)
          }
        }

        for (const [key, occ] of pendingByOcc) {
          const present = typesPresent.get(key) ?? new Set<ArtifactType>()
          const hasBoth = present.has("attendance") && present.has("transcript")
          const aged = Date.now() - occ.oldest >= ARTIFACT_HOLD_MS
          // Wait for the sibling artifact unless the hold window has elapsed.
          if (!hasBoth && !aged) continue

          const typesToSend = (["attendance", "transcript"] as ArtifactType[]).filter((t) => occ.types.has(t))
          const attachments = await loadOccurrenceAttachments(supabase, source.label, occ.week, occ.year, typesToSend)
          if (attachments.length === 0) continue

          const label = artifactTypesLabel(typesToSend)
          const results: Array<{ to: string; success: boolean; emailId?: string; error?: string }> = []
          for (const [index, to] of source.recipients.entries()) {
            try {
              const data = await sendEmail({
                to,
                from: EDGE_SENDERS.meeting,
                subject: `${source.label} — ${label}`,
                html: buildArtifactEmailHtml({
                  meetingLabel: source.label,
                  files: attachments.map((a) => a.filename),
                  intro: `The ${label} for the <strong>${source.label}</strong> ${
                    attachments.length > 1 ? "are" : "is"
                  } attached.`,
                  recordingUrl,
                }),
                attachments,
                traceLabel: `meeting-artifacts:${occ.year}W${occ.week}:${index + 1}/${source.recipients.length}:${to}`,
              })
              results.push({ to, success: true, emailId: data.id })
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              console.error(`[sync-meeting-artifacts] Failed to send to ${to}:`, errMsg)
              results.push({ to, success: false, error: errMsg })
            }
          }

          if (results.some((r) => r.success)) {
            emailed = true
            // Mark only the types actually sent for this occurrence as emailed.
            await supabase
              .from("meeting_artifact_ledger")
              .update({ emailed_at: new Date().toISOString() })
              .eq("source_id", source.id)
              .eq("meeting_week", occ.week)
              .eq("meeting_year", occ.year)
              .is("emailed_at", null)
              .in("artifact_type", typesToSend)
            await notifyRecipients(supabase, source.recipients, source.label)
          }
        }
      } catch (mailErr) {
        console.error(`[sync-meeting-artifacts] email failed: ${String(mailErr)}`)
      }
    }
    if (newArtifacts.length > 0) {
      console.log(`[sync-meeting-artifacts] ${source.label}: imported ${newArtifacts.length} new artifact(s)`)
    }

    await supabase
      .from("meeting_artifact_sources")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", source.id)

    return { id: source.id, label: source.label, imported, emailed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from("meeting_artifact_sources")
      .update({ last_synced_at: new Date().toISOString(), last_error: message })
      .eq("id", source.id)
    return { id: source.id, label: source.label, imported, emailed: false, error: message }
  }
}

type SendParams = {
  sourceId: string
  occurrence: "latest" | { week: number; year: number }
  includeAttendance: boolean
  includeTranscript: boolean
}

/** Manually email already-stored artifacts (a chosen occurrence, or the latest). */
async function sendStoredArtifacts(
  supabase: Supa,
  params: SendParams
): Promise<{ sent: boolean; files?: string[]; to?: string[]; reason?: string }> {
  const { data: source } = await supabase
    .from("meeting_artifact_sources")
    .select("id, label, recipients, organizer_email, join_web_url")
    .eq("id", params.sourceId)
    .maybeSingle()
  if (!source) return { sent: false, reason: "source not found" }

  const recipients: string[] = source.recipients || []
  if (recipients.length === 0) return { sent: false, reason: "no recipients configured" }

  const types: ArtifactType[] = []
  if (params.includeAttendance) types.push("attendance")
  if (params.includeTranscript) types.push("transcript")
  if (types.length === 0) return { sent: false, reason: "nothing selected" }

  const attachments: Array<{ filename: string; content: string }> = []
  for (const type of types) {
    let q = supabase
      .from("meeting_week_documents")
      .select("file_name, file_path")
      .eq("document_type", type)
      .eq("is_current", true)
      .eq("source_label", source.label)
    if (params.occurrence !== "latest") {
      q = q.eq("meeting_week", params.occurrence.week).eq("meeting_year", params.occurrence.year)
    }
    q = q.order("meeting_year", { ascending: false }).order("meeting_week", { ascending: false }).limit(1)
    const { data } = await q
    const doc = data?.[0]
    if (!doc) continue
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(doc.file_path)
    if (error || !blob) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    attachments.push({ filename: doc.file_name, content: encodeBase64(bytes) })
  }
  if (attachments.length === 0) return { sent: false, reason: "no matching documents found" }

  // Add the "Download recording" link when a recording exists (best-effort).
  let recordingUrl: string | undefined
  if (source.organizer_email && source.join_web_url) {
    try {
      const userId = await resolveUserId(source.organizer_email)
      const meetingId = userId ? await resolveOnlineMeetingId(userId, source.join_web_url) : null
      if (userId && meetingId && (await listRecordings(userId, meetingId)).length > 0) {
        recordingUrl = `${MATRIX_BASE_URL}/api/reports/meetings/recording?source_id=${encodeURIComponent(source.id)}&download=1`
      }
    } catch (recErr) {
      console.error(`[sync-meeting-artifacts] manual recording check failed: ${String(recErr)}`)
    }
  }

  const results: Array<{ to: string; success: boolean; emailId?: string; error?: string }> = []
  for (const [index, to] of recipients.entries()) {
    try {
      const data = await sendEmail({
        to,
        from: EDGE_SENDERS.meeting,
        subject: `${source.label} — ${artifactTypesLabel(types)}`,
        html: buildArtifactEmailHtml({
          meetingLabel: source.label,
          files: attachments.map((a) => a.filename),
          recordingUrl,
        }),
        attachments,
        traceLabel: `meeting-artifacts-manual:${index + 1}/${recipients.length}:${to}`,
      })
      results.push({ to, success: true, emailId: data.id })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[sync-meeting-artifacts] Manual send failed for ${to}:`, errMsg)
      results.push({ to, success: false, error: errMsg })
    }
  }
  await notifyRecipients(supabase, recipients, source.label)
  return { sent: results.some((r) => r.success), files: attachments.map((a) => a.filename), to: recipients }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      // empty body from cron is expected
    }

    // Manual send of already-stored artifacts (no Graph / meeting-day gate).
    if (body?.send) {
      const s = body.send as Partial<SendParams>
      if (!s?.sourceId) return json({ error: "sourceId is required" }, 400)
      const result = await sendStoredArtifacts(supabase, {
        sourceId: s.sourceId,
        occurrence: s.occurrence || "latest",
        includeAttendance: s.includeAttendance !== false,
        includeTranscript: s.includeTranscript !== false,
      })
      return json({ mode: "send", ...result })
    }

    if (!isGraphConfigured()) return json({ error: "Microsoft Graph is not configured" }, 503)

    await initOfficeYearAnchors(supabase)

    const force = Boolean(body?.force)

    // Self-gate: only act on the ERP effective meeting date (unless forced).
    const { week, year } = getCurrentOfficeWeek()
    const effectiveDate = await resolveEffectiveMeetingDateIso(supabase, week, year)
    const today = lagosToday()
    if (!force && effectiveDate !== today) {
      return json({ skipped: true, reason: "not meeting day", effectiveDate, today })
    }

    const { data: sources, error } = await supabase
      .from("meeting_artifact_sources")
      .select("id, label, join_web_url, organizer_email, recipients, email_enabled, is_active, created_by")
      .eq("is_active", true)

    if (error) return json({ error: error.message }, 500)

    const results = []
    for (const source of (sources || []) as SourceRow[]) {
      results.push(await processSource(supabase, source))
    }

    return json({ processed: results.length, effectiveDate, today, results })
  } catch (err) {
    console.error(`[sync-meeting-artifacts] fatal: ${String(err)}`)
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500)
  }
})
