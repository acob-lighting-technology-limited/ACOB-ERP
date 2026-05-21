import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  appendCorrespondenceAuditLog,
  appendCorrespondenceEvent,
  canAccessDepartment,
  getAuthContext,
  getDepartmentCodeByName,
  getExecutiveDepartmentName,
  isAdminRole,
} from "@/lib/correspondence/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getPaginationRange, paginatedResponse, PaginationSchema } from "@/lib/pagination"
import { checkIdempotency, getIdempotencyKey, storeIdempotencyKey } from "@/lib/idempotency"
import { getOneDriveService } from "@/lib/onedrive"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-records")

type CorrespondenceListRecord = {
  department_name?: string | null
  assigned_department_name?: string | null
}

type CorrespondenceLeadCandidate = {
  id: string
  role?: string | null
  lead_departments?: string[] | null
  department?: string | null
  is_department_lead?: boolean | null
}

const CreateCorrespondenceRecordSchema = z.object({
  subject: z.string().trim().min(1, "subject is required"),
  department_name: z.string().trim().optional(),
  letter_type: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  recipient_name: z.string().optional().nullable(),
  recipient_code: z.string().trim().min(1, "recipient_code is required").max(12),
  sender_name: z.string().optional().nullable(),
  originator_id: z.string().uuid().optional().nullable(),
  action_required: z.boolean().optional().default(false),
  due_date: z.string().min(1, "due_date is required"),
  responsible_officer_id: z.string().optional().nullable(),
  source_mode: z.string().optional().nullable(),
  metadata: z.unknown().optional().nullable(),
})

const CorrespondenceListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
})

