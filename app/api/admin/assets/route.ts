import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type AssignmentType = "individual" | "department" | "office"

interface AssetFormPayload {
  asset_type: string
  acquisition_year: number
  asset_model?: string
  serial_number?: string
  status: string
  notes?: string
  assignment_type: AssignmentType
  assigned_to?: string
  assignment_department?: string
  office_location?: string
  assignment_notes?: string
  assigned_by?: string
  assigned_at?: string
}

interface SaveAssetPayload {
  mode: "create" | "update"
  assetForm: AssetFormPayload
  quantity?: number
  selectedAsset?: {
    id: string
    status: string
  } | null
  originalAssetForm?: {
    assigned_to?: string
    assignment_department?: string
    office_location?: string
  } | null
}

type AdminAssetsClient = Awaited<ReturnType<typeof createClient>>

type AssetAssignmentInsert = {
  asset_id: string
  assigned_by: string
  assigned_at: string
  is_current: boolean
  assignment_notes: string | null
  assignment_type: AssignmentType
  assigned_to?: string
  department?: string | null
  office_location?: string | null
}

async function buildAssignmentData(
  dataClient: AdminAssetsClient,
  assetId: string,
  userId: string,
  form: AssetFormPayload
): Promise<{ ok: true; data: AssetAssignmentInsert } | { ok: false; error: string }> {
  if (form.assignment_type === "individual" && !form.assigned_to) {
    return { ok: false, error: "Please select a user" }
  }
  if (form.assignment_type === "department" && !form.assignment_department) {
    return { ok: false, error: "Please select a department" }
  }
  if (form.assignment_type === "office" && !form.office_location) {
    return { ok: false, error: "Please select an office location" }
  }

  const assignment: AssetAssignmentInsert = {
    asset_id: assetId,
    assigned_by: form.assigned_by || userId,
    assigned_at: form.assigned_at ? new Date(form.assigned_at).toISOString() : new Date().toISOString(),
    is_current: true,
    assignment_notes: form.assignment_notes || null,
    assignment_type: form.assignment_type,
  }

  if (form.assignment_type === "individual") {
    assignment.assigned_to = form.assigned_to
    const { data: profile, error } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", form.assigned_to)
      .single()
    if (error) return { ok: false, error: `Failed to resolve assignee department: ${error.message}` }
    assignment.department = profile?.department || null
  } else if (form.assignment_type === "department") {
    assignment.department = form.assignment_department
  } else if (form.assignment_type === "office") {
    assignment.office_location = form.office_location
  }

  return { ok: true, data: assignment }
}

