import type { SupabaseClient } from "@supabase/supabase-js"

export const PROFILE_PHOTOS_BUCKET = "profile_photos"
const SIGNED_URL_TTL_SECONDS = 3600

export function buildAvatarStoragePath(userId: string, extension: string): string {
  return `${userId}/avatar.${extension}`
}

/** Signed URL for a single avatar path. Returns null if the path is missing or signing fails. */
export async function getAvatarSignedUrl(
  dataClient: SupabaseClient,
  avatarPath: string | null | undefined
): Promise<string | null> {
  if (!avatarPath) return null
  const { data } = await dataClient.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .createSignedUrl(avatarPath, SIGNED_URL_TTL_SECONDS)
  return data?.signedUrl ?? null
}

/**
 * Batch signed URLs for multiple avatar paths — use this instead of calling
 * getAvatarSignedUrl in a loop (e.g. the birthday page, directory listings).
 * Returns a map of avatarPath -> signedUrl; missing/failed paths are omitted.
 */
export async function getAvatarSignedUrls(
  dataClient: SupabaseClient,
  avatarPaths: string[]
): Promise<Map<string, string>> {
  const uniquePaths = Array.from(new Set(avatarPaths.filter(Boolean)))
  if (uniquePaths.length === 0) return new Map()

  const { data } = await dataClient.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS)

  const map = new Map<string, string>()
  for (const entry of data || []) {
    if (entry.path && entry.signedUrl && !entry.error) {
      map.set(entry.path, entry.signedUrl)
    }
  }
  return map
}
