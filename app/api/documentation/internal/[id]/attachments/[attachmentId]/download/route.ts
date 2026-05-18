import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { Buffer } from "node:buffer"
import { getOneDriveService } from "@/lib/onedrive"
import type { DocumentationAttachment } from "@/lib/documentation/sharepoint"

type UserDocumentationRow = {
  id: string
  user_id: string
  sharepoint_attachments: DocumentationAttachment[] | null
}

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
          // Ignore errors
        }
      },
    },
  })
}

export async function GET(_request: Request, props: { params: Promise<{ id: string; attachmentId: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: doc, error } = await supabase
      .from("user_documentation")
      .select("id, user_id, sharepoint_attachments")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (error || !doc) {
      return NextResponse.json({ error: "Documentation not found" }, { status: 404 })
    }

    const attachment = ((doc as UserDocumentationRow).sharepoint_attachments || []).find(
      (item) => item.id === params.attachmentId
    )

    if (!attachment?.file_path) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
    }

    const onedrive = getOneDriveService()
    if (!onedrive.isEnabled()) {
      return NextResponse.json({ error: "SharePoint integration is not configured" }, { status: 500 })
    }

    const downloadUrl = await onedrive.getDownloadUrl(attachment.file_path)
    const upstream = await fetch(downloadUrl)

    if (!upstream.ok) {
      return NextResponse.json({ error: "Failed to download attachment" }, { status: 502 })
    }

    return new NextResponse(Buffer.from(await upstream.arrayBuffer()), {
      headers: {
        "Content-Type": attachment.mime_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${attachment.name.replace(/["\r\n\\]/g, "")}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download attachment"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
