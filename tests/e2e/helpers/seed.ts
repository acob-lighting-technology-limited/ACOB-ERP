import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { toLocalISODate } from "../../../lib/utils/date"

export interface SeedUser {
  email: string
  password: string
  id?: string
  fullName?: string
  department?: string | null
  role?: string | null
  isDepartmentLead?: boolean
  leadDepartments?: string[]
}

export interface SeedResult {
  ready: boolean
  reason?: string
  reviewCycleId?: string
  leaveTypeId?: string
  helpDeskDepartment?: string
  actionDepartment?: string
  testEmployee: SeedUser
  testLead: SeedUser
  testHR: SeedUser
  testAdmin: SeedUser
  testITStaff: SeedUser
  testReliever: SeedUser
}

type ProfileRow = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
  additional_email?: string | null
  department?: string | null
  role?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

type ReviewCycleRow = {
  id: string
}

type LeaveTypeRow = {
  id: string
}

let cachedSeed: Promise<SeedResult> | null = null

function readEnv(name: string, fallback: string) {
  return process.env[name] || fallback
}

function buildSeedUser(prefix: string, fallbackEmail: string): SeedUser {
  return {
    email: readEnv(`PLAYWRIGHT_${prefix}_EMAIL`, fallbackEmail),
    password: readEnv(`PLAYWRIGHT_${prefix}_PASSWORD`, "Password123!"),
  }
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PLAYWRIGHT_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function findProfileByEmail(admin: SupabaseClient, email: string): Promise<SeedUser | null> {
  const normalizedEmail = email.trim().toLowerCase()
  const { data, error } = await admin
    .from("profiles")
    .select(
      "id, full_name, first_name, last_name, company_email, additional_email, department, role, is_department_lead, lead_departments"
    )
    .or(`company_email.eq.${normalizedEmail},additional_email.eq.${normalizedEmail}`)
    .limit(1)

  if (error || !data || data.length === 0) return null

  const profile = data[0] as ProfileRow
  return {
    email,
    password: "",
    id: profile.id,
    fullName: profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || email,
    department: profile.department || null,
    role: profile.role || null,
    isDepartmentLead: Boolean(profile.is_department_lead),
    leadDepartments: Array.isArray(profile.lead_departments) ? profile.lead_departments : [],
  }
}

async function ensureAttendance(admin: SupabaseClient, userId: string) {
  const today = new Date()
  const rows = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - index)
    return {
      user_id: userId,
      date: toLocalISODate(date),
      status: "present",
      notes: "Playwright seed record",
    }
  })

  await admin.from("attendance_records").upsert(rows, {
    onConflict: "user_id,date",
    ignoreDuplicates: false,
  })
}

async function ensureReviewCycle(admin: SupabaseClient): Promise<string | undefined> {
  const { data: cycles } = await admin
    .from("review_cycles")
    .select("id")
    .order("start_date", { ascending: false })
    .limit(1)

  const latest = (cycles || [])[0] as ReviewCycleRow | undefined
  if (latest?.id) return latest.id

  const now = new Date()
  const startDate = toLocalISODate(new Date(now.getFullYear(), 0, 1))
  const endDate = toLocalISODate(new Date(now.getFullYear(), 11, 31))

  const { data: created } = await admin
    .from("review_cycles")
    .insert({
      name: `Playwright ${now.getFullYear()} Review Cycle`,
      review_type: "annual",
      start_date: startDate,
      end_date: endDate,
    })
    .select("id")
    .single()

  return (created as ReviewCycleRow | null)?.id
}

async function resolveLeaveType(admin: SupabaseClient): Promise<string | undefined> {
  const { data } = await admin.from("leave_types").select("id").eq("is_active", true).order("name").limit(1)
  return ((data || [])[0] as LeaveTypeRow | undefined)?.id
}

export function getSeedAdminClient() {
  return getAdminClient()
}

