import type { SupabaseClient } from "@supabase/supabase-js"
import { toLocalISODate } from "@/lib/utils/date"

/**
 * "Stop" an exemption without erasing history.
 *
 * Exemption is DERIVED at render time from `profiles.attendance_exempt` (an open,
 * going-forward flag) plus dated rows in `attendance_exempt_periods`. Because it is
 * derived, simply clearing the flag would retroactively un-exempt every past day the
 * person was exempt. That is the opposite of what "stop" should mean.
 *
 * This freezes the exemption AT TODAY:
 *  - an open infinite exemption (the flag) is converted into a closed
 *    [start .. today] period so past days stay exempt when re-derived,
 *  - future-dated periods are dropped,
 *  - periods straddling today are truncated to end today,
 *  - fully-past periods are left untouched.
 *
 * The flag is cleared so no new days become exempt going forward.
 */
export async function freezeExemptionAtToday(
  dataClient: SupabaseClient,
  userId: string,
  actorId: string | null
): Promise<void> {
  const today = toLocalISODate()

  const { data: current } = await dataClient
    .from("profiles")
    .select("attendance_exempt, attendance_exempt_reason, attendance_exempt_set_at")
    .eq("id", userId)
    .maybeSingle()

  // Clear the going-forward flag first.
  const { error: offErr } = await dataClient
    .from("profiles")
    .update({ attendance_exempt: false, attendance_exempt_until: null })
    .eq("id", userId)
  if (offErr) {
    // Backward-compat: environments missing the audit column still clear the flag.
    await dataClient.from("profiles").update({ attendance_exempt: false }).eq("id", userId)
  }

  // Preserve the history of an open infinite exemption as a closed window.
  if (current?.attendance_exempt) {
    const startIso = current.attendance_exempt_set_at
      ? toLocalISODate(new Date(current.attendance_exempt_set_at))
      : today
    const frozenStart = startIso > today ? today : startIso
    await insertExemptPeriod(dataClient, {
      user_id: userId,
      start_date: frozenStart,
      end_date: today,
      kind: "infinite",
      reason: current.attendance_exempt_reason || null,
      created_by: actorId ?? undefined,
    })
  }

  // Drop future-dated windows (they never started).
  await dataClient.from("attendance_exempt_periods").delete().eq("user_id", userId).gt("start_date", today)

  // Truncate windows that straddle today so they end today.
  const { data: straddling } = await dataClient
    .from("attendance_exempt_periods")
    .select("id")
    .eq("user_id", userId)
    .lte("start_date", today)
    .gt("end_date", today)
  for (const p of (straddling ?? []) as Array<{ id: string }>) {
    await dataClient.from("attendance_exempt_periods").update({ end_date: today }).eq("id", p.id)
  }
}

/**
 * Insert an exemption period, tolerating environments where the `kind` CHECK has not
 * yet been widened to include the requested kind (falls back to the legacy 'monthly').
 */
export async function insertExemptPeriod(
  dataClient: SupabaseClient,
  row: {
    user_id: string
    start_date: string
    end_date: string
    kind: "weekly" | "monthly" | "period" | "infinite"
    reason?: string | null
    created_by?: string
  }
): Promise<{ error: { message?: string } | null }> {
  const { error } = await dataClient.from("attendance_exempt_periods").insert(row)
  if (!error) return { error: null }
  // Legacy CHECK only allowed weekly|monthly — persist as monthly so history is not lost.
  const legacyKind = row.kind === "weekly" ? "weekly" : "monthly"
  const { error: fallbackError } = await dataClient
    .from("attendance_exempt_periods")
    .insert({ ...row, kind: legacyKind })
  return { error: fallbackError ?? null }
}
