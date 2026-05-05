import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

const log = logger("hr-leave-relievers")

type AssignableProfileRow = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
  additional_email?: string | null
  department?: string | null
  department_id?: string | null
  employment_status?: string | null
}

function dedupeById(rows: AssignableProfileRow[]) {
  const map = new Map<string, AssignableProfileRow>()
  for (const row of rows) {
    if (row.id) map.set(row.id, row)
  }
  return Array.from(map.values())
}

function normalize(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

type RequesterContext = {
  profileId: string
  department: string | null
  departmentId: string | null
  source: "profile_id" | "company_email" | "additional_email" | "none"
}

function buildLabel(person: AssignableProfileRow) {
  return person.full_name?.trim() || `${person.first_name || ""} ${person.last_name || ""}`.trim() || "Unnamed"
}

export async function GET() {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = user.id

    let requesterContext: RequesterContext = {
      profileId: userId,
      department: null,
      departmentId: null,
      source: "none",
    }

    const { data: requesterProfileById, error: profileError } = await dataClient
      .from("profiles")
      .select("id, department, department_id")
      .eq("id", user.id)
      .maybeSingle<{ id: string; department?: string | null; department_id?: string | null }>()

    if (profileError) {
      log.error({ err: String(profileError), userId }, "Failed to fetch requester profile for relievers")
    }

    if (requesterProfileById) {
      requesterContext = {
        profileId: requesterProfileById.id,
        department: requesterProfileById.department || null,
        departmentId: requesterProfileById.department_id || null,
        source: "profile_id",
      }
    }

    if (!requesterContext.department && !requesterContext.departmentId && user.email) {
      const { data: requesterProfileByEmail, error: emailLookupError } = await dataClient
        .from("profiles")
        .select("id, department, department_id, company_email, additional_email")
        .eq("company_email", user.email)
        .maybeSingle<AssignableProfileRow>()

      if (emailLookupError) {
        log.error({ err: String(emailLookupError), userId }, "Failed email fallback lookup for relievers")
      } else if (requesterProfileByEmail) {
        requesterContext = {
          profileId: requesterProfileByEmail.id,
          department: requesterProfileByEmail.department || null,
          departmentId: requesterProfileByEmail.department_id || null,
          source: "company_email",
        }
      }
    }

    if (!requesterContext.department && !requesterContext.departmentId && user.email) {
      const { data: requesterProfileByAdditionalEmail, error: additionalEmailLookupError } = await dataClient
        .from("profiles")
        .select("id, department, department_id, company_email, additional_email")
        .eq("additional_email", user.email)
        .maybeSingle<AssignableProfileRow>()

      if (additionalEmailLookupError) {
        log.error(
          { err: String(additionalEmailLookupError), userId },
          "Failed additional_email fallback lookup for relievers"
        )
      } else if (requesterProfileByAdditionalEmail) {
        requesterContext = {
          profileId: requesterProfileByAdditionalEmail.id,
          department: requesterProfileByAdditionalEmail.department || null,
          departmentId: requesterProfileByAdditionalEmail.department_id || null,
          source: "additional_email",
        }
      }
    }

    if (!requesterContext.department && requesterContext.departmentId) {
      const { data: deptRow } = await dataClient
        .from("departments")
        .select("name")
        .eq("id", requesterContext.departmentId)
        .maybeSingle<{ name?: string | null }>()
      requesterContext.department = deptRow?.name || null
    }

    if (!requesterContext.departmentId && requesterContext.department) {
      const { data: deptRowByName } = await dataClient
        .from("departments")
        .select("id")
        .eq("name", requesterContext.department)
        .maybeSingle<{ id?: string | null }>()
      requesterContext.departmentId = deptRowByName?.id || null
    }

    if (!requesterContext.department && !requesterContext.departmentId) {
      log.warn({ userId }, "Requester has no department — returning empty reliever list")
      return NextResponse.json({
        data: [],
        debug: {
          reason: "requester_has_no_department",
          user_id: userId,
          requester_profile_id: requesterContext.profileId,
          requester_department: null,
          requester_department_id: null,
          resolution_source: requesterContext.source,
          total_profiles_scanned: 0,
          matched_profiles: 0,
          options_count: 0,
        },
      })
    }

    const candidatesById = new Map<string, AssignableProfileRow>()
    let totalProfilesScanned = 0

    if (requesterContext.departmentId) {
      const { data: byDeptId, error: byDeptIdError } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name, department, department_id, employment_status")
        .eq("department_id", requesterContext.departmentId)
        .neq("id", requesterContext.profileId)
        .order("first_name", { ascending: true })

      if (byDeptIdError) {
        log.error({ err: String(byDeptIdError), userId }, "Failed to fetch relievers by department_id")
        return NextResponse.json({ error: "Failed to fetch relievers" }, { status: 500 })
      }

      const rows = (byDeptId as AssignableProfileRow[] | null) || []
      totalProfilesScanned += rows.length
      for (const row of rows) {
        if (row.id) candidatesById.set(row.id, row)
      }
    }

    if (requesterContext.department) {
      const { data: byDeptName, error: byDeptNameError } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name, department, department_id, employment_status")
        .eq("department", requesterContext.department)
        .neq("id", requesterContext.profileId)
        .order("first_name", { ascending: true })

      if (byDeptNameError) {
        log.error({ err: String(byDeptNameError), userId }, "Failed to fetch relievers by department name")
        return NextResponse.json({ error: "Failed to fetch relievers" }, { status: 500 })
      }

      const rows = (byDeptName as AssignableProfileRow[] | null) || []
      totalProfilesScanned += rows.length
      for (const row of rows) {
        if (row.id) candidatesById.set(row.id, row)
      }
    }

    const candidateRows = dedupeById(Array.from(candidatesById.values()))

    log.info(
      {
        userId,
        profileCount: totalProfilesScanned,
        department: requesterContext.department,
        departmentId: requesterContext.departmentId,
        resolutionSource: requesterContext.source,
      },
      "Reliever query context"
    )

    if (totalProfilesScanned === 0) {
      log.warn(
        { userId },
        "Reliever query returned 0 peer profiles — check department data and SUPABASE_SERVICE_ROLE_KEY"
      )
    }

    const requesterDepartmentName = normalize(requesterContext.department)
    const relieverRows = candidateRows.filter((row) => {
      if (!row.id) return false
      const sameDepartmentId = Boolean(
        requesterContext.departmentId && row.department_id === requesterContext.departmentId
      )
      const sameDepartmentName =
        requesterDepartmentName.length > 0 && normalize(row.department) === requesterDepartmentName
      const assignableStatus = isAssignableEmploymentStatus(row.employment_status, {
        allowLegacyNullStatus: false,
      })
      return (sameDepartmentId || sameDepartmentName) && assignableStatus
    })

    log.info(
      { userId, matchedCount: relieverRows.length, totalProfiles: totalProfilesScanned },
      "Reliever department filter result"
    )

    const options = relieverRows
      .map((person) => {
        return { value: person.id, label: buildLabel(person) }
      })
      .filter((option) => Boolean(option.value))

    return NextResponse.json({
      data: options,
      debug: {
        user_id: userId,
        requester_profile_id: requesterContext.profileId,
        requester_department: requesterContext.department,
        requester_department_id: requesterContext.departmentId,
        resolution_source: requesterContext.source,
        total_profiles_scanned: totalProfilesScanned,
        matched_profiles: relieverRows.length,
        options_count: options.length,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled relievers route error")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
