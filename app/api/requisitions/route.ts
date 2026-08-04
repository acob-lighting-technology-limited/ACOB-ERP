import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { z } from "zod"
import { numberToNairaWords } from "@/lib/requisitions/number-to-words"
import { logger } from "@/lib/logger"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("api-requisitions")

const BeneficiarySchema = z.object({
  account_name: z.string().trim().min(1, "Account name is required"),
  account_number: z.string().trim().min(1, "Account number is required"),
  bank_name: z.string().trim().min(1, "Bank name is required"),
  amount: z.union([z.number(), z.string()]).optional(),
})

const AttachmentSchema = z.object({
  file_name: z.string().trim().min(1, "File name is required"),
  file_url: z.string().trim().min(1, "File URL is required"),
  file_type: z.string().optional(),
  file_size: z.number().optional(),
})

const CreateRequisitionSchema = z.object({
  department: z.string().trim().min(1, "Department is required"),
  project_name: z.string().trim().min(1, "Project name is required"),
  amount: z.number().positive("Amount must be greater than zero"),
  amount_in_words: z.string().optional(),
  purpose: z.string().trim().min(3, "Purpose must be at least 3 characters"),
  beneficiary_details: z.array(BeneficiarySchema).min(1, "At least one beneficiary is required"),
  attachments: z.array(AttachmentSchema).min(1, "At least one supporting receipt/document is required"),
})

function getAdminClient() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const url = new URL(request.url)
    const userOnly = url.searchParams.get("user_only") === "true"
    const statusParam = url.searchParams.get("status")
    const stageParam = url.searchParams.get("stage")

    let query = supabase
      .from("requisitions")
      .select(
        `
        *,
        requester:profiles!requisitions_user_id_fkey(id, full_name, department, company_email)
      `
      )
      .order("created_at", { ascending: false })

    if (userOnly) {
      query = query.eq("user_id", user.id)
    }

    if (statusParam) {
      query = query.eq("status", statusParam)
    }

    if (stageParam) {
      query = query.eq("current_stage_code", stageParam)
    }

    const { data, error } = await query

    if (error) {
      log.error("Error fetching requisitions:", error)
      return apiError(error.message, ApiErrorCode.INTERNAL_ERROR, 500)
    }

    return NextResponse.json({ data: data || [] })
  } catch (err) {
    log.error("Unexpected error in GET /api/requisitions:", err)
    return apiError("Internal Server Error", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const body = await request.json()
    const parsed = CreateRequisitionSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || "Validation error",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
    }

    const payload = parsed.data
    const computedAmountInWords = payload.amount_in_words?.trim() || numberToNairaWords(payload.amount)

    const adminClient = getAdminClient() || supabase

    // Create the requisition row
    const { data: newReq, error } = await adminClient
      .from("requisitions")
      .insert({
        user_id: user.id,
        department: payload.department,
        project_name: payload.project_name,
        amount: payload.amount,
        amount_in_words: computedAmountInWords,
        purpose: payload.purpose,
        beneficiary_details: payload.beneficiary_details,
        attachments: payload.attachments,
        current_stage_code: "pending_reviewed_by",
        status: "pending",
      })
      .select()
      .single()

    if (error || !newReq) {
      log.error("Failed to insert requisition:", error)
      return apiError(error?.message || "Failed to create requisition", ApiErrorCode.INTERNAL_ERROR, 500)
    }

    // Trigger notification to Admin & HR Lead for Stage 1
    try {
      const { data: adminHrProfiles } = await adminClient
        .from("profiles")
        .select("id")
        .or("role.eq.super_admin,role.eq.admin,is_department_lead.eq.true")

      if (adminHrProfiles && adminHrProfiles.length > 0) {
        for (const target of adminHrProfiles) {
          await adminClient.rpc("create_notification", {
            p_user_id: target.id,
            p_type: "requisition_submitted",
            p_category: "approvals",
            p_title: "New Requisition for Review",
            p_message: `Requisition ${newReq.requisition_number} (₦${payload.amount.toLocaleString()}) submitted for Admin & HR review.`,
            p_priority: "normal",
            p_link_url: `/requisition/${newReq.id}`,
            p_actor_id: user.id,
            p_entity_type: "requisition",
            p_entity_id: newReq.id,
          })
        }
      }
    } catch (notifErr) {
      log.error("Failed to send notification for new requisition:", notifErr)
    }

    return NextResponse.json({ data: newReq, message: "Requisition created successfully" }, { status: 201 })
  } catch (err) {
    log.error("Unexpected error in POST /api/requisitions:", err)
    return apiError("Internal Server Error", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
