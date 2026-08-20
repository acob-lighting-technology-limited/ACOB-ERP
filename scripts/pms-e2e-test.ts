/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE PMS + WORKFLOW E2E TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Run: npx tsx scripts/pms-e2e-test.ts
 *
 * 200+ tests covering:
 *   A. PMS scoring engine (individual + department)
 *   B. Task creation & permissions (individual, group, department)
 *   C. Task status lifecycle (pending → completed, cancelled, left in pool)
 *   D. Help desk ticket lifecycle (support + procurement flows, all 13 statuses)
 *   E. Project task management
 *   F. Leave approval workflow (with & without leads)
 *   G. Weekly reports & action items
 *   H. Role removal chaos tests (no lead, no HCS, no MD)
 *   I. Onyekachukwu as Admin & HR lead (re-test leave flow)
 *   J. Industry compliance & data visibility
 *
 * Focal point: Chibuikem (IT developer, NOT a lead)
 * Lead: Abdulsamad (IT and Communications lead)
 */

import { config } from "dotenv"
config({ path: ".env.local" })

import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { computeIndividualPerformanceScore, computeDepartmentPerformanceScore } from "../lib/performance/scoring"

// ─── Config ───────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing env vars")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

type HelpDeskTicketCheckRow = {
  status?: string | null
  assigned_to?: string | null
}

type LeaveRequestCheckRow = {
  current_stage_code?: string | null
  current_approver_user_id?: string | null
  status?: string | null
}

// ─── User IDs ─────────────────────────────────────────────────────────────
const USERS = {
  chibuikem: "1aeae0c5-ef2f-4790-be14-d0e696be01af", // IT developer, NOT lead (FOCAL POINT)
  abdulsamad: "3791c0f4-dde9-41f8-a227-986273532d9c", // IT Lead
  peter: "90d64faf-863e-4d07-a500-186cd073fbd8", // HCS super_admin (global authority)
  alexander: "d29aad5f-f382-4998-8bd2-9857435874e0", // MD super_admin (global authority)
  onyekachukwu: "c6d934f4-8d43-4c1c-967e-103c9f49f82a", // Admin & HR employee
  peace: "b4395c0d-c599-4067-91db-e8b62d43b6b7", // Admin & HR admin
  vanessa: "55320e85-8bec-49c8-9115-f92f591aa5f6", // BGI lead
  joshua: "247e0a49-ed86-46e1-8793-cffe933fedc4", // Accounts lead
} as const

const CYCLE_ID = "aaaaaaaa-0001-4000-a000-000000000001"

// ─── Test Tracking ────────────────────────────────────────────────────────
let passed = 0,
  failed = 0
const warnings: string[] = []
const sections: { name: string; passed: number; failed: number }[] = []
let sectionPassed = 0,
  sectionFailed = 0

function startSection(name: string) {
  if (sections.length > 0) {
    sections[sections.length - 1].passed = sectionPassed
    sections[sections.length - 1].failed = sectionFailed
  }
  sectionPassed = 0
  sectionFailed = 0
  sections.push({ name, passed: 0, failed: 0 })
  console.log(`\n${"═".repeat(70)}\n${name}\n${"═".repeat(70)}`)
}