export async function GET(request: NextRequest) {
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const paginationParsed = CorrespondenceListSchema.safeParse(Object.fromEntries(searchParams))
    if (!paginationParsed.success) {
      return NextResponse.json(
        { error: paginationParsed.error.issues[0]?.message ?? "Invalid pagination params" },
        { status: 400 }
      )
    }
    const pagination = PaginationSchema.parse({
      page: paginationParsed.data.page,
      per_page: paginationParsed.data.limit,
    })
    const { from, to } = getPaginationRange(pagination)
    const letterTypeParam = searchParams.get("letter_type")
    const status = paginationParsed.data.status || searchParams.get("status")
    const department = searchParams.get("department")
    const dateFrom = searchParams.get("date_from")
    const dateTo = searchParams.get("date_to")
    const search = paginationParsed.data.search.trim()

    const requestScope = await getRequestScope()
    // A global admin (scopeMode: "global") may see all records.
    // An admin in lead mode (scopeMode: "lead") is treated the same as a department lead
    // and must be filtered to their own records, just like any non-global user.
    const isGlobalAdmin = isAdminRole(profile.role) && requestScope?.scopeMode !== "lead"
    const scopeMine = searchParams.get("scope") === "mine"

    let query = supabase
      .from("correspondence_records")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })

    if (!isGlobalAdmin || scopeMine) {
      query = query.or(`originator_id.eq.${user.id},created_by_id.eq.${user.id}`)
    }

    if (letterTypeParam === "internal" || letterTypeParam === "external") {
      query = query.eq("letter_type", letterTypeParam)
    }

    if (status) {
      query = query.eq("status", status)
    }

    if (dateFrom) {
      query = query.gte("created_at", dateFrom)
    }

    if (dateTo) {
      query = query.lte("created_at", dateTo)
    }

    if (department) {
      query = query.or(`department_name.eq.${department},assigned_department_name.eq.${department}`)
    }

    if (search) {
      query = query.or(
        `reference_number.ilike.%${search}%,subject.ilike.%${search}%,recipient_name.ilike.%${search}%,sender_name.ilike.%${search}%`
      )
    }

    const { data, error, count } = await query.range(from, to)
    if (error) throw error

    return NextResponse.json({
      data: (data || []) as CorrespondenceListRecord[],
      total: count || 0,
      page: paginationParsed.data.page,
      limit: paginationParsed.data.limit,
      pagination: paginatedResponse((data || []) as CorrespondenceListRecord[], count || 0, pagination).pagination,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/correspondence/records:")
    return NextResponse.json({ error: "Failed to fetch correspondence records" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`correspondence-records:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, user, profile } = await getAuthContext()
    const dataClient = getServiceRoleClientOrFallback(supabase)

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const idempotencyKey = getIdempotencyKey(request)
    if (idempotencyKey) {
      const { isDuplicate, cachedResponse } = await checkIdempotency(dataClient, idempotencyKey)
      if (isDuplicate) {
        return NextResponse.json(cachedResponse, { status: 200 })
      }
    }

    const contentType = request.headers.get("content-type") || ""
    const attachments: File[] = []
    let body: Record<string, unknown> = {}
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData()
      const metadataRaw = String(formData.get("metadata") || "{}")
      let parsedMetadata: unknown = null
      try {
        parsedMetadata = JSON.parse(metadataRaw)
      } catch {
        parsedMetadata = null
      }
      body = {
        subject: String(formData.get("subject") || ""),
        department_name: String(formData.get("department_name") || ""),
        letter_type: String(formData.get("letter_type") || "") || null,
        category: String(formData.get("category") || "") || null,
        recipient_name: String(formData.get("recipient_name") || "") || null,
        recipient_code: String(formData.get("recipient_code") || ""),
        sender_name: String(formData.get("sender_name") || "") || null,
        originator_id: String(formData.get("originator_id") || "") || null,
        action_required: String(formData.get("action_required") || "false") === "true",
        due_date: String(formData.get("due_date") || ""),
        metadata: parsedMetadata,
      }
      const incomingFiles = formData.getAll("attachments")
      for (const fileValue of incomingFiles) {
        if (fileValue instanceof File) attachments.push(fileValue)
      }
    } else {
      body = (await request.json()) as Record<string, unknown>
    }
    const parsed = CreateCorrespondenceRecordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const subject = parsed.data.subject
    const profileDepartment = profile?.department ? String(profile.department).trim() : null
    const departmentName = parsed.data.department_name ? String(parsed.data.department_name).trim() : profileDepartment
    const assignedDepartmentName = departmentName

    if (!departmentName) {
      return NextResponse.json({ error: "department_name is required" }, { status: 400 })
    }
    const resolvedDepartmentName = departmentName as string

    const departmentCode = await getDepartmentCodeByName(resolvedDepartmentName)
    if (!departmentCode) {
      return NextResponse.json(
        { error: `No active department code configured for ${resolvedDepartmentName}` },
        { status: 400 }
      )
    }

    const postScope = await getRequestScope()
    const isGlobalAdminPost = isAdminRole(profile.role) && postScope?.scopeMode !== "lead"
    if (!isGlobalAdminPost && profile.is_department_lead) {
      const accessDepartment = departmentName || assignedDepartmentName
      if (accessDepartment && !canAccessDepartment(profile, accessDepartment)) {
        return NextResponse.json({ error: "Forbidden: outside your department scope" }, { status: 403 })
      }
    }

    // If entering on behalf of someone else, fetch their profile for sender_name
    const originatorId = parsed.data.originator_id || user.id
    const creatorName =
      profile?.full_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
      user.email ||
      null

    let senderName = creatorName

    if (originatorId !== user.id) {
      const { data: originatorProfile } = await supabase
        .from("profiles")
        .select("full_name, first_name, last_name")
        .eq("id", originatorId)
        .single()
      if (originatorProfile) {
        senderName =
          originatorProfile.full_name ||
          [originatorProfile.first_name, originatorProfile.last_name].filter(Boolean).join(" ").trim() ||
          senderName
      }
    }

    const insertPayload: Record<string, unknown> = {
      subject,
      department_name: resolvedDepartmentName,
      department_code: departmentCode,
      letter_type: parsed.data.letter_type || "external",
      category: parsed.data.category || null,
      recipient_name: parsed.data.recipient_name ? String(parsed.data.recipient_name).trim() : null,
      recipient_code: parsed.data.recipient_code.toUpperCase(),
      sender_name: senderName,
      action_required: parsed.data.action_required,
      due_date: parsed.data.due_date,
      responsible_officer_id: parsed.data.responsible_officer_id || null,
      assigned_department_name: assignedDepartmentName,
      source_mode: parsed.data.source_mode || null,
      metadata:
        typeof parsed.data.metadata === "object" && parsed.data.metadata !== null
          ? (parsed.data.metadata as Record<string, unknown>)
          : {},
      status: "under_review",
      originator_id: originatorId,
      created_by_name: creatorName,
      submitted_at: new Date().toISOString(),
      received_at: null,
    }

    const { data: created, error } = await supabase
      .from("correspondence_records")
      .insert(insertPayload)
      .select("*")
      .single()

    if (error) throw error

    // Initialize approval chain immediately (record goes straight to under_review)
    try {
      const { data: originatorProfile } = await dataClient
        .from("profiles")
        .select("id, department, lead_departments, is_department_lead, designation, role")
        .eq("id", originatorId)
        .single()

      const originatorDept = originatorProfile?.department || created.department_name

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
        originatorProfile?.is_department_lead === true &&
        originatorDept &&
        originatorProfile?.lead_departments?.includes(originatorDept)

      const now = new Date().toISOString()

      if (originatorIsExecLead) {
        await supabase
          .from("correspondence_records")
          .update({ status: "approved", approved_at: now })
          .eq("id", created.id)
        created.status = "approved"
        if (execLead?.id) {
          await dataClient.from("correspondence_approvals").upsert(
            {
              correspondence_id: created.id,
              approval_stage: "exec_review",
              approver_id: execLead.id,
              status: "approved",
              comments: "Auto-approved: requester is the executive lead",
              requested_at: now,
              decided_at: now,
            },
            { onConflict: "correspondence_id,approval_stage" }
          )
        }
      } else if (originatorIsDeptLead) {
        if (execLead?.id) {
          await dataClient.from("correspondence_approvals").upsert(
            {
              correspondence_id: created.id,
              approval_stage: "exec_review",
              approver_id: execLead.id,
              status: "pending",
              requested_at: now,
            },
            { onConflict: "correspondence_id,approval_stage" }
          )
          await supabase.rpc("create_notification", {
            p_user_id: execLead.id,
            p_type: "approval_request",
            p_category: "approvals",
            p_title: "Correspondence pending your approval",
            p_message: `${created.reference_number} - ${created.subject}`,
            p_priority: "normal",
            p_link_url: "/admin/correspondence",
            p_actor_id: user.id,
            p_entity_type: "correspondence_record",
            p_entity_id: created.id,
            p_rich_content: { stage: "exec_review" },
          })
        }
      } else {
        if (deptLead?.id) {
          await dataClient.from("correspondence_approvals").upsert(
            {
              correspondence_id: created.id,
              approval_stage: "dept_review",
              approver_id: deptLead.id,
              status: "pending",
              requested_at: now,
            },
            { onConflict: "correspondence_id,approval_stage" }
          )
          await supabase.rpc("create_notification", {
            p_user_id: deptLead.id,
            p_type: "approval_request",
            p_category: "approvals",
            p_title: "Correspondence pending your approval",
            p_message: `${created.reference_number} - ${created.subject}`,
            p_priority: "normal",
            p_link_url: "/admin/correspondence",
            p_actor_id: user.id,
            p_entity_type: "correspondence_record",
            p_entity_id: created.id,
            p_rich_content: { stage: "dept_review" },
          })
        }
        if (execLead?.id) {
          await dataClient.from("correspondence_approvals").upsert(
            {
              correspondence_id: created.id,
              approval_stage: "exec_review",
              approver_id: execLead.id,
              status: "pending",
              requested_at: now,
            },
            { onConflict: "correspondence_id,approval_stage" }
          )
        }
      }
    } catch (chainError) {
      log.error({ err: String(chainError), recordId: created.id }, "Approval chain setup failed on create")
    }

    try {
      if (attachments.length > 0) {
        const onedrive = getOneDriveService()
        if (onedrive.isEnabled()) {
          const basePath = `/correspondence/${created.reference_number}`
          try {
            await onedrive.createFolder(basePath)
          } catch {
            // folder may already exist
          }
          const uploadedFiles: Array<{ name: string; path: string; size: number; mime_type: string }> = []
          for (const file of attachments) {
            const safeName = file.name.replace(/[^\w.\-]+/g, "_")
            const content = new Uint8Array(await file.arrayBuffer())
            const uploadResult = await onedrive.uploadFile(
              `${basePath}/${safeName}`,
              content,
              file.type || "application/pdf"
            )
            uploadedFiles.push({
              name: safeName,
              path: `${basePath}/${safeName}`,
              size: file.size,
              mime_type: uploadResult.file?.mimeType || file.type || "application/pdf",
            })
          }

          await supabase
            .from("correspondence_records")
            .update({
              metadata: {
                ...((created.metadata as Record<string, unknown> | null) || {}),
                attachments: uploadedFiles,
              },
            })
            .eq("id", created.id)
        }
      }

      await appendCorrespondenceEvent({
        correspondenceId: created.id,
        actorId: user.id,
        eventType: "correspondence_created",
        newStatus: created.status,
        details: {
          department_name: created.department_name,
          assigned_department_name: created.assigned_department_name,
          recipient_code: created.recipient_code,
        },
      })
    } catch (eventError) {
      log.error({ err: String(eventError), correspondenceId: created.id }, "Correspondence event logging failed")
    }

    try {
      await appendCorrespondenceAuditLog({
        actorId: user.id,
        action: "correspondence_record_created",
        recordId: created.id,
        department: created.department_name || created.assigned_department_name || null,
        route: "/api/correspondence/records",
        critical: false,
        newValues: {
          reference_number: created.reference_number,
          status: created.status,
          recipient_code: created.recipient_code,
        },
      })
    } catch (auditError) {
      log.error({ err: String(auditError), correspondenceId: created.id }, "Correspondence audit logging failed")
    }

    try {
      const notifyDepartment = created.assigned_department_name || created.department_name
      if (notifyDepartment) {
        const { data: leadCandidates } = await dataClient
          .from("profiles")
          .select("id, role, lead_departments, department, is_department_lead")
          .eq("is_department_lead", true)

        const targetLead = ((leadCandidates || []) as CorrespondenceLeadCandidate[]).find((p) =>
          canAccessDepartment(p, notifyDepartment)
        )

        if (targetLead?.id) {
          await supabase.rpc("create_notification", {
            p_user_id: targetLead.id,
            p_type: "approval_request",
            p_category: "approvals",
            p_title: "New correspondence logged",
            p_message: `${created.reference_number} - ${created.subject}`,
            p_priority: "normal",
            p_link_url: "/admin/correspondence",
            p_actor_id: user.id,
            p_entity_type: "correspondence_record",
            p_entity_id: created.id,
            p_rich_content: { status: created.status, recipient_code: created.recipient_code },
          })
        }
      }
    } catch (notifyError) {
      log.error({ err: String(notifyError) }, "Correspondence notification error:")
    }

    const responsePayload = { data: created }
    if (idempotencyKey) {
      await storeIdempotencyKey(dataClient, idempotencyKey, responsePayload)
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    const errObj = error as { message?: string; details?: string; hint?: string; code?: string }
    log.error(
      {
        err: String(error),
        message: errObj?.message,
        details: errObj?.details,
        hint: errObj?.hint,
        code: errObj?.code,
      },
      "Error in POST /api/correspondence/records:"
    )
    const details = error as { message?: string; details?: string; hint?: string; code?: string }
    return NextResponse.json(
      {
        error: details?.message || "Failed to create correspondence record",
        details: details?.details || null,
        hint: details?.hint || null,
        code: details?.code || null,
      },
      { status: 500 }
    )
  }
}
