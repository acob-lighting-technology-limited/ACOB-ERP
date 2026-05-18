import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { Buffer } from "node:buffer"
import { getOneDriveService } from "@/lib/onedrive"
import { getDepartmentScope, normalizeDepartmentName, resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { isOneDrivePaymentDocumentPath } from "@/lib/payments/document-storage"

type PaymentsClient = Awaited<ReturnType<typeof createClient>>

type DepartmentRelation = { name?: string | null } | Array<{ name?: string | null }> | null

type PaymentDepartmentRecord = {
  department?: DepartmentRelation
  created_by?: string | null
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

function normalizeDepartment(value: string | null | undefined): string {
  return normalizeDepartmentName(String(value || "").trim()).toLowerCase()
}

function isFinanceDepartment(value: string | null | undefined): boolean {
  return normalizeDepartment(value) === "accounts"
}

async function assertPaymentAccess(supabase: PaymentsClient, userId: string, paymentId: string) {
  const scope = await resolveAdminScope(supabase, userId)
  const { data: profile } = await supabase.from("profiles").select("department").eq("id", userId).single()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const { data: payment } = await dataClient
    .from("department_payments")
    .select("department:departments(name), created_by")
    .eq("id", paymentId)
    .single()

  const relation = (payment as PaymentDepartmentRecord | null)?.department
  const paymentDepartment = Array.isArray(relation) ? relation[0]?.name : relation?.name

  if (!paymentDepartment) {
    return { allowed: false as const, status: 404, error: "Payment not found" }
  }

  if ((payment as PaymentDepartmentRecord | null)?.created_by === userId) {
    return { allowed: true as const }
  }

  if (scope) {
    const scopedDepartments = getDepartmentScope(scope, "general")
    if (scopedDepartments) {
      const inScope = scopedDepartments.some(
        (dept) => normalizeDepartment(dept) === normalizeDepartment(paymentDepartment)
      )
      if (!inScope) {
        return { allowed: false as const, status: 403, error: "Forbidden: outside your finance scope" }
      }
    }
    return { allowed: true as const }
  }

  if (!isFinanceDepartment(profile?.department)) {
    return { allowed: false as const, status: 403, error: "Forbidden: finance access required" }
  }

  if (normalizeDepartment(profile?.department) !== normalizeDepartment(paymentDepartment)) {
    return { allowed: false as const, status: 403, error: "Forbidden: Department mismatch" }
  }

  return { allowed: true as const }
}

function dedupePdfExtension(fileName: string): string {
  const trimmed = fileName.trim()
  return trimmed.toLowerCase().endsWith(".pdf.pdf") ? trimmed.slice(0, -4) : trimmed
}

function safeDispositionFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, "")
}

export async function GET(_request: Request, props: { params: Promise<{ id: string; documentId: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const access = await assertPaymentAccess(supabase, user.id, params.id)
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const { data: document, error } = await dataClient
      .from("payment_documents")
      .select("id, payment_id, file_path, file_name, mime_type")
      .eq("id", params.documentId)
      .eq("payment_id", params.id)
      .maybeSingle()

    if (error || !document?.file_path) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const fileName = dedupePdfExtension(String(document.file_name || "payment-document.pdf"))
    const mimeType = String(document.mime_type || "application/pdf")

    if (isOneDrivePaymentDocumentPath(document.file_path)) {
      const onedrive = getOneDriveService()
      if (!onedrive.isEnabled()) {
        return NextResponse.json({ error: "SharePoint integration is not configured" }, { status: 500 })
      }

      const downloadUrl = await onedrive.getDownloadUrl(document.file_path)
      const upstream = await fetch(downloadUrl)
      if (!upstream.ok) {
        return NextResponse.json({ error: "Failed to download document" }, { status: 502 })
      }

      return new NextResponse(Buffer.from(await upstream.arrayBuffer()), {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${safeDispositionFilename(fileName)}"`,
        },
      })
    }

    const { data: signed, error: signedError } = await dataClient.storage
      .from("payment_documents")
      .createSignedUrl(document.file_path, 3600)

    if (signedError || !signed?.signedUrl) {
      return NextResponse.json(
        { error: signedError?.message || "Failed to prepare document download" },
        { status: 500 }
      )
    }

    const upstream = await fetch(signed.signedUrl)
    if (!upstream.ok) {
      return NextResponse.json({ error: "Failed to download document" }, { status: 502 })
    }

    return new NextResponse(Buffer.from(await upstream.arrayBuffer()), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${safeDispositionFilename(fileName)}"`,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