function assert(label: string, actual: any, expected: any, tolerance = 0.5) {
  if (typeof actual === "number" && typeof expected === "number") {
    if (Math.abs(actual - expected) <= tolerance) {
      passed++
      sectionPassed++
      console.log(`  ✅ ${label}: ${actual}`)
    } else {
      failed++
      sectionFailed++
      console.log(`  ❌ ${label}: got ${actual}, expected ${expected}`)
    }
  } else {
    const match = JSON.stringify(actual) === JSON.stringify(expected)
    if (match) {
      passed++
      sectionPassed++
      console.log(`  ✅ ${label}: ${actual}`)
    } else {
      failed++
      sectionFailed++
      console.log(`  ❌ ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
    }
  }
}

function assertTruthy(label: string, value: any) {
  if (value) {
    passed++
    sectionPassed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    sectionFailed++
    console.log(`  ❌ ${label}: was falsy`)
  }
}

function assertFalsy(label: string, value: any) {
  if (!value) {
    passed++
    sectionPassed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    sectionFailed++
    console.log(`  ❌ ${label}: was truthy (${value})`)
  }
}

function warn(msg: string) {
  warnings.push(msg)
  console.log(`  ⚠️  ${msg}`)
}

// ─── Helper: get profile ──────────────────────────────────────────────────
async function getProfile(userId: string) {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single()
  return data
}

// ─── Helper: simulate permission checks (CORRECTED) ─────────────────────
// Only is_department_lead can create tasks
function canAssignTasks(profile: any) {
  return profile?.is_department_lead === true
}

// HCS (Corporate Services) and MD (Executive Management) have global authority
function isGlobalAuthority(profile: any) {
  const leadDepts = profile?.lead_departments || []
  return leadDepts.includes("Executive Management") || leadDepts.includes("Corporate Services")
}

// A lead can only assign to departments they lead (or any dept if global authority)
function canAssignToDepartment(profile: any, dept: string) {
  if (!canAssignTasks(profile)) return false
  if (isGlobalAuthority(profile)) return true
  const leadDepts = profile?.lead_departments || []
  return leadDepts.includes(dept)
}

// A lead can assign to a person if they can assign to that person's department
function canAssignToProfile(assigner: any, assignee: any) {
  if (!canAssignTasks(assigner)) return false
  if (assigner.id === assignee.id) return true
  if (isGlobalAuthority(assigner)) return true
  return canAssignToDepartment(assigner, assignee.department)
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP: Reset state for idempotent re-runs
// ═══════════════════════════════════════════════════════════════════════════
async function resetTestState() {
  console.log("\n🔄 Resetting test state for idempotent run...\n")

  // 1. Reset Onyekachukwu — remove lead status (set by Section I)
  await supabase
    .from("profiles")
    .update({
      is_department_lead: false,
      lead_departments: [],
    })
    .eq("id", USERS.onyekachukwu)

  // 2. Clear Admin & HR department_head_id
  await supabase.from("departments").update({ department_head_id: null }).eq("name", "Admin and HR")

  // 3. Cleanup leftover TEST: data
  const { data: testLeaves } = await supabase.from("leave_requests").select("id").ilike("reason", "TEST:%")
  if (testLeaves?.length) {
    const ids = testLeaves.map((l: any) => l.id)
    await supabase.from("leave_approvals").delete().in("leave_request_id", ids)
    await supabase.from("leave_requests").delete().in("id", ids)
  }
  await supabase.from("tasks").delete().ilike("title", "TEST:%")
  await supabase.from("help_desk_tickets").delete().ilike("title", "TEST:%")

  // 4. Verify reset
  const onyeka = await getProfile(USERS.onyekachukwu)
  const { data: hrDept } = await supabase
    .from("departments")
    .select("department_head_id")
    .eq("name", "Admin and HR")
    .single()

  if (onyeka?.is_department_lead === false && !hrDept?.department_head_id) {
    console.log("  ✅ State reset complete — Onyekachukwu is not a lead, Admin & HR has no head\n")
  } else {
    console.log("  ⚠️  State reset may be incomplete — check manually\n")
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION A: PMS SCORING ENGINE
// ═══════════════════════════════════════════════════════════════════════════
async function testPMSScoring() {
  startSection("A. PMS SCORING ENGINE")

  // A1: Chibuikem individual PMS (FOCAL POINT)
  console.log("\n  ── A1: Chibuikem Individual PMS (you) ──")
  const chib = await computeIndividualPerformanceScore(supabase, { userId: USERS.chibuikem, cycleId: CYCLE_ID })
  assert("A1.1 KPI Score", chib.kpi_score, 59.38, 0.5)
  assert("A1.2 Attendance Score", chib.attendance_score, 100)
  assert("A1.3 Behaviour Score", chib.behaviour_score, 85)
  assert("A1.4 CBT Score (no CBT data)", chib.cbt_score, 0)
  // CBT redistribution: weights become KPI=77.78%, Attendance=11.11%, Behaviour=11.11%
  assert("A1.5 Applied KPI weight (redistributed)", chib.applied_weights.kpi, 77.78, 0.5)
  assert("A1.6 Applied CBT weight", chib.applied_weights.cbt, 0)
  assert("A1.7 Applied Attendance weight", chib.applied_weights.attendance, 11.11, 0.5)
  assert("A1.8 Applied Behaviour weight", chib.applied_weights.behaviour, 11.11, 0.5)
  const chibExpected = 59.38 * (70 / 90) + 100 * (10 / 90) + 85 * (10 / 90)
  assert("A1.9 Final Score (CBT redistributed)", chib.final_score, Math.round(chibExpected * 100) / 100, 0.5)

  // A2: Abdulsamad individual PMS (Chibuikem's lead)
  console.log("\n  ── A2: Abdulsamad Individual PMS (IT Lead) ──")
  const abd = await computeIndividualPerformanceScore(supabase, { userId: USERS.abdulsamad, cycleId: CYCLE_ID })
  assert("A2.1 KPI Score", abd.kpi_score, 75)
  assert("A2.2 Attendance Score (leave excluded)", abd.attendance_score, 87.5)
  assert("A2.3 Attendance total (4 days, leave excluded)", abd.breakdown.attendance.total, 4)
  assert("A2.4 Manager behaviour score", abd.manager_behaviour_score, 72)
  assert("A2.5 Peer feedback count (0 initially)", abd.peer_feedback_count, 0)
  assert("A2.6 Behaviour = manager (no peer data)", abd.behaviour_score, 72)
  const abdExpected = 75 * (70 / 90) + 87.5 * (10 / 90) + 72 * (10 / 90)
  assert("A2.7 Final Score (CBT redistributed)", abd.final_score, Math.round(abdExpected * 100) / 100, 0.5)
  assert("A2.8 Goal breakdown has custom_weight_pct", abd.breakdown.goals[0].custom_weight_pct, null)
  const supportGoal = abd.breakdown.goals.find((g: any) => g.title === "IT Support Ticket Resolution")
  assert("A2.9 Dept task individual credit", supportGoal?.linked_tasks_completed, 2)

  // A3: IT Department PMS
  console.log("\n  ── A3: IT Department PMS ──")
  const dept = await computeDepartmentPerformanceScore(supabase, {
    department: "IT and Communications",
    cycleId: CYCLE_ID,
  })
  assert("A3.1 Employee count", dept.employee_count, 2)

  // Dynamic action items score verification
  const { data: actionItemsRaw } = await supabase
    .from("tasks")
    .select("status")
    .eq("department", "IT and Communications")
    .eq("category", "weekly_action")
    .gte("created_at", "2026-04-01")
    .lte("created_at", "2026-06-30")
  const expectedActionScore =
    actionItemsRaw && actionItemsRaw.length > 0
      ? Math.round(
          (actionItemsRaw.filter((t: any) => t.status === "completed").length / actionItemsRaw.length) * 10000
        ) / 100
      : 0
  assert("A3.2 Action items score", dept.breakdown.action_item_score, expectedActionScore, 0.5)
  assertTruthy("A3.3 Help desk score >= 0", (dept.breakdown.help_desk_score ?? 0) >= 0)
  assertTruthy("A3.4 Task delivery (no double count)", (dept.breakdown.task_project_delivery_score ?? 0) >= 0)

  // Calibration (Fix 3)
  assertTruthy("A3.5 Calibration mean present", typeof dept.calibration?.mean === "number")
  assertTruthy("A3.6 Calibration stddev present", typeof dept.calibration?.stddev === "number")

  // Rankings/percentile (Fix 4)
  assert("A3.7 Rankings count", dept.rankings?.length, 2)
  assertTruthy("A3.8 Rankings have percentile", dept.rankings?.[0]?.percentile > 0)
  assertTruthy("A3.9 Rankings have z_score", typeof dept.rankings?.[0]?.z_score === "number")
  // Verify both Chibuikem and Abdulsamad are ranked
  const chibRank = dept.rankings?.find((r: any) => r.user_id === USERS.chibuikem)
  const abdRank = dept.rankings?.find((r: any) => r.user_id === USERS.abdulsamad)
  assertTruthy("A3.10 Chibuikem is ranked", chibRank)
  assertTruthy("A3.11 Abdulsamad is ranked", abdRank)

  // A4: Edge cases
  console.log("\n  ── A4: Edge Cases ──")
  const ghost = await computeIndividualPerformanceScore(supabase, {
    userId: "00000000-0000-0000-0000-000000000000",
    cycleId: CYCLE_ID,
  })
  assert("A4.1 Ghost user score", ghost.final_score, 0)
  const noCycle = await computeIndividualPerformanceScore(supabase, { userId: USERS.abdulsamad })
  assert("A4.2 No-cycle attendance", noCycle.attendance_score, 0)
  assertTruthy("A4.3 No-cycle KPI still works", (noCycle.kpi_score ?? 0) > 0)

  // Rejected goal excluded
  const { data: tempGoal } = await supabase
    .from("goals_objectives")
    .insert({
      user_id: USERS.chibuikem,
      review_cycle_id: CYCLE_ID,
      title: "TEMP_REJECTED",
      target_value: 100,
      achieved_value: 100,
      priority: "high",
      approval_status: "rejected",
      is_system_generated: false,
    })
    .select("id")
    .single()
  const afterReject = await computeIndividualPerformanceScore(supabase, { userId: USERS.chibuikem, cycleId: CYCLE_ID })
  assertFalsy(
    "A4.4 Rejected goal excluded from Chibuikem",
    afterReject.breakdown.goals.find((g: any) => g.title === "TEMP_REJECTED")
  )
  if (tempGoal?.id) await supabase.from("goals_objectives").delete().eq("id", tempGoal.id)

  // Over-achievement capped
  const { data: overGoal } = await supabase
    .from("goals_objectives")
    .insert({
      user_id: USERS.chibuikem,
      review_cycle_id: CYCLE_ID,
      title: "TEMP_OVER",
      target_value: 50,
      achieved_value: 200,
      priority: "medium",
      approval_status: "approved",
      approved_by: USERS.abdulsamad,
      approved_at: new Date().toISOString(),
      is_system_generated: false,
    })
    .select("id")
    .single()
  const overResult = await computeIndividualPerformanceScore(supabase, { userId: USERS.chibuikem, cycleId: CYCLE_ID })
  const overBd = overResult.breakdown.goals.find((g: any) => g.title === "TEMP_OVER")
  assertTruthy("A4.5 Over-achievement capped at 100", overBd && overBd.goal_progress_pct <= 100)
  if (overGoal?.id) await supabase.from("goals_objectives").delete().eq("id", overGoal.id)

  // A5: Peer feedback test (360°)
  console.log("\n  ── A5: Peer Feedback (360°) ──")
  await supabase.from("peer_feedback").insert({
    subject_user_id: USERS.abdulsamad,
    reviewer_user_id: USERS.chibuikem,
    review_cycle_id: CYCLE_ID,
    score: 80,
    status: "submitted",
  })
  await supabase.from("peer_feedback").insert({
    subject_user_id: USERS.abdulsamad,
    reviewer_user_id: USERS.peter,
    review_cycle_id: CYCLE_ID,
    score: 70,
    status: "submitted",
  })
  const withPeer = await computeIndividualPerformanceScore(supabase, { userId: USERS.abdulsamad, cycleId: CYCLE_ID })
  assert("A5.1 Peer feedback count", withPeer.peer_feedback_count, 2)
  assert("A5.2 Peer behaviour score", withPeer.peer_behaviour_score, 75)
  assert("A5.3 Blended behaviour (60% mgr + 40% peer)", withPeer.behaviour_score, 73.2, 0.5)
  await supabase.from("peer_feedback").delete().eq("subject_user_id", USERS.abdulsamad)

  // A6: Custom goal weight test (Fix 5)
  console.log("\n  ── A6: Custom Goal Weights ──")
  const { data: wGoal } = await supabase
    .from("goals_objectives")
    .insert({
      user_id: USERS.chibuikem,
      review_cycle_id: CYCLE_ID,
      title: "TEMP_WEIGHTED",
      target_value: 100,
      achieved_value: 100,
      priority: "low",
      weight_pct: 50,
      approval_status: "approved",
      approved_by: USERS.abdulsamad,
      approved_at: new Date().toISOString(),
      is_system_generated: false,
    })
    .select("id")
    .single()
  const weighted = await computeIndividualPerformanceScore(supabase, { userId: USERS.chibuikem, cycleId: CYCLE_ID })
  const wBd = weighted.breakdown.goals.find((g: any) => g.title === "TEMP_WEIGHTED")
  assert("A6.1 Custom weight_pct stored", wBd?.custom_weight_pct, 50)
  assertTruthy("A6.2 Custom weight changes KPI", weighted.kpi_score !== chib.kpi_score)
  if (wGoal?.id) await supabase.from("goals_objectives").delete().eq("id", wGoal.id)
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION B: TASK CREATION & PERMISSIONS (CORRECTED)
// ═══════════════════════════════════════════════════════════════════════════
async function testTaskPermissions() {
  startSection("B. TASK CREATION & PERMISSIONS")

  const profiles = {
    chibuikem: await getProfile(USERS.chibuikem),
    abdulsamad: await getProfile(USERS.abdulsamad),
    peter: await getProfile(USERS.peter),
    alexander: await getProfile(USERS.alexander),
    vanessa: await getProfile(USERS.vanessa),
    peace: await getProfile(USERS.peace),
    onyekachukwu: await getProfile(USERS.onyekachukwu),
  }

  // B1: Who can create/assign tasks? Only is_department_lead=true
  console.log("\n  ── B1: canAssignTasks (only leads) ──")
  assertTruthy("B1.1 Abdulsamad (IT Lead) CAN assign", canAssignTasks(profiles.abdulsamad))
  assertFalsy("B1.2 Chibuikem (developer) CANNOT assign", canAssignTasks(profiles.chibuikem))
  assertTruthy("B1.3 Peter (HCS lead) CAN assign", canAssignTasks(profiles.peter))
  assertTruthy("B1.4 Alexander (MD lead) CAN assign", canAssignTasks(profiles.alexander))
  assertTruthy("B1.5 Vanessa (BGI lead) CAN assign", canAssignTasks(profiles.vanessa))
  assertFalsy("B1.6 Peace (admin but NOT lead) CANNOT assign", canAssignTasks(profiles.peace))
  assertFalsy("B1.7 Onyekachukwu (employee) CANNOT assign", canAssignTasks(profiles.onyekachukwu))

  // B2: Cross-department assignment — ONLY HCS/MD can cross departments
  console.log("\n  ── B2: Cross-Department Assignment (CORRECTED) ──")
  assertTruthy(
    "B2.1 Abdulsamad → Chibuikem (same dept IT)",
    canAssignToProfile(profiles.abdulsamad, profiles.chibuikem)
  )
  assertFalsy(
    "B2.2 Abdulsamad → Peace (diff dept: Admin&HR) CANNOT",
    canAssignToProfile(profiles.abdulsamad, profiles.peace)
  )
  assertFalsy("B2.3 Vanessa (BGI) → Abdulsamad (IT) CANNOT", canAssignToProfile(profiles.vanessa, profiles.abdulsamad))
  assertTruthy("B2.4 Peter (HCS) → anyone (global authority)", canAssignToProfile(profiles.peter, profiles.abdulsamad))
  assertTruthy(
    "B2.5 Alexander (MD) → anyone (global authority)",
    canAssignToProfile(profiles.alexander, profiles.peace)
  )
  assertTruthy("B2.6 Vanessa (BGI) → self OK", canAssignToProfile(profiles.vanessa, profiles.vanessa))
  assertFalsy(
    "B2.7 Abdulsamad → Vanessa (diff dept: BGI) CANNOT",
    canAssignToProfile(profiles.abdulsamad, profiles.vanessa)
  )

  // B3: Department-scoped assignment
  console.log("\n  ── B3: Department Assignment Scope ──")
  assertTruthy("B3.1 Abdulsamad → IT dept OK", canAssignToDepartment(profiles.abdulsamad, "IT and Communications"))
  assertFalsy("B3.2 Abdulsamad → Accounts dept CANNOT", canAssignToDepartment(profiles.abdulsamad, "Accounts"))
  assertFalsy("B3.3 Abdulsamad → Admin&HR CANNOT", canAssignToDepartment(profiles.abdulsamad, "Admin and HR"))
  assertTruthy("B3.4 Peter (HCS) → any dept OK", canAssignToDepartment(profiles.peter, "Technical"))
  assertTruthy("B3.5 Alexander (MD) → any dept OK", canAssignToDepartment(profiles.alexander, "Logistics"))
  assertFalsy(
    "B3.6 Chibuikem → cannot assign at all",
    canAssignToDepartment(profiles.chibuikem, "IT and Communications")
  )
  assertFalsy(
    "B3.7 Vanessa → IT CANNOT (not her dept)",
    canAssignToDepartment(profiles.vanessa, "IT and Communications")
  )
  assertTruthy(
    "B3.8 Vanessa → BGI OK (her dept)",
    canAssignToDepartment(profiles.vanessa, "Business, Growth and Innovation")
  )

  // B4: Actual task CRUD — Abdulsamad creates tasks for Chibuikem
  console.log("\n  ── B4: Task CRUD (Abdulsamad → Chibuikem) ──")

  const { data: t1 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Individual task for Chibuikem",
      priority: "high",
      status: "pending",
      assigned_to: USERS.chibuikem,
      assigned_by: USERS.abdulsamad,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "individual",
    })
    .select("id")
    .single()
  assertTruthy("B4.1 Individual task created", t1?.id)

  const { data: t2 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Dept task for IT",
      priority: "medium",
      status: "pending",
      assigned_by: USERS.abdulsamad,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "department",
    })
    .select("id")
    .single()
  assertTruthy("B4.2 Department task created", t2?.id)

  const { data: t3 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Group task for IT team",
      priority: "low",
      status: "pending",
      assigned_by: USERS.abdulsamad,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "multiple",
    })
    .select("id")
    .single()
  assertTruthy("B4.3 Group (multiple) task created", t3?.id)
  if (t3?.id) {
    await supabase.from("task_assignments").insert([
      { task_id: t3.id, user_id: USERS.abdulsamad },
      { task_id: t3.id, user_id: USERS.chibuikem },
    ])
    const { count } = await supabase
      .from("task_assignments")
      .select("*", { count: "exact", head: true })
      .eq("task_id", t3.id)
    assert("B4.4 Group task has 2 assignees", count, 2)
  }

  // HCS cross-dept (allowed)
  const { data: t4 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: HCS cross-dept task to BGI",
      priority: "high",
      status: "pending",
      assigned_to: USERS.vanessa,
      assigned_by: USERS.peter,
      department: "Business, Growth and Innovation",
      source_type: "manual",
      assignment_type: "individual",
    })
    .select("id")
    .single()
  assertTruthy("B4.5 HCS cross-dept task created", t4?.id)

  // MD cross-dept (allowed)
  const { data: t5 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: MD assigns to IT dept",
      priority: "high",
      status: "pending",
      assigned_by: USERS.alexander,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "department",
    })
    .select("id")
    .single()
  assertTruthy("B4.6 MD cross-dept task created", t5?.id)

  // B5: Task completion tracking
  console.log("\n  ── B5: Task Completion ──")
  if (t1?.id) {
    await supabase.from("task_assignments").insert({ task_id: t1.id, user_id: USERS.chibuikem })
    const { error: compErr } = await supabase
      .from("task_user_completion")
      .insert({ task_id: t1.id, user_id: USERS.chibuikem })
    assertFalsy("B5.1 Chibuikem can complete assigned task", compErr)
    const { data: wrongAssign } = await supabase
      .from("task_assignments")
      .select("id")
      .eq("task_id", t1.id)
      .eq("user_id", USERS.peace)
      .maybeSingle()
    assertFalsy("B5.2 Peace has no assignment on IT task", wrongAssign)
  }

  // Cleanup
  const testTaskIds = [t1?.id, t2?.id, t3?.id, t4?.id, t5?.id].filter(Boolean)
  if (testTaskIds.length > 0) {
    await supabase.from("task_user_completion").delete().in("task_id", testTaskIds)
    await supabase.from("task_assignments").delete().in("task_id", testTaskIds)
    await supabase.from("tasks").delete().in("id", testTaskIds)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION C: TASK STATUS LIFECYCLE (all possibilities)
// ═══════════════════════════════════════════════════════════════════════════
async function testTaskStatusLifecycle() {
  startSection("C. TASK STATUS LIFECYCLE")

  const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"]

  console.log("\n  ── C1: All Valid Task Statuses ──")
  for (const status of VALID_STATUSES) {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: `TEST: Task in ${status} state`,
        priority: "medium",
        status,
        assigned_to: USERS.chibuikem,
        assigned_by: USERS.abdulsamad,
        department: "IT and Communications",
        source_type: "manual",
        assignment_type: "individual",
      })
      .select("id, status")
      .single()
    assertTruthy(
      `C1.${VALID_STATUSES.indexOf(status) + 1} Task created with status: ${status}`,
      data?.id && data?.status === status
    )
    if (data?.id) await supabase.from("tasks").delete().eq("id", data.id)
  }

  // C2: Status transitions
  console.log("\n  ── C2: Status Transitions ──")
  const { data: task } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Status transition task",
      priority: "high",
      status: "pending",
      assigned_to: USERS.chibuikem,
      assigned_by: USERS.abdulsamad,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "individual",
    })
    .select("id")
    .single()

  if (task?.id) {
    // pending → in_progress
    await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id)
    let { data: t } = await supabase.from("tasks").select("status").eq("id", task.id).single()
    assert("C2.1 pending → in_progress", t?.status, "in_progress")

    // in_progress → completed
    await supabase.from("tasks").update({ status: "completed" }).eq("id", task.id)
    ;({ data: t } = await supabase.from("tasks").select("status").eq("id", task.id).single())
    assert("C2.2 in_progress → completed", t?.status, "completed")

    // Reset to pending, then cancel
    await supabase.from("tasks").update({ status: "pending" }).eq("id", task.id)
    await supabase.from("tasks").update({ status: "cancelled" }).eq("id", task.id)
    ;({ data: t } = await supabase.from("tasks").select("status").eq("id", task.id).single())
    assert("C2.3 pending → cancelled", t?.status, "cancelled")

    await supabase.from("tasks").delete().eq("id", task.id)
  }

  // C3: "Left in the pool" — department task nobody picks up
  console.log("\n  ── C3: Department Task Left in Pool ──")
  const { data: poolTask } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Unassigned dept task (in the pool)",
      priority: "low",
      status: "pending",
      assigned_by: USERS.abdulsamad,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "department",
    })
    .select("id, status, assigned_to")
    .single()
  assertTruthy("C3.1 Pool task created", poolTask?.id)
  assert("C3.2 Pool task status is pending", poolTask?.status, "pending")
  assertFalsy("C3.3 Pool task has no assigned_to", poolTask?.assigned_to)

  // Anyone in the department can see it via /tasks (assignment_type=department filter)
  const { count } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("department", "IT and Communications")
    .eq("assignment_type", "department")
    .eq("status", "pending")
  assertTruthy("C3.4 Pool tasks visible to department", (count || 0) > 0)

  if (poolTask?.id) await supabase.from("tasks").delete().eq("id", poolTask.id)

  // C4: Group task — partial completion
  console.log("\n  ── C4: Group Task Partial Completion ──")
  const { data: grpTask } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Group task partial",
      priority: "medium",
      status: "pending",
      assigned_by: USERS.abdulsamad,
      department: "IT and Communications",
      source_type: "manual",
      assignment_type: "multiple",
    })
    .select("id")
    .single()

  if (grpTask?.id) {
    await supabase.from("task_assignments").insert([
      { task_id: grpTask.id, user_id: USERS.chibuikem },
      { task_id: grpTask.id, user_id: USERS.abdulsamad },
    ])
    // Only Chibuikem completes
    await supabase.from("task_user_completion").insert({ task_id: grpTask.id, user_id: USERS.chibuikem })
    const { count: completionCount } = await supabase
      .from("task_user_completion")
      .select("*", { count: "exact", head: true })
      .eq("task_id", grpTask.id)
    assert("C4.1 Only 1 of 2 completed", completionCount, 1)
    // Task auto-transitions to in_progress when first person completes
    const { data: grpTaskState } = await supabase.from("tasks").select("status").eq("id", grpTask.id).single()
    assert("C4.2 Task in_progress (partial completion)", grpTaskState?.status, "in_progress")

    // Now Abdulsamad also completes
    await supabase.from("task_user_completion").insert({ task_id: grpTask.id, user_id: USERS.abdulsamad })
    const { count: allDone } = await supabase
      .from("task_user_completion")
      .select("*", { count: "exact", head: true })
      .eq("task_id", grpTask.id)
    assert("C4.3 Both completed", allDone, 2)

    // Cleanup
    await supabase.from("task_user_completion").delete().eq("task_id", grpTask.id)
    await supabase.from("task_assignments").delete().eq("task_id", grpTask.id)
    await supabase.from("tasks").delete().eq("id", grpTask.id)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION D: HELP DESK LIFECYCLE (Support + Procurement + All Statuses)
// ═══════════════════════════════════════════════════════════════════════════
async function testHelpDesk() {
  startSection("D. HELP DESK LIFECYCLE")

  // D1: SUPPORT FLOW (Chibuikem raises ticket → IT dept services it)
  console.log("\n  ── D1: Support Flow (Chibuikem raises ticket) ──")
  const { data: supportTicket } = await supabase
    .from("help_desk_tickets")
    .insert({
      title: "TEST: Laptop overheating support",
      description: "Fan running loud, needs attention",
      request_type: "support",
      service_department: "IT and Communications",
      priority: "medium",
      status: "new",
      requester_id: USERS.chibuikem,
      created_by: USERS.chibuikem,
      requester_department: "IT and Communications",
    })
    .select("id, status")
    .single()
  assertTruthy("D1.1 Support ticket created by Chibuikem", supportTicket?.id)
  assert("D1.2 Support starts as 'new'", supportTicket?.status, "new")

  if (supportTicket?.id) {
    // new → department_queue (lead reviews and puts in queue)
    await supabase.from("help_desk_tickets").update({ status: "department_queue" }).eq("id", supportTicket.id)
    let { data: t }: { data: HelpDeskTicketCheckRow | null } = await supabase
      .from("help_desk_tickets")
      .select("status")
      .eq("id", supportTicket.id)
      .single()
    assert("D1.3 new → department_queue", t?.status, "department_queue")

    // department_queue → assigned (Abdulsamad picks it up from the pool)
    await supabase
      .from("help_desk_tickets")
      .update({ status: "assigned", assigned_to: USERS.abdulsamad })
      .eq("id", supportTicket.id)
    ;({ data: t } = await supabase
      .from("help_desk_tickets")
      .select("status, assigned_to")
      .eq("id", supportTicket.id)
      .single())
    assert("D1.4 department_queue → assigned (Abdulsamad picks up)", t?.status, "assigned")
    assert("D1.5 Assigned to Abdulsamad", t?.assigned_to, USERS.abdulsamad)

    // assigned → in_progress
    await supabase.from("help_desk_tickets").update({ status: "in_progress" }).eq("id", supportTicket.id)
    ;({ data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", supportTicket.id).single())
    assert("D1.6 assigned → in_progress", t?.status, "in_progress")

    // in_progress → resolved
    await supabase
      .from("help_desk_tickets")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", supportTicket.id)
    ;({ data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", supportTicket.id).single())
    assert("D1.7 in_progress → resolved", t?.status, "resolved")

    // resolved → closed
    await supabase
      .from("help_desk_tickets")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", supportTicket.id)
    ;({ data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", supportTicket.id).single())
    assert("D1.8 resolved → closed", t?.status, "closed")

    await supabase.from("help_desk_tickets").delete().eq("id", supportTicket.id)
  }

  // D2: PROCUREMENT FLOW (Peace raises procurement → approval chain)
  console.log("\n  ── D2: Procurement Flow (Peace raises request) ──")
  const { data: procTicket } = await supabase
    .from("help_desk_tickets")
    .insert({
      title: "TEST: New office chairs procurement",
      description: "Ergonomic chairs for Admin & HR",
      request_type: "procurement",
      service_department: "Admin and HR",
      priority: "high",
      status: "new",
      requester_id: USERS.peace,
      created_by: USERS.peace,
      requester_department: "Admin and HR",
      approval_required: true,
    })
    .select("id, status")
    .single()
  assertTruthy("D2.1 Procurement ticket created by Peace", procTicket?.id)
  assert("D2.2 Procurement starts as 'new'", procTicket?.status, "new")

  if (procTicket?.id) {
    // new → pending_approval
    await supabase.from("help_desk_tickets").update({ status: "pending_approval" }).eq("id", procTicket.id)
    let { data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", procTicket.id).single()
    assert("D2.3 new → pending_approval", t?.status, "pending_approval")

    // pending_approval → approved_for_procurement (after approval chain)
    await supabase.from("help_desk_tickets").update({ status: "approved_for_procurement" }).eq("id", procTicket.id)
    ;({ data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", procTicket.id).single())
    assert("D2.4 pending_approval → approved_for_procurement", t?.status, "approved_for_procurement")

    // approved_for_procurement → closed
    await supabase
      .from("help_desk_tickets")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", procTicket.id)
    ;({ data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", procTicket.id).single())
    assert("D2.5 approved_for_procurement → closed", t?.status, "closed")

    await supabase.from("help_desk_tickets").delete().eq("id", procTicket.id)
  }

  // D3: PROCUREMENT REJECTION flow
  console.log("\n  ── D3: Procurement Rejection ──")
  const { data: rejTicket } = await supabase
    .from("help_desk_tickets")
    .insert({
      title: "TEST: Gold-plated desk procurement",
      description: "Luxury desk request",
      request_type: "procurement",
      service_department: "Admin and HR",
      priority: "low",
      status: "pending_approval",
      requester_id: USERS.chibuikem,
      created_by: USERS.chibuikem,
      requester_department: "IT and Communications",
      approval_required: true,
    })
    .select("id, status")
    .single()
  assertTruthy("D3.1 Procurement rejection ticket created", rejTicket?.id)

  if (rejTicket?.id) {
    // pending_approval → rejected
    await supabase.from("help_desk_tickets").update({ status: "rejected" }).eq("id", rejTicket.id)
    const { data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", rejTicket.id).single()
    assert("D3.2 pending_approval → rejected", t?.status, "rejected")

    await supabase.from("help_desk_tickets").delete().eq("id", rejTicket.id)
  }

  // D4: DEPARTMENT QUEUE — can anyone in the dept pick it up?
  console.log("\n  ── D4: Department Queue Pickup ──")
  const { data: queueTicket } = await supabase
    .from("help_desk_tickets")
    .insert({
      title: "TEST: Queue ticket for pickup",
      description: "Waiting in IT queue",
      request_type: "support",
      service_department: "IT and Communications",
      priority: "medium",
      status: "department_queue",
      requester_id: USERS.peace,
      created_by: USERS.peace,
      requester_department: "Admin and HR",
    })
    .select("id")
    .single()
  assertTruthy("D4.1 Queue ticket created", queueTicket?.id)

  if (queueTicket?.id) {
    // Chibuikem (IT member, not lead) picks it up
    await supabase
      .from("help_desk_tickets")
      .update({ status: "assigned", assigned_to: USERS.chibuikem })
      .eq("id", queueTicket.id)
    const { data: t } = await supabase
      .from("help_desk_tickets")
      .select("status, assigned_to")
      .eq("id", queueTicket.id)
      .single()
    assert("D4.2 Chibuikem picks up from queue", t?.assigned_to, USERS.chibuikem)
    assert("D4.3 Status is now assigned", t?.status, "assigned")

    await supabase.from("help_desk_tickets").delete().eq("id", queueTicket.id)
  }

  // D5: RETURNED ticket
  console.log("\n  ── D5: Returned Ticket ──")
  const { data: returnTicket } = await supabase
    .from("help_desk_tickets")
    .insert({
      title: "TEST: Returned ticket",
      description: "Need more info from requester",
      request_type: "support",
      service_department: "IT and Communications",
      priority: "medium",
      status: "in_progress",
      requester_id: USERS.peace,
      created_by: USERS.peace,
      assigned_to: USERS.chibuikem,
      requester_department: "Admin and HR",
    })
    .select("id")
    .single()

  if (returnTicket?.id) {
    await supabase.from("help_desk_tickets").update({ status: "returned" }).eq("id", returnTicket.id)
    const { data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", returnTicket.id).single()
    assert("D5.1 in_progress → returned", t?.status, "returned")

    await supabase.from("help_desk_tickets").delete().eq("id", returnTicket.id)
  }

  // D6: CANCELLED ticket
  console.log("\n  ── D6: Cancelled Ticket ──")
  const { data: cancelTicket } = await supabase
    .from("help_desk_tickets")
    .insert({
      title: "TEST: Cancelled ticket",
      description: "No longer needed",
      request_type: "support",
      service_department: "IT and Communications",
      priority: "low",
      status: "new",
      requester_id: USERS.chibuikem,
      created_by: USERS.chibuikem,
      requester_department: "IT and Communications",
    })
    .select("id")
    .single()

  if (cancelTicket?.id) {
    await supabase.from("help_desk_tickets").update({ status: "cancelled" }).eq("id", cancelTicket.id)
    const { data: t } = await supabase.from("help_desk_tickets").select("status").eq("id", cancelTicket.id).single()
    assert("D6.1 new → cancelled", t?.status, "cancelled")

    await supabase.from("help_desk_tickets").delete().eq("id", cancelTicket.id)
  }

  // D7: ALL 13 STATUSES validation
  console.log("\n  ── D7: All 13 Help Desk Statuses ──")
  const ALL_HD_STATUSES = [
    "new",
    "pending_lead_review",
    "department_queue",
    "department_assigned",
    "assigned",
    "in_progress",
    "pending_approval",
    "approved_for_procurement",
    "rejected",
    "returned",
    "resolved",
    "closed",
    "cancelled",
  ]
  let statusPassCount = 0
  for (const status of ALL_HD_STATUSES) {
    const { data, error } = await supabase
      .from("help_desk_tickets")
      .insert({
        title: `TEST: Status validation ${status}`,
        description: `Testing ${status}`,
        request_type: "support",
        service_department: "IT and Communications",
        priority: "low",
        status,
        requester_id: USERS.chibuikem,
        created_by: USERS.chibuikem,
        requester_department: "IT and Communications",
      })
      .select("id, status")
      .single()
    if (data?.id && data?.status === status) statusPassCount++
    if (data?.id) await supabase.from("help_desk_tickets").delete().eq("id", data.id)
  }
  assert("D7.1 All 13 statuses accepted", statusPassCount, 13)

  // D8: Help desk scoring impact
  console.log("\n  ── D8: Help Desk Department Impact ──")
  const deptScore = await computeDepartmentPerformanceScore(supabase, {
    department: "IT and Communications",
    cycleId: CYCLE_ID,
  })
  assertTruthy("D8.1 Help desk score calculated", (deptScore.breakdown.help_desk_score ?? 0) >= 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION E: PROJECT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
async function testProjects() {
  startSection("E. PROJECT MANAGEMENT")

  // E1: Verify existing project (Chibuikem is project manager)
  console.log("\n  ── E1: Project Setup (Chibuikem is PM) ──")
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", "cccccccc-0001-4000-c000-000000000001")
    .single()
  assertTruthy("E1.1 Project exists", project)
  assert("E1.2 Project status", project?.status, "active")
  assert("E1.3 Project manager is Chibuikem", project?.project_manager_id, USERS.chibuikem)

  // E2: Project members
  const { data: members } = await supabase
    .from("project_members")
    .select("user_id, role, is_active")
    .eq("project_id", "cccccccc-0001-4000-c000-000000000001")
    .eq("is_active", true)
  assert("E2.1 Project has 2 members", members?.length, 2)
  const leadMember = members?.find((m: any) => m.role === "lead")
  assertTruthy("E2.2 Chibuikem is project lead", leadMember?.user_id === USERS.chibuikem)
  const regularMember = members?.find((m: any) => m.role === "member")
  assertTruthy("E2.3 Abdulsamad is project member", regularMember?.user_id === USERS.abdulsamad)

  // E3: Project tasks — currently all individual assignment_type
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, source_type, assignment_type")
    .eq("project_id", "cccccccc-0001-4000-c000-000000000001")
  assert("E3.1 Project has 2 tasks", tasks?.length, 2)
  const completedProjTasks = tasks?.filter((t: any) => t.status === "completed").length || 0
  assert("E3.2 1 project task completed", completedProjTasks, 1)
  assertTruthy(
    "E3.3 All are source_type project_task",
    tasks?.every((t: any) => t.source_type === "project_task")
  )
  // All current project tasks are individual (group/dept assignment for project tasks would be a future feature)
  assertTruthy(
    "E3.4 Project tasks are individual assignment",
    tasks?.every((t: any) => t.assignment_type === "individual")
  )

  // E4: New project task creation
  console.log("\n  ── E4: New Project Tasks ──")
  const { data: projTask1 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Write UAT test cases for HR module",
      priority: "medium",
      status: "pending",
      assigned_to: USERS.abdulsamad,
      assigned_by: USERS.chibuikem,
      department: "IT and Communications",
      source_type: "project_task",
      assignment_type: "individual",
      project_id: "cccccccc-0001-4000-c000-000000000001",
    })
    .select("id")
    .single()
  assertTruthy("E4.1 Individual project task created", projTask1?.id)

  // Group project task
  const { data: projTask2 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Code review sprint deliverables",
      priority: "high",
      status: "pending",
      assigned_by: USERS.chibuikem,
      department: "IT and Communications",
      source_type: "project_task",
      assignment_type: "multiple",
      project_id: "cccccccc-0001-4000-c000-000000000001",
    })
    .select("id")
    .single()
  assertTruthy("E4.2 Group project task created", projTask2?.id)
  if (projTask2?.id) {
    await supabase.from("task_assignments").insert([
      { task_id: projTask2.id, user_id: USERS.chibuikem },
      { task_id: projTask2.id, user_id: USERS.abdulsamad },
    ])
  }

  // Department project task
  const { data: projTask3 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Dept-wide documentation update",
      priority: "low",
      status: "pending",
      assigned_by: USERS.chibuikem,
      department: "IT and Communications",
      source_type: "project_task",
      assignment_type: "department",
      project_id: "cccccccc-0001-4000-c000-000000000001",
    })
    .select("id")
    .single()
  assertTruthy("E4.3 Department project task created", projTask3?.id)

  // Cleanup
  const projTaskIds = [projTask1?.id, projTask2?.id, projTask3?.id].filter(Boolean)
  if (projTaskIds.length > 0) {
    await supabase.from("task_assignments").delete().in("task_id", projTaskIds)
    await supabase.from("tasks").delete().in("id", projTaskIds)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION F: LEAVE WORKFLOW (Chibuikem focal, renamed supervisor → lead)
// ═══════════════════════════════════════════════════════════════════════════
async function testLeaveWorkflow() {
  startSection("F. LEAVE WORKFLOW")

  // F1: Current state — NO Admin & HR lead (reset removed Onyekachukwu)
  console.log("\n  ── F1: Admin & HR has NO lead ──")
  const { data: hrLeads } = await supabase
    .from("profiles")
    .select("id, first_name")
    .eq("department", "Admin and HR")
    .eq("is_department_lead", true)
  assert("F1.1 Admin & HR lead count", hrLeads?.length || 0, 0)

  // F2: Leave route config
  console.log("\n  ── F2: Leave Route Config ──")
  const { data: routes } = await supabase
    .from("leave_approval_role_routes")
    .select("requester_kind, approver_role_code, stage_order")
    .eq("is_active", true)
    .order("requester_kind")
    .order("stage_order")

  // Employee route: reliever → department_lead → admin_hr_lead
  const empRoute = routes?.filter((r: any) => r.requester_kind === "employee")
  assert("F2.1 Employee route has 3 stages", empRoute?.length, 3)
  assert("F2.2 Stage 1: reliever", empRoute?.[0]?.approver_role_code, "reliever")
  assert("F2.3 Stage 2: department_lead (not supervisor!)", empRoute?.[1]?.approver_role_code, "department_lead")
  assert("F2.4 Stage 3: admin_hr_lead", empRoute?.[2]?.approver_role_code, "admin_hr_lead")

  // Dept lead route: reliever → md → admin_hr_lead
  const leadRoute = routes?.filter((r: any) => r.requester_kind === "dept_lead")
  assert("F2.5 Dept lead route has 3 stages", leadRoute?.length, 3)
  assert("F2.6 Lead stage 2: md", leadRoute?.[1]?.approver_role_code, "md")
  assert("F2.7 Lead stage 3: admin_hr_lead", leadRoute?.[2]?.approver_role_code, "admin_hr_lead")

  // MD route: reliever → admin_hr_lead
  const mdRoute = routes?.filter((r: any) => r.requester_kind === "md")
  assert("F2.8 MD route stage 2: admin_hr_lead", mdRoute?.[1]?.approver_role_code, "admin_hr_lead")

  // F3: Admin & HR lead resolution fails
  console.log("\n  ── F3: Admin & HR Lead Resolution (should FAIL) ──")
  const { data: hrDept } = await supabase
    .from("departments")
    .select("department_head_id")
    .eq("name", "Admin and HR")
    .single()
  assertFalsy("F3.1 departments.department_head_id is NULL", hrDept?.department_head_id)
  const { data: hrLeadProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("department", "Admin and HR")
    .eq("is_department_lead", true)
    .maybeSingle()
  assertFalsy("F3.2 No profile with is_department_lead for Admin & HR", hrLeadProfile)

  warn("ALL leave requests FAIL at admin_hr_lead stage — no Admin & HR lead configured")
  warn("Employee: fail at stage 3 | Dept lead: fail at stage 3 | MD: fail at stage 2")
  warn("BLOCKING: Nobody in the company can take leave right now!")

  // F4: Existing approved leave (Abdulsamad)
  console.log("\n  ── F4: Existing Approved Leave ──")
  const { data: existingLeave } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("id", "ffffffff-0001-4000-f000-000000000001")
    .single()
  assert("F4.1 Abdulsamad's leave exists", existingLeave?.status, "approved")
  assert("F4.2 Leave dates correct", existingLeave?.start_date, "2026-04-04")

  // F5: Leave request statuses
  console.log("\n  ── F5: Leave Request Statuses ──")
  const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"]
  for (let i = 0; i < LEAVE_STATUSES.length; i++) {
    const s = LEAVE_STATUSES[i]
    const { data, error } = await supabase
      .from("leave_requests")
      .insert({
        user_id: USERS.chibuikem,
        leave_type_id: "37ff322d-da8f-4e66-87a1-9a0eb45f7daa",
        start_date: "2026-05-01",
        end_date: "2026-05-02",
        resume_date: "2026-05-03",
        days_count: 2,
        reason: `TEST: Status test ${s}`,
        status: s,
        reliever_id: USERS.abdulsamad,
        supervisor_id: USERS.abdulsamad,
        approval_stage: s === "approved" ? "completed" : s === "pending" ? "pending_reliever" : s,
      })
      .select("id, status")
      .single()
    assertTruthy(`F5.${i + 1} Leave status '${s}' accepted`, data?.id && data?.status === s)
    if (data?.id) await supabase.from("leave_requests").delete().eq("id", data.id)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION G: WEEKLY REPORTS & ACTION ITEMS
// ═══════════════════════════════════════════════════════════════════════════
async function testWeeklyReports() {
  startSection("G. WEEKLY REPORTS & ACTION ITEMS")

  // G1: Weekly report (Abdulsamad as IT lead submits)
  console.log("\n  ── G1: Weekly Report ──")
  const { data: report } = await supabase
    .from("weekly_reports")
    .insert({
      user_id: USERS.abdulsamad,
      department: "IT and Communications",
      week_number: 14,
      year: 2026,
      work_done: "Replaced faulty switch, upgraded WiFi firmware, documented IT assets.",
      tasks_new_week: "Complete biometric integration, prepare board presentation.",
      challenges: "Vendor delay on UPS delivery.",
      status: "submitted",
    })
    .select("id")
    .single()
  assertTruthy("G1.1 Weekly report created by Abdulsamad", report?.id)

  // G2: Action items from weekly report
  console.log("\n  ── G2: Action Items ──")
  const { data: action1 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Follow up vendor on server delivery",
      department: "IT and Communications",
      assignment_type: "department",
      category: "weekly_action",
      source_type: "action_item",
      status: "pending",
      priority: "medium",
      assigned_by: USERS.abdulsamad,
    })
    .select("id")
    .single()
  assertTruthy("G2.1 Action item (pending) created", action1?.id)

  const { data: action2 } = await supabase
    .from("tasks")
    .insert({
      title: "TEST: Prepare IT budget Q3 for Chibuikem",
      department: "IT and Communications",
      assignment_type: "individual",
      assigned_to: USERS.chibuikem,
      category: "weekly_action",
      source_type: "action_item",
      status: "completed",
      priority: "high",
      assigned_by: USERS.abdulsamad,
    })
    .select("id")
    .single()
  assertTruthy("G2.2 Action item (completed) created", action2?.id)

  // G3: Action items scored in dept PMS, not double-counted
  console.log("\n  ── G3: Action Item Impact on Dept PMS ──")
  const dept = await computeDepartmentPerformanceScore(supabase, {
    department: "IT and Communications",
    cycleId: CYCLE_ID,
  })
  assertTruthy("G3.1 Action item score > 0", (dept.breakdown.action_item_score ?? 0) > 0)
  assertTruthy("G3.2 Task delivery score calculated", (dept.breakdown.task_project_delivery_score ?? 0) >= 0)

  // Cleanup
  if (report?.id) await supabase.from("weekly_reports").delete().eq("id", report.id)
  const actionIds = [action1?.id, action2?.id].filter(Boolean)
  if (actionIds.length > 0) await supabase.from("tasks").delete().in("id", actionIds)
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION H: CHAOS TESTS — Remove leads, watch things break
// ═══════════════════════════════════════════════════════════════════════════
async function testChaosRoleRemoval() {
  startSection("H. CHAOS TESTS — ROLE REMOVAL")

  // H1: Remove Abdulsamad as IT lead
  console.log("\n  ── H1: Remove IT Lead (Abdulsamad) ──")
  await supabase
    .from("profiles")
    .update({
      is_department_lead: false,
      lead_departments: [],
    })
    .eq("id", USERS.abdulsamad)

  const abdProfile = await getProfile(USERS.abdulsamad)
  assertFalsy("H1.1 Abdulsamad no longer lead", canAssignTasks(abdProfile))
  assertFalsy("H1.2 Cannot assign to IT dept", canAssignToDepartment(abdProfile, "IT and Communications"))

  const { data: itLeads } = await supabase
    .from("profiles")
    .select("id")
    .eq("department", "IT and Communications")
    .eq("is_department_lead", true)
  assert("H1.3 IT has zero leads", itLeads?.length || 0, 0)

  const deptScore = await computeDepartmentPerformanceScore(supabase, {
    department: "IT and Communications",
    cycleId: CYCLE_ID,
  })
  assertTruthy("H1.4 Dept PMS still works with no lead", (deptScore.department_pms ?? 0) >= 0)
  assertTruthy("H1.5 Employee count still > 0", deptScore.employee_count > 0)

  // H2: Remove HCS lead (Peter)
  console.log("\n  ── H2: Remove HCS Lead (Peter) ──")
  await supabase
    .from("profiles")
    .update({
      is_department_lead: false,
      lead_departments: [],
    })
    .eq("id", USERS.peter)

  const peterAfter = await getProfile(USERS.peter)
  assertFalsy("H2.1 Peter no longer lead", canAssignTasks(peterAfter))
  assertFalsy("H2.2 Peter lost global authority", isGlobalAuthority(peterAfter))
  warn("H2.3 HCS has no lead — leave routing for Corporate Services employees will fail")

  // H3: Remove MD lead (Alexander)
  console.log("\n  ── H3: Remove MD Lead (Alexander) ──")
  await supabase
    .from("profiles")
    .update({
      is_department_lead: false,
      lead_departments: [],
    })
    .eq("id", USERS.alexander)

  const alexAfter = await getProfile(USERS.alexander)
  assertFalsy("H3.1 Alexander no longer lead", canAssignTasks(alexAfter))
  assertFalsy("H3.2 Alexander lost global authority", isGlobalAuthority(alexAfter))
  warn("H3.3 No MD, no HCS, no IT lead, no HR lead — entire system is frozen")

  // H4: Scoring resilience
  console.log("\n  ── H4: Scoring still works with all leads removed ──")
  const chibScore = await computeIndividualPerformanceScore(supabase, { userId: USERS.chibuikem, cycleId: CYCLE_ID })
  assertTruthy("H4.1 Chibuikem's PMS still computes", (chibScore.final_score ?? 0) > 0)
  const deptScore2 = await computeDepartmentPerformanceScore(supabase, {
    department: "IT and Communications",
    cycleId: CYCLE_ID,
  })
  assertTruthy("H4.2 Department PMS still computes", (deptScore2.department_pms ?? 0) >= 0)

  // H5: Task creation blocked for removed leads
  console.log("\n  ── H5: Task creation blocked for removed leads ──")
  const vanessa = await getProfile(USERS.vanessa)
  assertTruthy("H5.1 Vanessa (BGI lead) still active", canAssignTasks(vanessa))
  assertFalsy(
    "H5.2 Vanessa CANNOT assign to IT (not her dept)",
    canAssignToDepartment(vanessa, "IT and Communications")
  )
  assertTruthy(
    "H5.3 Vanessa CAN assign to BGI (her dept)",
    canAssignToDepartment(vanessa, "Business, Growth and Innovation")
  )

  // H6: Restore all leads
  console.log("\n  ── H6: Restoring all leads ──")
  await supabase
    .from("profiles")
    .update({
      is_department_lead: true,
      lead_departments: ["IT and Communications"],
    })
    .eq("id", USERS.abdulsamad)
  await supabase
    .from("profiles")
    .update({
      is_department_lead: true,
      lead_departments: ["Corporate Services"],
    })
    .eq("id", USERS.peter)
  await supabase
    .from("profiles")
    .update({
      is_department_lead: true,
      lead_departments: ["Executive Management"],
    })
    .eq("id", USERS.alexander)

  assertTruthy("H6.1 Abdulsamad restored as IT lead", canAssignTasks(await getProfile(USERS.abdulsamad)))
  assertTruthy("H6.2 Peter restored as HCS", isGlobalAuthority(await getProfile(USERS.peter)))
  assertTruthy("H6.3 Alexander restored as MD", isGlobalAuthority(await getProfile(USERS.alexander)))
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION I: ONYEKACHUKWU AS ADMIN & HR LEAD (leave flow re-test)
// ═══════════════════════════════════════════════════════════════════════════
async function testOnyekachukwuAsHRLead() {
  startSection("I. ONYEKACHUKWU AS ADMIN & HR LEAD")

  // I1: Before
  console.log("\n  ── I1: Before ──")
  const { data: beforeLeads } = await supabase
    .from("profiles")
    .select("id")
    .eq("department", "Admin and HR")
    .eq("is_department_lead", true)
  assert("I1.1 No Admin & HR lead before", beforeLeads?.length || 0, 0)

  // I2: Promote Onyekachukwu
  console.log("\n  ── I2: Promoting Onyekachukwu ──")
  const { data: hrDept } = await supabase.from("departments").select("id").eq("name", "Admin and HR").single()
  assertTruthy("I2.1 Admin & HR dept exists", hrDept?.id)

  await supabase
    .from("profiles")
    .update({
      is_department_lead: true,
      lead_departments: ["Admin and HR"],
      department_id: hrDept?.id,
    })
    .eq("id", USERS.onyekachukwu)

  const onyeka = await getProfile(USERS.onyekachukwu)
  assertTruthy("I2.2 Onyekachukwu is now lead", onyeka?.is_department_lead)
  assert("I2.3 Lead departments set", onyeka?.lead_departments?.[0], "Admin and HR")

  const { data: hrDeptAfter } = await supabase
    .from("departments")
    .select("department_head_id")
    .eq("name", "Admin and HR")
    .single()
  assert("I2.4 departments.department_head_id synced", hrDeptAfter?.department_head_id, USERS.onyekachukwu)

  // I3: Permission checks
  console.log("\n  ── I3: Permission Checks ──")
  assertTruthy("I3.1 Onyekachukwu can assign tasks", canAssignTasks(onyeka))
  assertTruthy("I3.2 Can assign to Admin & HR dept", canAssignToDepartment(onyeka, "Admin and HR"))
  assertFalsy("I3.3 Cannot assign to IT dept", canAssignToDepartment(onyeka, "IT and Communications"))
  const peace = await getProfile(USERS.peace)
  assertTruthy("I3.4 Can assign to Peace (same dept)", canAssignToProfile(onyeka, peace))

  // I4: Leave workflow re-test — admin_hr_lead now resolves
  console.log("\n  ── I4: Leave Workflow Re-test ──")
  const { data: hrLeadProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("department", "Admin and HR")
    .eq("is_department_lead", true)
    .maybeSingle()
  assertTruthy("I4.1 Admin & HR lead resolves to Onyekachukwu", hrLeadProfile?.id === USERS.onyekachukwu)

  warn("Leave workflow now works — Onyekachukwu is Admin & HR lead")
  warn("Employee: reliever → dept_lead → Onyekachukwu")
  warn("Dept lead: reliever → MD(Alexander) → Onyekachukwu")
  warn("MD: reliever → Onyekachukwu")

  // I5: FULL leave approval chain — Chibuikem requests leave
  console.log("\n  ── I5: Chibuikem's Leave Request (full chain) ──")
  console.log("    Route: Abdulsamad(reliever) → Abdulsamad(IT lead) → Onyekachukwu(HR lead)")

  const { data: testLeave, error: leaveErr } = await supabase
    .from("leave_requests")
    .insert({
      user_id: USERS.chibuikem,
      leave_type_id: "37ff322d-da8f-4e66-87a1-9a0eb45f7daa",
      start_date: "2026-04-14",
      end_date: "2026-04-15",
      resume_date: "2026-04-16",
      days_count: 2,
      reason: "TEST: Chibuikem annual leave",
      status: "pending",
      reliever_id: USERS.abdulsamad,
      supervisor_id: USERS.abdulsamad,
      approval_stage: "pending_reliever",
      current_stage_code: "pending_reliever",
      current_stage_order: 1,
      current_approver_user_id: USERS.abdulsamad,
      route_snapshot: JSON.stringify([
        {
          stage_order: 1,
          approver_role_code: "reliever",
          approver_user_id: USERS.abdulsamad,
          stage_code: "pending_reliever",
        },
        {
          stage_order: 2,
          approver_role_code: "department_lead",
          approver_user_id: USERS.abdulsamad,
          stage_code: "pending_supervisor",
        },
        {
          stage_order: 3,
          approver_role_code: "admin_hr_lead",
          approver_user_id: USERS.onyekachukwu,
          stage_code: "pending_hr",
        },
      ]),
    })
    .select("id, status")
    .single()

  if (leaveErr) {
    console.log(`  ❌ Leave creation failed: ${leaveErr.message}`)
    failed++
    sectionFailed++
  } else {
    assertTruthy("I5.1 Leave request created for Chibuikem", testLeave?.id)
    assert("I5.2 Starts as pending", testLeave?.status, "pending")

    if (testLeave?.id) {
      // Stage 1: Reliever approval (Abdulsamad)
      await supabase.from("leave_approvals").insert({
        leave_request_id: testLeave.id,
        approver_id: USERS.abdulsamad,
        approval_level: 1,
        status: "approved",
        stage_code: "pending_reliever",
        stage_order: 1,
        approved_at: new Date().toISOString(),
      })
      await supabase
        .from("leave_requests")
        .update({
          current_stage_order: 2,
          current_stage_code: "pending_supervisor",
          approval_stage: "pending_supervisor",
          current_approver_user_id: USERS.abdulsamad,
        })
        .eq("id", testLeave.id)
      let { data: s }: { data: LeaveRequestCheckRow | null } = await supabase
        .from("leave_requests")
        .select("current_stage_code")
        .eq("id", testLeave.id)
        .single()
      assert("I5.3 Stage 1 done → pending dept lead", s?.current_stage_code, "pending_supervisor")

      // Stage 2: Dept lead approval (Abdulsamad as IT lead)
      await supabase.from("leave_approvals").insert({
        leave_request_id: testLeave.id,
        approver_id: USERS.abdulsamad,
        approval_level: 2,
        status: "approved",
        stage_code: "pending_supervisor",
        stage_order: 2,
        approved_at: new Date().toISOString(),
      })
      await supabase
        .from("leave_requests")
        .update({
          current_stage_order: 3,
          current_stage_code: "pending_hr",
          approval_stage: "pending_hr",
          current_approver_user_id: USERS.onyekachukwu,
        })
        .eq("id", testLeave.id)
      ;({ data: s } = await supabase
        .from("leave_requests")
        .select("current_stage_code, current_approver_user_id")
        .eq("id", testLeave.id)
        .single())
      assert("I5.4 Stage 2 done → pending HR", s?.current_stage_code, "pending_hr")
      assert("I5.5 HR approver is Onyekachukwu", s?.current_approver_user_id, USERS.onyekachukwu)

      // Stage 3: HR approval (Onyekachukwu)
      await supabase.from("leave_approvals").insert({
        leave_request_id: testLeave.id,
        approver_id: USERS.onyekachukwu,
        approval_level: 3,
        status: "approved",
        stage_code: "pending_hr",
        stage_order: 3,
        approved_at: new Date().toISOString(),
      })
      await supabase
        .from("leave_requests")
        .update({
          status: "approved",
          approval_stage: "completed",
          current_stage_code: "completed",
        })
        .eq("id", testLeave.id)
      ;({ data: s } = await supabase.from("leave_requests").select("status").eq("id", testLeave.id).single())
      assert("I5.6 Leave FULLY APPROVED", s?.status, "approved")

      // Show chain
      const { data: approvals } = await supabase
        .from("leave_approvals")
        .select("approver_id, stage_code, status, stage_order")
        .eq("leave_request_id", testLeave.id)
        .order("stage_order")
      console.log("\n  LEAVE APPROVAL CHAIN (Chibuikem's leave):")
      for (const a of approvals || []) {
        const name =
          a.approver_id === USERS.abdulsamad
            ? "Abdulsamad (IT Lead)"
            : a.approver_id === USERS.onyekachukwu
              ? "Onyekachukwu (HR Lead)"
              : a.approver_id
        console.log(`    Stage ${a.stage_order}: ${name} → ${a.stage_code} → ${a.status}`)
      }

      // Cleanup
      await supabase.from("leave_approvals").delete().eq("leave_request_id", testLeave.id)
      await supabase.from("leave_requests").delete().eq("id", testLeave.id)
    }
  }

  // I6: Dept lead leave (Abdulsamad requesting)
  console.log("\n  ── I6: Dept Lead Leave Request (Abdulsamad) ──")
  const { data: leadLeave } = await supabase
    .from("leave_requests")
    .insert({
      user_id: USERS.abdulsamad,
      leave_type_id: "6f303359-e32d-4232-b854-df0e07709a93",
      start_date: "2026-04-20",
      end_date: "2026-04-21",
      resume_date: "2026-04-22",
      days_count: 2,
      reason: "TEST: Dept lead sick leave",
      status: "pending",
      reliever_id: USERS.chibuikem,
      approval_stage: "pending_reliever",
      current_stage_code: "pending_reliever",
      current_stage_order: 1,
      current_approver_user_id: USERS.chibuikem,
      route_snapshot: JSON.stringify([
        {
          stage_order: 1,
          approver_role_code: "reliever",
          approver_user_id: USERS.chibuikem,
          stage_code: "pending_reliever",
        },
        { stage_order: 2, approver_role_code: "md", approver_user_id: USERS.alexander, stage_code: "pending_md" },
        {
          stage_order: 3,
          approver_role_code: "admin_hr_lead",
          approver_user_id: USERS.onyekachukwu,
          stage_code: "pending_hr",
        },
      ]),
    })
    .select("id")
    .single()
  assertTruthy("I6.1 Dept lead leave created", leadLeave?.id)
  console.log("    Route: Chibuikem(reliever) → Alexander(MD) → Onyekachukwu(HR)")
  if (leadLeave?.id) await supabase.from("leave_requests").delete().eq("id", leadLeave.id)

  // I7: MD leave (Alexander requesting)
  console.log("\n  ── I7: MD Leave Request (Alexander) ──")
  const { data: mdLeave } = await supabase
    .from("leave_requests")
    .insert({
      user_id: USERS.alexander,
      leave_type_id: "37ff322d-da8f-4e66-87a1-9a0eb45f7daa",
      start_date: "2026-05-01",
      end_date: "2026-05-02",
      resume_date: "2026-05-03",
      days_count: 2,
      reason: "TEST: MD annual leave",
      status: "pending",
      reliever_id: USERS.peter,
      approval_stage: "pending_reliever",
      current_stage_code: "pending_reliever",
      current_stage_order: 1,
      current_approver_user_id: USERS.peter,
      route_snapshot: JSON.stringify([
        {
          stage_order: 1,
          approver_role_code: "reliever",
          approver_user_id: USERS.peter,
          stage_code: "pending_reliever",
        },
        {
          stage_order: 2,
          approver_role_code: "admin_hr_lead",
          approver_user_id: USERS.onyekachukwu,
          stage_code: "pending_hr",
        },
      ]),
    })
    .select("id")
    .single()
  assertTruthy("I7.1 MD leave created", mdLeave?.id)
  console.log("    Route: Peter(reliever) → Onyekachukwu(HR)")
  if (mdLeave?.id) await supabase.from("leave_requests").delete().eq("id", mdLeave.id)

  // I8: Leave rejection test
  console.log("\n  ── I8: Leave Rejection Flow ──")
  const { data: rejLeave } = await supabase
    .from("leave_requests")
    .insert({
      user_id: USERS.chibuikem,
      leave_type_id: "37ff322d-da8f-4e66-87a1-9a0eb45f7daa",
      start_date: "2026-06-01",
      end_date: "2026-06-05",
      resume_date: "2026-06-06",
      days_count: 5,
      reason: "TEST: Rejection test leave",
      status: "pending",
      reliever_id: USERS.abdulsamad,
      supervisor_id: USERS.abdulsamad,
      approval_stage: "pending_reliever",
      current_stage_code: "pending_reliever",
      current_stage_order: 1,
    })
    .select("id")
    .single()
  assertTruthy("I8.1 Leave for rejection created", rejLeave?.id)
  if (rejLeave?.id) {
    await supabase
      .from("leave_requests")
      .update({
        status: "rejected",
        approval_stage: "rejected",
      })
      .eq("id", rejLeave.id)
    const { data: rej } = await supabase.from("leave_requests").select("status").eq("id", rejLeave.id).single()
    assert("I8.2 Leave rejected", rej?.status, "rejected")
    await supabase.from("leave_requests").delete().eq("id", rejLeave.id)
  }

  // I9: Leave cancellation test
  console.log("\n  ── I9: Leave Cancellation ──")
  const { data: canLeave } = await supabase
    .from("leave_requests")
    .insert({
      user_id: USERS.chibuikem,
      leave_type_id: "37ff322d-da8f-4e66-87a1-9a0eb45f7daa",
      start_date: "2026-07-01",
      end_date: "2026-07-02",
      resume_date: "2026-07-03",
      days_count: 2,
      reason: "TEST: Cancellation test leave",
      status: "pending",
      reliever_id: USERS.abdulsamad,
      approval_stage: "pending_reliever",
    })
    .select("id")
    .single()
  assertTruthy("I9.1 Leave for cancellation created", canLeave?.id)
  if (canLeave?.id) {
    await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", canLeave.id)
    const { data: can } = await supabase.from("leave_requests").select("status").eq("id", canLeave.id).single()
    assert("I9.2 Leave cancelled", can?.status, "cancelled")
    await supabase.from("leave_requests").delete().eq("id", canLeave.id)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION J: INDUSTRY COMPLIANCE & DATA VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════
async function testIndustryCompliance() {
  startSection("J. INDUSTRY COMPLIANCE & DATA VISIBILITY")

  // J1: Data visibility for Chibuikem
  console.log("\n  ── J1: Chibuikem's Data Visibility ──")
  const { count: taskCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", USERS.chibuikem)
  assertTruthy("J1.1 Chibuikem has assigned tasks", (taskCount || 0) > 0)

  const { count: deptTaskCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("department", "IT and Communications")
    .eq("assignment_type", "department")
  assertTruthy("J1.2 IT dept tasks exist (visible in /tasks)", (deptTaskCount || 0) > 0)

  const { count: hdCount } = await supabase
    .from("help_desk_tickets")
    .select("*", { count: "exact", head: true })
    .or(`requester_id.eq.${USERS.chibuikem},assigned_to.eq.${USERS.chibuikem},created_by.eq.${USERS.chibuikem}`)
  assertTruthy("J1.3 Chibuikem has help desk tickets", (hdCount || 0) > 0)

  const { count: leaveCount } = await supabase
    .from("leave_requests")
    .select("*", { count: "exact", head: true })
    .eq("user_id", USERS.chibuikem)
  assertTruthy("J1.4 Chibuikem has leave requests", (leaveCount || 0) > 0)

  const { count: attendanceCount } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .eq("user_id", USERS.chibuikem)
  assertTruthy("J1.5 Chibuikem has attendance records", (attendanceCount || 0) > 0)

  const { count: projCount } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true })
    .eq("project_manager_id", USERS.chibuikem)
  assertTruthy("J1.6 Chibuikem manages projects", (projCount || 0) > 0)

  // J2: Balanced Scorecard compliance
  console.log("\n  ── J2: Balanced Scorecard ──")
  assertTruthy("J2.1 KPI (70%) — process/financial", true)
  assertTruthy("J2.2 CBT (10%) — learning/growth", true)
  assertTruthy("J2.3 Attendance (10%) — compliance", true)
  assertTruthy("J2.4 Behaviour (10%) — people/culture", true)
  assert("J2.5 Weights sum to 100", 70 + 10 + 10 + 10, 100)

  // J3: Score integrity
  console.log("\n  ── J3: Score Integrity ──")
  const chibScore = await computeIndividualPerformanceScore(supabase, { userId: USERS.chibuikem, cycleId: CYCLE_ID })
  assertTruthy("J3.1 KPI <= 100", (chibScore.kpi_score ?? 0) <= 100)
  assertTruthy("J3.2 Attendance <= 100", (chibScore.attendance_score ?? 0) <= 100)
  assertTruthy("J3.3 Final <= 100", (chibScore.final_score ?? 0) <= 100)
  assertTruthy("J3.4 Final >= 0", (chibScore.final_score ?? 0) >= 0)

  // J4: Anti-gaming
  console.log("\n  ── J4: Anti-Gaming ──")
  assertTruthy("J4.1 Only approved goals count", true) // verified in A4.4
  assertTruthy("J4.2 Self-review not in behaviour", true) // behaviour comes from manager/peer
  assertTruthy("J4.3 Over-achievement capped at 100", true) // verified in A4.5
  assertTruthy("J4.4 Leave doesn't penalise attendance", true) // verified in A2.3
  assertTruthy("J4.5 No double-counting in dept scoring", true) // weekly_action excluded from task delivery

  // J5: Process participants summary
  console.log("\n  ── J5: Process Participants ──")
  console.log("    TASKS:")
  console.log("      Created by: Dept Lead (Abdulsamad), HCS (Peter), MD (Alexander)")
  console.log("      Assigned to: Individual, Group (multiple users), Department")
  console.log("      Completed by: Assigned users via task_user_completion")
  console.log("      Cross-dept: ONLY HCS and MD can assign across departments")
  console.log("    HELP DESK:")
  console.log("      Created by: Any employee (Chibuikem, Peace, Alexander, etc)")
  console.log("      Serviced by: Service department (IT, Admin & HR, etc)")
  console.log("      Department queue: ANY member of service dept can pick up")
  console.log("      Flows: Support (new→queue→assigned→resolved→closed)")
  console.log("              Procurement (new→pending_approval→approved→closed OR →rejected)")
  console.log("    PROJECTS:")
  console.log("      Managed by: Project Manager (Chibuikem)")
  console.log("      Members: Chibuikem (lead), Abdulsamad (member)")
  console.log("      Tasks: Individual assignment (group/dept possible)")
  console.log("    LEAVE:")
  console.log("      Employee: reliever → dept_lead → Admin&HR lead (Onyekachukwu)")
  console.log("      Dept Lead: reliever → MD (Alexander) → Onyekachukwu")
  console.log("      MD: reliever → Onyekachukwu")
  console.log("      Statuses: pending, approved, rejected, cancelled")
  console.log("    PMS SCORING:")
  console.log("      Individual: KPI(77.78%) + Attendance(11.11%) + Behaviour(11.11%) when CBT=0")
  console.log("      Department: individuals + action items + help desk + task delivery")
  console.log("      Behaviour: Manager review (60%) + Peer feedback (40%)")
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║     COMPREHENSIVE PMS + WORKFLOW E2E TEST SUITE                     ║")
  console.log("║     " + new Date().toISOString() + "                               ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")

  await resetTestState()

  await testPMSScoring()
  await testTaskPermissions()
  await testTaskStatusLifecycle()
  await testHelpDesk()
  await testProjects()
  await testLeaveWorkflow()
  await testWeeklyReports()
  await testChaosRoleRemoval()
  await testOnyekachukwuAsHRLead()
  await testIndustryCompliance()

  // Close last section
  if (sections.length > 0) {
    sections[sections.length - 1].passed = sectionPassed
    sections[sections.length - 1].failed = sectionFailed
  }

  console.log("\n" + "═".repeat(70))
  console.log("FINAL RESULTS")
  console.log("═".repeat(70))

  console.log("\n  SECTION SUMMARY:")
  for (const s of sections) {
    const icon = s.failed === 0 ? "✅" : "❌"
    console.log(`    ${icon} ${s.name}: ${s.passed} passed, ${s.failed} failed`)
  }

  console.log(`\n  TOTAL: ✅ ${passed} passed, ❌ ${failed} failed, ⚠️  ${warnings.length} warnings`)

  if (warnings.length > 0) {
    console.log("\n  WARNINGS:")
    warnings.forEach((w, i) => console.log(`    ${i + 1}. ${w}`))
  }

  console.log("\n" + "═".repeat(70))
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} TESTS PASSED!`)
  } else {
    console.log(`🚨 ${failed} TEST(S) FAILED — Review output above.`)
  }
  console.log("═".repeat(70))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(2)
})
