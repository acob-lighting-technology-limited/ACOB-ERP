import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getOneDriveService } from "@/lib/onedrive"
import { logger } from "@/lib/logger"

const log = logger("admin-remote-access-user")
export const dynamic = "force-dynamic"

const ToggleSchema = z.object({
  remote_checkin_enabled: z.boolean(),
})

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-remote-access-user:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = String(profile?.role || "")
  if (!["developer", "admin", "super_admin"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { supabase, actorId: user.id }
}

/**
 * PATCH /api/admin/hr/attendance/remote-access/[userId]
 * Toggle remote_checkin_enabled for an employee.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const { userId } = await params
  const parsed = ToggleSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { error } = await dataClient
    .from("profiles")
    .update({ remote_checkin_enabled: parsed.data.remote_checkin_enabled })
    .eq("id", userId)

  if (error) {
    log.error({ err: String(error) }, "Failed to update remote_checkin_enabled")
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }

  await writeAuditLog(
    auth.supabase,
    {
      action: "update",
      entityType: "profile",
      entityId: userId,
      newValues: { remote_checkin_enabled: parsed.data.remote_checkin_enabled },
      context: {
        actorId: auth.actorId,
        source: "api",
        route: `/api/admin/hr/attendance/remote-access/${userId}`,
      },
    },
    { failOpen: true }
  )

  return NextResponse.json({ message: "Updated" })
}

/**
 * POST /api/admin/hr/attendance/remote-access/[userId]
 * Upload / replace a reference face photo for an employee.
 * Accepts multipart/form-data with a `photo` file field.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const { userId } = await params

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const photoFile = formData.get("photo")
  if (!photoFile || !(photoFile instanceof File)) {
    return NextResponse.json({ error: "Photo file is required" }, { status: 400 })
  }

  const allowed = ["image/jpeg", "image/png", "image/webp"]
  if (!allowed.includes(photoFile.type)) {
    return NextResponse.json({ error: "Photo must be a JPEG, PNG, or WebP image" }, { status: 400 })
  }

  const photoBuffer = Buffer.from(await photoFile.arrayBuffer())

  // Upload to OneDrive
  let faceReferenceUrl: string
  try {
    const od = getOneDriveService()
    const ext = photoFile.type === "image/png" ? "png" : photoFile.type === "image/webp" ? "webp" : "jpg"
    const filePath = `/attendance/face-references/${userId}.${ext}`
    const result = await od.uploadFile(filePath, photoBuffer, photoFile.type)
    faceReferenceUrl = (result as { webUrl?: string }).webUrl ?? ""
    if (!faceReferenceUrl) throw new Error("No URL returned from OneDrive")
  } catch (odErr) {
    log.error({ err: String(odErr) }, "Failed to upload face reference to OneDrive")
    return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { error: updateError } = await dataClient
    .from("profiles")
    .update({ face_reference_url: faceReferenceUrl })
    .eq("id", userId)

  if (updateError) {
    log.error({ err: String(updateError) }, "Failed to save face_reference_url")
    return NextResponse.json({ error: "Failed to save reference URL" }, { status: 500 })
  }

  await writeAuditLog(
    auth.supabase,
    {
      action: "update",
      entityType: "profile",
      entityId: userId,
      newValues: { face_reference_url: "[uploaded]" },
      context: {
        actorId: auth.actorId,
        source: "api",
        route: `/api/admin/hr/attendance/remote-access/${userId}`,
      },
    },
    { failOpen: true }
  )

  return NextResponse.json({ message: "Reference photo updated", face_reference_url: faceReferenceUrl })
}

/**
 * DELETE /api/admin/hr/attendance/remote-access/[userId]
 * Remove a reference face photo.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const { userId } = await params
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)

  const { error } = await dataClient.from("profiles").update({ face_reference_url: null }).eq("id", userId)

  if (error) {
    return NextResponse.json({ error: "Failed to remove reference photo" }, { status: 500 })
  }

  return NextResponse.json({ message: "Reference photo removed" })
}
