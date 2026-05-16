/**
 * POST /api/dev/leave-flow-test
 *
 * Developer-only route that simulates the complete leave workflow end-to-end
 * using service-role privileges.  No real user passwords needed — the caller
 * just supplies:
 *   requester_id    – UUID of the employee requesting leave
 *   reliever_id     – UUID of the reliever
 *   leave_type_id   – UUID of the leave type to request
 *   mode            – "full-auto" | "step" (default "full-auto")
 *   cleanup         – boolean, delete the test request afterwards (default true)
 *
 * The response contains a step-by-step trace of what happened.
 *
 * PROTECTED: developer role only.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import {
  buildResolvedRouteSnapshot,
  classifyRequesterKind,
  getRouteStageByOrder,
  stageCodeForRole,
} from "@/lib/hr/leave-routing"
import { computeLeaveDates, getLeavePolicy, resolveProfileByIdentifier } from "@/lib/hr/leave-workflow"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { toLocalISODate } from "@/lib/utils/date"

type StepResult = {
  step: string
  status: "ok" | "error" | "skipped"
  detail?: string
  data?: unknown
}

function ok(step: string, detail?: string, data?: unknown): StepResult {
  return { step, status: "ok", detail, data }
}

function err(step: string, detail: string): StepResult {
  return { step, status: "error", detail }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`dev-leave-flow-test:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  // ── Auth guard: developer only ──────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: actorProfile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (actorProfile?.role !== "developer") {
    return NextResponse.json({ error: "Forbidden: developer role required" }, { status: 403 })
  }

  // ── Service-role client ─────────────────────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured on this server" }, { status: 500 })
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Parse body ──────────────────────────────────────────────────────────────
  const body = await request.json()
  const {
    requester_id,
    reliever_id,
    leave_type_id,
    cleanup = true,
  } = body as {
    requester_id: string
    reliever_id: string
    leave_type_id: string
    cleanup?: boolean
  }

  if (!requester_id || !reliever_id || !leave_type_id) {
    return NextResponse.json({ error: "requester_id, reliever_id and leave_type_id are required" }, { status: 400 })
  }

  const steps: StepResult[] = []
  let leaveRequestId: string | null = null

  try {
    // ── Step 1: Load requester profile ──────────────────────────────────────────
    const { data: requester, error: reqErr } = await admin
      .from("profiles")
      .select(
        "id, full_name, first_name, last_name, department, department_id, is_department_lead, lead_departments, gender, employment_date, work_location, employment_type, marital_status, has_children, pregnancy_status"
      )
      .eq("id", requester_id)
      .single()

    if (reqErr || !requester) {
      steps.push(err("load_requester", `Profile not found: ${reqErr?.message}`))
      return NextResponse.json({ ok: false, steps })
    }
    steps.push(ok("load_requester", `Loaded: ${requester.full_name || requester.id}`))

    // ── Step 2: Load reliever profile ───────────────────────────────────────────
    const reliever = await resolveProfileByIdentifier(admin, reliever_id, "Reliever").catch((e: Error) => {
      steps.push(err("load_reliever", e.message))
      return null
    })
    if (!reliever) return NextResponse.json({ ok: false, steps })
    steps.push(ok("load_reliever", `Loaded: ${reliever.full_name || reliever.id}`))

    // ── Step 3: Build route snapshot ────────────────────────────────────────────
    const requesterKind = classifyRequesterKind(requester)
    let routeSnapshot: Awaited<ReturnType<typeof buildResolvedRouteSnapshot>> | null = null

    try {
      routeSnapshot = await buildResolvedRouteSnapshot({
        supabase: admin,
        requester,
        requesterId: requester_id,
        requesterKind,
        relieverId: reliever_id,
      })
      steps.push(
        ok(
          "build_route_snapshot",
          `${routeSnapshot.length} stages`,
          routeSnapshot.map((s) => ({ order: s.stage_order, stage: s.stage_code, approver: s.approver_user_id }))
        )
      )
    } catch (e: unknown) {
      steps.push(err("build_route_snapshot", e instanceof Error ? e.message : "Unknown error"))
      return NextResponse.json({ ok: false, steps })
    }

    // ── Step 4: Compute leave dates ─────────────────────────────────────────────
    const policy = await getLeavePolicy(admin, leave_type_id)
    const startDate = toLocalISODate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) // 7 days from now
    const { endDate, resumeDate } = await computeLeaveDates({
      supabase: admin,
      startDate,
      daysCount: 3,
      accrualMode: policy.accrual_mode || "calendar_days",
      location: requester.work_location || "global",
    })
    steps.push(ok("compute_dates", `${startDate} → ${endDate}, resume ${resumeDate}`))

    // ── Step 5: Insert leave request ────────────────────────────────────────────
    const firstStage = getRouteStageByOrder(routeSnapshot, 1)
    if (!firstStage) {
      steps.push(err("create_request", "Route snapshot has no first stage"))
      return NextResponse.json({ ok: false, steps })
    }

    const deptLeadStage = routeSnapshot.find((s) => s.approver_role_code === "department_lead")

    const { data: newRequest, error: insertErr } = await admin
      .from("leave_requests")
      .insert({
        user_id: requester_id,
        leave_type_id,
        start_date: startDate,
        end_date: endDate,
        resume_date: resumeDate,
        days_count: 3,
        reason: "[TEST] Automated leave flow test — safe to delete",
        status: "pending",
        approval_stage: firstStage.stage_code,
        current_stage_code: firstStage.stage_code,
        current_stage_order: firstStage.stage_order,
        current_approver_user_id: firstStage.approver_user_id,
        requester_route_kind: requesterKind,
        route_snapshot: routeSnapshot,
        reliever_id: reliever_id,
        supervisor_id: deptLeadStage?.approver_user_id || null,
        handover_note: "[TEST] Handover note for automated flow test",
        requested_days_mode: policy.accrual_mode || "calendar_days",
        request_kind: "standard",
      })
      .select()
      .single()

    if (insertErr || !newRequest) {
      steps.push(err("create_request", insertErr?.message || "Insert returned no data"))
      return NextResponse.json({ ok: false, steps })
    }

    leaveRequestId = newRequest.id
    steps.push(ok("create_request", `Created request ${newRequest.id}`))

    // ── Step 6–N: Simulate each approval stage ──────────────────────────────────
    let currentStageOrder = firstStage.stage_order

    while (true) {
      const { data: current, error: fetchErr } = await admin
        .from("leave_requests")
        .select("*")
        .eq("id", leaveRequestId!)
        .single()

      if (fetchErr || !current) {
        steps.push(err(`advance_stage_${currentStageOrder}`, "Failed to re-fetch leave request"))
        break
      }

      const stageCode = current.current_stage_code || current.approval_stage
      const approverId = current.current_approver_user_id

      if (!approverId || ["completed", "approved", "rejected"].includes(current.status)) {
        break
      }

      const nextStageOrder = currentStageOrder + 1
      const nextStage = getRouteStageByOrder(routeSnapshot, nextStageOrder)
      const now = new Date().toISOString()

      // Upsert approval record
      await admin.from("leave_approvals").upsert(
        {
          leave_request_id: leaveRequestId,
          approver_id: approverId,
          approval_level: currentStageOrder,
          status: "approved",
          comments: `[TEST] Auto-approved at stage ${stageCode}`,
          approved_at: now,
          stage_code: stageCode,
          stage_order: currentStageOrder,
          reliever_revision: current.reliever_revision || 1,
          superseded: false,
        },
        { onConflict: "leave_request_id,approver_id,approval_level" }
      )

      if (nextStage && nextStage.approver_user_id) {
        // Advance to next stage
        const updates: Record<string, unknown> = {
          approval_stage: nextStage.stage_code,
          current_stage_code: nextStage.stage_code,
          current_stage_order: nextStage.stage_order,
          current_approver_user_id: nextStage.approver_user_id,
        }
        if (stageCode === stageCodeForRole("reliever")) updates.reliever_decision_at = now
        if (stageCode === stageCodeForRole("department_lead")) {
          updates.supervisor_decision_at = now
          updates.lead_reconfirm_required = false
        }
        if (stageCode === stageCodeForRole("admin_hr_lead") || stageCode === stageCodeForRole("hcs")) {
          updates.hr_decision_at = now
        }

        await admin.from("leave_requests").update(updates).eq("id", leaveRequestId!)
        steps.push(
          ok(`approve_stage_${currentStageOrder}`, `✓ ${stageCode} approved → advancing to ${nextStage.stage_code}`)
        )
      } else {
        // Final stage — mark approved
        await admin
          .from("leave_requests")
          .update({
            status: "approved",
            approval_stage: "completed",
            current_stage_code: "completed",
            approved_by: approverId,
            approved_at: now,
            hr_decision_at: now,
            lead_reconfirm_required: false,
          })
          .eq("id", leaveRequestId!)

        steps.push(ok(`approve_stage_${currentStageOrder}`, `✓ ${stageCode} approved (FINAL) → leave now APPROVED`))
        break
      }

      currentStageOrder = nextStageOrder
    }

    // ── Step 7: Verify final state ──────────────────────────────────────────────
    const { data: finalRequest } = await admin
      .from("leave_requests")
      .select("status, current_stage_code, approval_stage")
      .eq("id", leaveRequestId!)
      .single()

    if (finalRequest) {
      const approved = finalRequest.status === "approved"
      steps.push(
        approved
          ? ok("verify_final_state", `status=${finalRequest.status} stage=${finalRequest.current_stage_code}`)
          : err(
              "verify_final_state",
              `Expected approved, got status=${finalRequest.status} stage=${finalRequest.current_stage_code}`
            )
      )
    }

    // ── Step 8: Cleanup (optional) ──────────────────────────────────────────────
    if (cleanup && leaveRequestId) {
      await admin.from("leave_approvals").delete().eq("leave_request_id", leaveRequestId)
      await admin.from("leave_requests").delete().eq("id", leaveRequestId)
      steps.push(ok("cleanup", `Deleted test request ${leaveRequestId}`))
    }

    const allOk = steps.every((s) => s.status !== "error")
    return NextResponse.json({ ok: allOk, leave_request_id: cleanup ? null : leaveRequestId, steps })
  } catch (error: unknown) {
    // cleanup on unexpected error
    if (cleanup && leaveRequestId) {
      try {
        await admin.from("leave_approvals").delete().eq("leave_request_id", leaveRequestId)
      } catch {
        /* ignore */
      }
      try {
        await admin.from("leave_requests").delete().eq("id", leaveRequestId)
      } catch {
        /* ignore */
      }
    }
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ ok: false, error: message, steps }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`dev-leave-flow-test:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
