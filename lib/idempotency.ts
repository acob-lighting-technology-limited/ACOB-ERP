import { type SupabaseClient } from "@supabase/supabase-js"

const IDEMPOTENCY_TTL_HOURS = 24

export async function checkIdempotency(
  supabase: SupabaseClient,
  key: string
): Promise<{ isDuplicate: boolean; cachedResponse?: unknown }> {
  if (!key) return { isDuplicate: false }

  const nowIso = new Date().toISOString()
  const { data } = await supabase
    .from("idempotency_keys")
    .select("response_body, created_at")
    .eq("key", key)
    .gt("expires_at", nowIso)
    .single()

  if (data) {
    const createdAt = new Date(data.created_at)
    const now = new Date()
    const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

    if (hoursDiff < IDEMPOTENCY_TTL_HOURS) {
      return { isDuplicate: true, cachedResponse: data.response_body }
    }
  }

  return { isDuplicate: false }
}

export async function storeIdempotencyKey(supabase: SupabaseClient, key: string, responseBody: unknown): Promise<void> {
  if (!key) return

  await supabase
    .from("idempotency_keys")
    .upsert({
      key,
      response_body: responseBody,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
}

export function getIdempotencyKey(req: Request): string | null {
  return req.headers.get("idempotency-key")
}