async function closeCurrentAssetAssignments(
  dataClient: AdminAssetsClient,
  assetId: string,
  handoverNotes: string
): Promise<void> {
  const { error: closeError } = await dataClient
    .from("asset_assignments")
    .update({
      is_current: false,
      handed_over_at: new Date().toISOString(),
      handover_notes: handoverNotes,
    })
    .eq("asset_id", assetId)
    .eq("is_current", true)

  if (closeError) {
    throw new Error(`Failed to close current assignment: ${closeError.message}`)
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`admin-assets:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)
  }

  const scope = await resolveAdminScope(supabase as AdminAssetsClient, user.id)
  if (!scope || !scope.isAdminLike || !canAccessAdminSection(scope, "assets")) {
    return apiError("Forbidden", ApiErrorCode.FORBIDDEN, 403)
  }

  const sizeError = checkRequestSize(request)
  if (sizeError) return sizeError

  const payload = (await request.json().catch(() => null)) as SaveAssetPayload | null
  const mode = payload?.mode
  const form = payload?.assetForm

  if (!mode || !form) {
    return apiError("Invalid payload", ApiErrorCode.VALIDATION_ERROR, 400)
  }

  if (!String(form.asset_type || "").trim()) {
    return apiError("Please select an asset type", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
  }

  const dataClient = getServiceRoleClientOrFallback(supabase as AdminAssetsClient)
  const createdCodes: string[] = []

  try {
    if (mode === "update") {
      const selected = payload?.selectedAsset
      if (!selected?.id) {
        return apiError("Asset id is required for update", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
      }

      const { error: updateError } = await dataClient
        .from("assets")
        .update({
          status: form.status,
          notes: form.notes || null,
          asset_model: form.asset_model || null,
          serial_number: form.serial_number || null,
          acquisition_year: form.acquisition_year,
        })
        .eq("id", selected.id)

      if (updateError) throw new Error(updateError.message)

      if (selected.status === "assigned" && form.status !== "assigned") {
        await closeCurrentAssetAssignments(dataClient, selected.id, `Status changed to ${form.status}`)
      }

      const original = payload?.originalAssetForm || {}
      const isAssigneeChanged =
        selected.status === "assigned" &&
        form.status === "assigned" &&
        (form.assigned_to !== (original.assigned_to || "") ||
          form.assignment_department !== (original.assignment_department || "") ||
          form.office_location !== (original.office_location || ""))

      if (isAssigneeChanged) {
        const assignmentData = await buildAssignmentData(dataClient, selected.id, user.id, form)
        if (!assignmentData.ok) return apiError(assignmentData.error, ApiErrorCode.VALIDATION_ERROR, 400)

        const { error: rpcError } = await dataClient.rpc("reassign_asset", {
          p_asset_id: selected.id,
          p_new_assignment_type: form.assignment_type,
          p_assigned_to: assignmentData.data.assigned_to || null,
          p_department: assignmentData.data.department || null,
          p_office_location: assignmentData.data.office_location || null,
          p_assigned_by: assignmentData.data.assigned_by,
          p_assigned_at: assignmentData.data.assigned_at,
          p_assignment_notes: assignmentData.data.assignment_notes,
          p_handover_notes: "Reassigned via Edit",
          p_new_status: form.status,
        })
        if (rpcError) throw new Error(rpcError.message)
      } else if (selected.status !== "assigned" && form.status === "assigned") {
        const assignmentData = await buildAssignmentData(dataClient, selected.id, user.id, form)
        if (!assignmentData.ok) return apiError(assignmentData.error, ApiErrorCode.VALIDATION_ERROR, 400)

        const { error: atomicAssignError } = await dataClient.rpc("atomic_assign_asset", {
          p_asset_id: selected.id,
          p_assigned_by: assignmentData.data.assigned_by,
          p_assigned_at: assignmentData.data.assigned_at,
          p_assignment_type: form.assignment_type,
          p_assigned_to: assignmentData.data.assigned_to || null,
          p_department: assignmentData.data.department || null,
          p_office_location: assignmentData.data.office_location || null,
          p_notes: assignmentData.data.assignment_notes,
          p_handover_notes: "Reassigned via Edit",
        })
        if (atomicAssignError) throw new Error(atomicAssignError.message)
      }

      return NextResponse.json({ message: "Asset updated successfully" })
    }

    const rawQuantity = Number(payload?.quantity ?? 1)
    if (!Number.isInteger(rawQuantity) || rawQuantity < 1 || rawQuantity > 100) {
      return apiError("Quantity must be an integer between 1 and 100", ApiErrorCode.VALIDATION_ERROR, 400)
    }
    const quantity = rawQuantity

    if (quantity > 1 && String(form.serial_number || "").trim()) {
      return apiError(
        "Serial number cannot be set when creating multiple assets in one batch",
        ApiErrorCode.VALIDATION_ERROR,
        400
      )
    }

    const { data: latestAsset, error: latestError } = await dataClient
      .from("assets")
      .select("acquisition_year")
      .eq("asset_type", form.asset_type)
      .order("acquisition_year", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestError) throw new Error(latestError.message)

    if (latestAsset && form.acquisition_year < Number(latestAsset.acquisition_year || 0)) {
      return apiError(
        `Year must be ${latestAsset.acquisition_year} or later for this asset type.`,
        ApiErrorCode.VALIDATION_ERROR,
        400
      )
    }

    for (let i = 0; i < quantity; i++) {
      const { data: uniqueCodeData, error: serialError } = await dataClient.rpc("get_next_asset_serial", {
        asset_code: form.asset_type,
        year: form.acquisition_year,
      })
      if (serialError) throw new Error(serialError.message)

      const { data: newAsset, error: insertError } = await dataClient
        .from("assets")
        .insert({
          asset_type: form.asset_type,
          acquisition_year: form.acquisition_year,
          unique_code: uniqueCodeData,
          status: form.status,
          notes: form.notes || null,
          asset_model: form.asset_model || null,
          serial_number: quantity === 1 ? form.serial_number || null : null,
          created_by: user.id,
        })
        .select("id")
        .single()
      if (insertError) throw new Error(insertError.message)

      if (form.status === "assigned" && newAsset?.id) {
        const assignmentData = await buildAssignmentData(dataClient, newAsset.id, user.id, form)
        if (!assignmentData.ok) return apiError(assignmentData.error, ApiErrorCode.VALIDATION_ERROR, 400)

        const { error: assignError } = await dataClient.from("asset_assignments").insert(assignmentData.data)
        if (assignError) throw new Error(assignError.message)

        const { error: assetFieldsError } = await dataClient
          .from("assets")
          .update({
            assignment_type: form.assignment_type,
            department: assignmentData.data.department || null,
            office_location: assignmentData.data.office_location || null,
          })
          .eq("id", newAsset.id)
        if (assetFieldsError) throw new Error(assetFieldsError.message)
      }

      createdCodes.push(String(uniqueCodeData || ""))
    }

    const message =
      quantity === 1
        ? `Asset created successfully: ${createdCodes[0]}`
        : `${quantity} assets created successfully (${createdCodes[0]} - ${createdCodes[createdCodes.length - 1]})`

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "asset",
        entityId: createdCodes[0] || "bulk",
        newValues: { asset_type: form.asset_type, quantity, createdCodes },
        context: { actorId: user.id, source: "api", route: "/api/admin/assets" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message, createdCodes, createdCount: createdCodes.length })
  } catch (error: unknown) {
    const baseError = error instanceof Error ? error.message : "Failed to save asset"
    const errorMessage =
      createdCodes.length > 0 ? `Created ${createdCodes.length} asset(s) before failure. ${baseError}` : baseError
    return apiError(errorMessage, ApiErrorCode.INTERNAL_ERROR, 500)
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  return PATCH(request)
}
