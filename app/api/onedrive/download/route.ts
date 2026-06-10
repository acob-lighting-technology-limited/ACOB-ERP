/**
 * OneDrive Download API Route
 * Provides download URLs for OneDrive files
 */

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getOneDriveService } from "@/lib/onedrive"
import { isPathAllowed, resolveOneDriveAccessScope, resolveOneDriveDepartmentAccessScope } from "@/lib/onedrive/access"
import { logger } from "@/lib/logger"

const log = logger("onedrive-download")

export const dynamic = "force-dynamic"

type OneDriveClient = Awaited<ReturnType<typeof createClient>>

async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Ignore
        }
      },
    },
  })
}

/**
 * GET /api/onedrive/download
 * Get download URL for a file
 * Query params:
 *   - path: File path in OneDrive
 *   - redirect: If "true", redirect to download URL instead of returning JSON
 *   - raw: If "true", stream file bytes through this API (same-origin download)
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const accessMode = searchParams.get("accessMode")
    const department = searchParams.get("department")
    const scope = department
      ? await resolveOneDriveDepartmentAccessScope(supabase as OneDriveClient, user.id, department)
      : await resolveOneDriveAccessScope(
          supabase as OneDriveClient,
          user.id,
          accessMode === "admin"
            ? { allowAdminLike: true, allowManagedDepartments: true }
            : { allowAdminLike: false, allowManagedDepartments: false }
        )
    if (!scope) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const onedrive = getOneDriveService()

    if (!onedrive.isEnabled()) {
      return NextResponse.json({ error: "OneDrive integration is not configured" }, { status: 503 })
    }

    const path = searchParams.get("path")
    const redirect = searchParams.get("redirect") === "true"
    const raw = searchParams.get("raw") === "true"

    if (!path) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 })
    }

    if (!isPathAllowed(path, scope) || path === "/") {
      return NextResponse.json({ error: "Forbidden: outside your allowed department libraries" }, { status: 403 })
    }

    const downloadUrl = await onedrive.getDownloadUrl(path)

    if (raw) {
      const upstream = await fetch(downloadUrl)
      if (!upstream.ok) {
        return NextResponse.json({ error: "Failed to stream file from OneDrive" }, { status: 502 })
      }

      const arrayBuffer = await upstream.arrayBuffer()
      const fileName = decodeURIComponent(path.split("/").filter(Boolean).pop() || "download")
      const contentType = upstream.headers.get("content-type") || "application/octet-stream"

      return new NextResponse(arrayBuffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${fileName.replace(/["\r\n\\]/g, "")}"`,
          "Cache-Control": "no-store",
        },
      })
    }

    if (redirect) {
      return NextResponse.redirect(downloadUrl)
    }

    return NextResponse.json({ data: { downloadUrl } })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error getting download URL:")
    const message = error instanceof Error ? error.message : "Failed to get download URL"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
