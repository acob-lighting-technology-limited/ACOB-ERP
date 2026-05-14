import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getOneDriveService } from "@/lib/onedrive"
import { logger } from "@/lib/logger"
import { getDepartmentScope, resolveAdminScope, normalizeDepartmentName } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { buildPaymentDocumentFolderPathByType, buildPaymentDocumentPath } from "@/lib/payments/document-storage"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("payments-documents")

type PaymentsClient = Awaited<ReturnType<typeof createClient>>

type DepartmentRelation = { name?: string | null } | Array<{ name?: string | null }> | null

type PaymentDepartmentRecord = {
  department?: DepartmentRelation
  created_by?: string | null
  id?: string
  title?: string | null
  payment_type?: "one-time" | "recurring" | null
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

function getPaymentDepartmentName(payment: PaymentDepartmentRecord | null | undefined): string | null {
  const relation = payment?.department
  if (!relation) return null
  if (Array.isArray(relation)) return relation[0]?.name ?? null
  return relation.name ?? null
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

// GET /api/payments/[id]/documents - List all documents for a payment
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const { id: paymentId } = params
    const { searchParams } = new URL(request.url)
    const includeArchived = searchParams.get("includeArchived") === "true"

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const access = await assertPaymentAccess(supabase, user.id, paymentId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    let query = supabase
      .from("payment_documents")
      .select("*")
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: false })

    if (!includeArchived) {
      query = query.eq("is_archived", false)
    }

    const { data: documents, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: documents })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/payments/[id]/documents - Upload a new document (with optional replacement)
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`payments-documents:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { id: paymentId } = params

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const access = await assertPaymentAccess(supabase, user.id, paymentId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File
    const documentType = formData.get("document_type") as string
    const applicableDate = (formData.get("applicable_date") as string) || null
    const replaceDocumentId = formData.get("replace_document_id") as string | null

    if (!file || !documentType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data: payment, error: paymentError } = await dataClient
      .from("department_payments")
      .select("id, title, payment_type, department:departments(name)")
      .eq("id", paymentId)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    const paymentDepartment = getPaymentDepartmentName(payment)
    if (!paymentDepartment) {
      return NextResponse.json({ error: "Payment department is missing" }, { status: 400 })
    }

    let filePath = ""
    const onedrive = getOneDriveService()

    if (onedrive.isEnabled()) {
      try {
        const paymentTitle = payment.title || undefined
        const paymentType = payment.payment_type === "one-time" ? "one-time" : "recurring"
        const folderPath = buildPaymentDocumentFolderPathByType(paymentDepartment, paymentType, paymentId, paymentTitle)
        filePath = buildPaymentDocumentPath(
          paymentDepartment,
          paymentType,
          paymentId,
          `${Date.now()}-${file.name}`,
          paymentTitle
        )
        await onedrive.createFolder(folderPath)
        const arrayBuffer = await file.arrayBuffer()
        await onedrive.uploadFile(filePath, arrayBuffer, file.type)
        log.info(`Stored payment document in SharePoint: ${filePath}`)
      } catch (onedriveError) {
        log.error({ err: String(onedriveError) }, "SharePoint upload error:")
        return NextResponse.json({ error: "Failed to upload file to SharePoint" }, { status: 500 })
      }
    } else {
      const sanitizedName = file.name.replace(/[^\x00-\x7F]/g, "")
      filePath = `${paymentId}/${Date.now()}-${sanitizedName}`

      const { error: uploadError } = await supabase.storage.from("payment_documents").upload(filePath, file)

      if (uploadError) {
        log.error({ err: String(uploadError) }, "Storage upload error:")
        return NextResponse.json({ error: "Failed to upload file to storage" }, { status: 500 })
      }
    }

    // Insert new document record
    const { data: newDocument, error: dbError } = await dataClient
      .from("payment_documents")
      .insert({
        payment_id: paymentId,
        document_type: documentType,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        uploaded_by: user.id,
        applicable_date: applicableDate,
        mime_type: file.type,
        is_archived: false,
      })
      .select()
      .single()

    if (dbError) {
      log.error({ err: String(dbError) }, "Database insert error:")
      return NextResponse.json({ error: dbError.message || "Failed to save document record" }, { status: 500 })
    }

    // If replacing an existing document, archive the old one
    if (replaceDocumentId) {
      const { error: archiveError } = await dataClient
        .from("payment_documents")
        .update({
          is_archived: true,
          replaced_by: newDocument.id,
          archived_at: new Date().toISOString(),
        })
        .eq("id", replaceDocumentId)

      if (archiveError) {
        log.error({ err: String(archiveError) }, "Error archiving old document:")
        // Don't fail the request, the new document was created successfully
      }
    }

    return NextResponse.json({ data: newDocument }, { status: 201 })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Upload handler error:")
    const message = error instanceof Error ? error.message : "Internal Server Error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export { POST as PATCH }
