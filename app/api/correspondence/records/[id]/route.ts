import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  CORRESPONDENCE_STATUSES,
  appendCorrespondenceAuditLog,
  appendCorrespondenceEvent,
  canAccessRecord,
  getAuthContext,
  getExecutiveDepartmentName,
  isAdminRole,
} from "@/lib/correspondence/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-records")

const UpdateCorrespondenceRecordSchema = z.object({
  status: z.enum(CORRESPONDENCE_STATUSES as [string, ...string[]]).optional(),
  letter_type: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  subject: z.string().optional(),
  recipient_name: z.string().optional().nullable(),
  recipient_code: z.string().trim().max(12).optional().nullable(),
  sender_name: z.string().optional().nullable(),
  action_required: z.boolean().optional(),
  due_date: z.string().optional().nullable(),
  responsible_officer_id: z.string().optional().nullable(),
  assigned_department_name: z.string().optional().nullable(),
  source_mode: z.string().optional().nullable(),
  metadata: z.unknown().optional().nullable(),
  is_locked: z.boolean().optional(),
  current_version: z.coerce.number().optional(),
  version_file_path: z.string().optional().nullable(),
  change_summary: z.string().optional().nullable(),
})

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: record, error } = await supabase
      .from("correspondence_records")
      .select("*")
      .eq("id", params.id)
      .single()

    if (error || !record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 })
    }

    const getScope = await getRequestScope()
    const isGlobalAdmin = getScope?.isAdminLike === true && getScope.scopeMode !== "lead"
    if (!isGlobalAdmin && !canAccessRecord(profile, user.id, record)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const [{ data: approvals }, { data: events }, { data: versions }] = await Promise.all([
      supabase
        .from("correspondence_approvals")
        .select("*")
        .eq("correspondence_id", params.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("correspondence_events")
        .select("*")
        .eq("correspondence_id", params.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("correspondence_versions")
        .select("*")
        .eq("correspondence_id", params.id)
        .order("version_no", { ascending: false }),
    ])

    return NextResponse.json({
      data: { record, approvals: approvals || [], events: events || [], versions: versions || [] },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/records/[id]:")
    return NextResponse.json({ error: "Failed to fetch record details" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`correspondence-records:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: record, error } = await supabase
      .from("correspondence_records")
      .select("*")
      .eq("id", params.id)
      .single()

    if (error || !record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 })
    }

    const patchScope = await getRequestScope()
    // Lead-mode admin is treated the same as a department lead: they must be
    // the owner of the record and it must be in an editable status.
    const isAdmin = isAdminRole(profile.role) && patchScope?.scopeMode !== "lead"
    if (!isAdmin && !canAccessRecord(profile, user.id, record)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const isOwner = record.originator_id === user.id || record.created_by_id === user.id
    const editableStatuses = ["under_review", "returned_for_correction", "rejected"]

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!isAdmin && !editableStatuses.includes(record.status)) {
      return NextResponse.json({ error: "Record cannot be edited in its current status" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateCorrespondenceRecordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const nextStatus = parsed.data.status ? String(parsed.data.status) : null
    const shouldCreateVersion = Boolean(parsed.data.version_file_path || parsed.data.change_summary)

    const allowedFields = [
      "status",
      "letter_type",
      "category",
      "subject",
      "recipient_name",
      "recipient_code",
      "sender_name",
      "action_required",
      "due_date",
      "responsible_officer_id",
      "assigned_department_name",
      "source_mode",
      "metadata",
      "is_locked",
      "current_version",
    ]

    const updatePayload: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in parsed.data) {
        updatePayload[key] = parsed.data[key as keyof typeof parsed.data]
      }
    }

    if (shouldCreateVersion && !("current_version" in updatePayload)) {
      updatePayload.current_version = Number(record.current_version || 1) + 1
    }

    if (nextStatus === "approved") {
      updatePayload.approved_at = new Date().toISOString()
    }

    // When submitting (or resubmitting after rejection), initialize the approval chain
    const isResubmit = nextStatus === "under_review" && record.status === "rejected"
    if ((nextStatus === "under_review" && record.status === "draft") || isResubmit) {
      const dataClient = getServiceRoleClientOrFallback(supabase)

      // Clear old approval rows so the chain starts fresh
      if (isResubmit) {
        await dataClient.from("correspondence_approvals").delete().eq("correspondence_id", record.id)
      }
      const originatorId = record.originator_id

      // Load originator profile
      const { data: originatorProfile } = await dataClient
        .from("profiles")
        .select("id, department, lead_departments, is_department_lead, designation, role")
        .eq("id", originatorId)
        .single()

      const originatorDept = originatorProfile?.department || record.department_name

      // Find dept lead (someone who leads the originator's department, who is not the originator)
      const { data: deptLeadCandidates } = await dataClient
        .from("profiles")
        .select("id, lead_departments, department, is_department_lead, role")
        .eq("is_department_lead", true)

      const deptLead = originatorDept
        ? (deptLeadCandidates || []).find(
            (p) =>
              p.id !== originatorId && (p.lead_departments?.includes(originatorDept) || p.department === originatorDept)
          )
        : null

      const execMgmtDept = await getExecutiveDepartmentName()

      // Find exec management lead
      const execLead = (deptLeadCandidates || []).find(
        (p) => p.id !== originatorId && (p.lead_departments?.includes(execMgmtDept) || p.department === execMgmtDept)
      )

      const originatorIsExecLead =
        execLead?.id === originatorId ||
        originatorProfile?.lead_departments?.includes(execMgmtDept) ||
        originatorProfile?.department === execMgmtDept ||
        originatorProfile?.designation?.toLowerCase().includes("managing director") ||
        originatorProfile?.designation?.toLowerCase() === "md"

      const originatorIsDeptLead =
        deptLead?.id === originatorId ||
        (originatorProfile?.is_department_lead === true &&
          originatorDept &&
          originatorProfile?.lead_departments?.includes(originatorDept))

      try {
        if (originatorIsExecLead) {
          // Auto-approve: originator is the final approver
          updatePayload.status = "approved"
          updatePayload.approved_at = new Date().toISOString()
          if (execLead?.id) {
            await dataClient.from("correspondence_approvals").upsert(
              {
                correspondence_id: record.id,
                approval_stage: "exec_review",
                approver_id: execLead.id,
                status: "approved",
                comments: "Auto-approved: requester is the executive lead",
                requested_at: new Date().toISOString(),
                decided_at: new Date().toISOString(),
              },
              { onConflict: "correspondence_id,approval_stage" }
            )
          }
        } else if (originatorIsDeptLead) {
          // Skip dept_review, create only exec_review
          if (execLead?.id) {
            await dataClient.from("correspondence_approvals").upsert(
              {
                correspondence_id: record.id,
                approval_stage: "exec_review",
                approver_id: execLead.id,
                status: "pending",
                requested_at: new Date().toISOString(),
              },
              { onConflict: "correspondence_id,approval_stage" }
            )
            // Notify exec lead
            await supabase.rpc("create_notification", {
              p_user_id: execLead.id,
              p_type: "task_assigned",
              p_category: "operations",
              p_title: "Correspondence pending your approval",
              p_message: `${record.reference_number} - ${record.subject}`,
              p_priority: "normal",
              p_link_url: `/admin/correspondence`,
              p_actor_id: user.id,
              p_entity_type: "correspondence_record",
              p_entity_id: record.id,
              p_rich_content: { stage: "exec_review" },
            })
          }
        } else {
          // Full chain: dept_review → exec_review
          if (deptLead?.id) {
            await dataClient.from("correspondence_approvals").upsert(
              {
                correspondence_id: record.id,
                approval_stage: "dept_review",
                approver_id: deptLead.id,
                status: "pending",
                requested_at: new Date().toISOString(),
              },
              { onConflict: "correspondence_id,approval_stage" }
            )
            await supabase.rpc("create_notification", {
              p_user_id: deptLead.id,
              p_type: "task_assigned",
              p_category: "operations",
              p_title: "Correspondence pending your approval",
              p_message: `${record.reference_number} - ${record.subject}`,
              p_priority: "normal",
              p_link_url: `/admin/correspondence`,
              p_actor_id: user.id,
              p_entity_type: "correspondence_record",
              p_entity_id: record.id,
              p_rich_content: { stage: "dept_review" },
            })
          }
          if (execLead?.id) {
            await dataClient.from("correspondence_approvals").upsert(
              {
                correspondence_id: record.id,
                approval_stage: "exec_review",
                approver_id: execLead.id,
                status: "pending",
                requested_at: new Date().toISOString(),
              },
              { onConflict: "correspondence_id,approval_stage" }
            )
          }
        }
      } catch (chainError) {
        log.error({ err: String(chainError), recordId: record.id }, "Approval chain setup failed")
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("correspondence_records")
      .update(updatePayload)
      .eq("id", params.id)
      .select("*")
      .single()

    if (updateError) throw updateError

    if (shouldCreateVersion) {
      await supabase.from("correspondence_versions").insert({
        correspondence_id: record.id,
        version_no: updated.current_version,
        file_path: parsed.data.version_file_path ? String(parsed.data.version_file_path).trim() : null,
        change_summary: parsed.data.change_summary ? String(parsed.data.change_summary).trim() : null,
        uploaded_by: user.id,
      })
    }

    if (nextStatus && nextStatus !== record.status) {
      await appendCorrespondenceEvent({
        correspondenceId: record.id,
        actorId: user.id,
        eventType: "status_changed",
        oldStatus: record.status,
        newStatus: nextStatus,
        details: {
          previous_status: record.status,
          updated_status: nextStatus,
        },
      })
    } else {
      await appendCorrespondenceEvent({
        correspondenceId: record.id,
        actorId: user.id,
        eventType: "record_updated",
        oldStatus: record.status,
        newStatus: updated.status,
        details: {
          changed_fields: Object.keys(updatePayload),
        },
      })
    }

    const auditAction = nextStatus && nextStatus !== record.status ? "status_change" : "update"

    await appendCorrespondenceAuditLog({
      actorId: user.id,
      action: auditAction,
      recordId: record.id,
      department: record.department_name || record.assigned_department_name || null,
      route: "/api/correspondence/records/[id]",
      critical: Boolean(nextStatus && nextStatus !== record.status),
      oldValues: {
        status: record.status,
        is_locked: record.is_locked,
      },
      newValues: {
        status: updated.status,
        is_locked: updated.is_locked,
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/correspondence/records/[id]:")
    return NextResponse.json({ error: "Failed to update correspondence record" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { supabase, user, profile } = await getAuthContext()
    if (!user || !profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: record, error } = await supabase
      .from("correspondence_records")
      .select("id, status, originator_id, created_by_id")
      .eq("id", params.id)
      .single()

    if (error || !record) return NextResponse.json({ error: "Record not found" }, { status: 404 })

    const deleteScope = await getRequestScope()
    const isAdmin = isAdminRole(profile.role) && deleteScope?.scopeMode !== "lead"
    const isOwner = record.originator_id === user.id || record.created_by_id === user.id
    const editableStatuses = ["under_review", "returned_for_correction", "rejected"]

    if (!isAdmin && !isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!isAdmin && !editableStatuses.includes(record.status)) {
      return NextResponse.json({ error: "Record cannot be deleted in its current status" }, { status: 403 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    await dataClient.from("correspondence_approvals").delete().eq("correspondence_id", params.id)
    await dataClient.from("correspondence_events").delete().eq("correspondence_id", params.id)

    const { error: deleteError } = await dataClient.from("correspondence_records").delete().eq("id", params.id)
    if (deleteError) throw deleteError

    return NextResponse.json({ data: { id: params.id } })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/correspondence/records/[id]:")
    return NextResponse.json({ error: "Failed to delete correspondence record" }, { status: 500 })
  }
}
