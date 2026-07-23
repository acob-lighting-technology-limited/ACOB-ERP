import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("api-requisitions-detail")

function getAdminClient() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const adminClient = getAdminClient() || supabase

    const { data: req, error } = await adminClient
      .from("requisitions")
      .select(
        `
        *,
        requester:profiles!requisitions_user_id_fkey(id, full_name, department, company_email, designation),
        reviewer_profile:profiles!requisitions_reviewed_by_fkey(id, full_name, role, designation),
        authorizer_profile:profiles!requisitions_authorized_by_fkey(id, full_name, role, designation),
        verifier_profile:profiles!requisitions_verified_by_fkey(id, full_name, role, designation),
        approver_profile:profiles!requisitions_approved_by_fkey(id, full_name, role, designation)
      `
      )
      .eq("id", id)
      .single()

    if (error || !req) {
      return apiError("Requisition not found", ApiErrorCode.NOT_FOUND, 404)
    }

    return NextResponse.json({ data: req })
  } catch (err) {
    log.error("Error in GET /api/requisitions/[id]:", err)
    return apiError("Internal Server Error", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
