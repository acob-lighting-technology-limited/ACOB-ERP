import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { buildAvatarStoragePath, getAvatarSignedUrl, PROFILE_PHOTOS_BUCKET } from "@/lib/profile-photos"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("profile-avatar")

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`profile-avatar:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const extension = ALLOWED_MIME_TO_EXT[file.type]
  if (!extension) {
    return NextResponse.json({ error: "Unsupported file type. Use JPEG, PNG, or WebP." }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File is too large. Maximum size is 5MB." }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const avatarPath = buildAvatarStoragePath(user.id, extension)

  const { error: uploadError } = await dataClient.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .upload(avatarPath, file, { upsert: true, contentType: file.type })

  if (uploadError) {
    log.error({ err: String(uploadError) }, "Failed to upload profile photo")
    return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 })
  }

  const { error: updateError } = await dataClient.from("profiles").update({ avatar_path: avatarPath }).eq("id", user.id)

  if (updateError) {
    log.error({ err: String(updateError) }, "Failed to save avatar_path")
    return NextResponse.json({ error: "Failed to save photo" }, { status: 500 })
  }

  const signedUrl = await getAvatarSignedUrl(dataClient, avatarPath)

  return NextResponse.json({ data: { avatarUrl: signedUrl } })
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: profile } = await dataClient.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle()

  const signedUrl = profile?.avatar_path ? await getAvatarSignedUrl(dataClient, profile.avatar_path) : null

  return NextResponse.json({ data: { avatarUrl: signedUrl } })
}

export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)

  const { data: profile } = await dataClient.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle()

  if (profile?.avatar_path) {
    await dataClient.storage.from(PROFILE_PHOTOS_BUCKET).remove([profile.avatar_path])
  }

  const { error: updateError } = await dataClient.from("profiles").update({ avatar_path: null }).eq("id", user.id)

  if (updateError) {
    log.error({ err: String(updateError) }, "Failed to clear avatar_path")
    return NextResponse.json({ error: "Failed to remove photo" }, { status: 500 })
  }

  return NextResponse.json({ data: { ok: true } })
}