export async function seedTestData(): Promise<SeedResult> {
  if (cachedSeed) return cachedSeed

  cachedSeed = (async () => {
    const baseUsers = {
      testEmployee: buildSeedUser("TEST_EMPLOYEE", "test.employee@example.com"),
      testLead: buildSeedUser("TEST_LEAD", "test.lead@example.com"),
      testHR: buildSeedUser("TEST_HR", "test.hr@example.com"),
      testAdmin: buildSeedUser("TEST_ADMIN", "test.admin@example.com"),
      testITStaff: buildSeedUser("TEST_IT_STAFF", "test.it@example.com"),
      testReliever: buildSeedUser("TEST_RELIEVER", "test.reliever@example.com"),
    }

    const admin = getAdminClient()
    if (!admin) {
      return {
        ready: false,
        reason: "Supabase service role env vars are not configured for Playwright seeding.",
        reviewCycleId: undefined,
        leaveTypeId: undefined,
        helpDeskDepartment: undefined,
        actionDepartment: undefined,
        ...baseUsers,
      }
    }

    const [
      employeeProfile,
      leadProfile,
      hrProfile,
      adminProfile,
      itProfile,
      relieverProfile,
      reviewCycleId,
      leaveTypeId,
    ] = await Promise.all([
      findProfileByEmail(admin, baseUsers.testEmployee.email),
      findProfileByEmail(admin, baseUsers.testLead.email),
      findProfileByEmail(admin, baseUsers.testHR.email),
      findProfileByEmail(admin, baseUsers.testAdmin.email),
      findProfileByEmail(admin, baseUsers.testITStaff.email),
      findProfileByEmail(admin, baseUsers.testReliever.email),
      ensureReviewCycle(admin),
      resolveLeaveType(admin),
    ])

    const missingUsers = [
      ["employee", employeeProfile] as const,
      ["lead", leadProfile] as const,
      ["hr", hrProfile] as const,
      ["admin", adminProfile] as const,
      ["it staff", itProfile] as const,
      ["reliever", relieverProfile] as const,
    ]
      .filter(([, value]) => !value?.id)
      .map(([label]) => label)

    if (missingUsers.length > 0) {
      return {
        ready: false,
        reason: `Missing test profiles for: ${missingUsers.join(", ")}.`,
        reviewCycleId,
        leaveTypeId,
        helpDeskDepartment: undefined,
        actionDepartment: adminProfile?.department || undefined,
        testEmployee: { ...baseUsers.testEmployee, ...employeeProfile },
        testLead: { ...baseUsers.testLead, ...leadProfile },
        testHR: { ...baseUsers.testHR, ...hrProfile },
        testAdmin: { ...baseUsers.testAdmin, ...adminProfile },
        testITStaff: { ...baseUsers.testITStaff, ...itProfile },
        testReliever: { ...baseUsers.testReliever, ...relieverProfile },
      }
    }

    const resolvedEmployee = employeeProfile as SeedUser
    const resolvedLead = leadProfile as SeedUser
    const resolvedHr = hrProfile as SeedUser
    const resolvedAdmin = adminProfile as SeedUser
    const resolvedIt = itProfile as SeedUser
    const resolvedReliever = relieverProfile as SeedUser

    await ensureAttendance(admin, resolvedEmployee.id!)

    const leadDepartments = new Set(
      [
        resolvedLead.department,
        ...(Array.isArray(resolvedLead.leadDepartments) ? resolvedLead.leadDepartments : []),
      ].filter(Boolean)
    )

    const helpDeskDepartment =
      [resolvedIt.department, ...Array.from(leadDepartments)]
        .filter((department): department is string => Boolean(department))
        .find((department) => leadDepartments.has(department)) || undefined

    return {
      ready: Boolean(reviewCycleId && leaveTypeId),
      reason: !reviewCycleId
        ? "No review cycle available for performance tests."
        : !leaveTypeId
          ? "No active leave type available for leave tests."
          : undefined,
      reviewCycleId,
      leaveTypeId,
      helpDeskDepartment,
      actionDepartment: resolvedAdmin.department || resolvedLead.department || resolvedIt.department || undefined,
      testEmployee: { ...baseUsers.testEmployee, ...resolvedEmployee, password: baseUsers.testEmployee.password },
      testLead: { ...baseUsers.testLead, ...resolvedLead, password: baseUsers.testLead.password },
      testHR: { ...baseUsers.testHR, ...resolvedHr, password: baseUsers.testHR.password },
      testAdmin: { ...baseUsers.testAdmin, ...resolvedAdmin, password: baseUsers.testAdmin.password },
      testITStaff: { ...baseUsers.testITStaff, ...resolvedIt, password: baseUsers.testITStaff.password },
      testReliever: { ...baseUsers.testReliever, ...resolvedReliever, password: baseUsers.testReliever.password },
    }
  })()

  return cachedSeed
}
