import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import {
  ASSIGNABLE_ROLES,
  canAssignRole,
  canManageDeveloperAccounts,
  canManageSuperAdminAccounts,
} from "@/lib/role-management"
import { formValidation } from "@/lib/validation"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { checkIdempotency, getIdempotencyKey, storeIdempotencyKey } from "@/lib/idempotency"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { formatName } from "@/lib/utils"
import { DEPT_ADMIN_HR, isSameDepartment } from "@/shared/departments"

const log = logger("admin-create-user")

export const dynamic = "force-dynamic"

type AdminCreateUserClient = Awaited<ReturnType<typeof createServerClient>>

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`admin-create-user:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  // First, verify the caller is authenticated and has user-management privileges
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase as AdminCreateUserClient, user.id)
  const managedDepartments = scope?.managedDepartments || []
  const canManageUsers =
    !!scope && (scope.isAdminLike || managedDepartments.some((dept) => isSameDepartment(dept, DEPT_ADMIN_HR)))
  if (!canManageUsers) {
    return NextResponse.json({ success: false, error: "Forbidden: Insufficient privileges" }, { status: 403 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    log.error("Missing required Supabase configuration")
    return NextResponse.json({ success: false, error: "Configuration error: Missing configuration" }, { status: 500 })
  }

  const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const idempotencyKey = getIdempotencyKey(request)

  if (idempotencyKey) {
    const { isDuplicate, cachedResponse } = await checkIdempotency(serviceSupabase, idempotencyKey)
    if (isDuplicate) {
      return NextResponse.json(cachedResponse, { status: 200 })
    }
  }

  try {
    const body = await request.json()
    const {
      firstName: rawFirstName,
      lastName: rawLastName,
      otherNames: rawOtherNames,
      email,
      department,
      designation,
      phoneNumber,
      role,
      employmentType,
      contractCategoryCode,
      gender,
      dateOfBirth,
      additionalPhone,
      residentialAddress,
      officeLocation,
    } = body

    const firstName = formatName(rawFirstName)
    const lastName = formatName(rawLastName)
    const otherNames = rawOtherNames ? formatName(rawOtherNames) : ""
    const resolvedEmploymentType = employmentType || "full_time"
    const resolvedDesignation = String(designation ?? body?.companyRole ?? "").trim()
    const adminRoutes = Array.isArray(body?.admin_routes)
      ? body.admin_routes
          .map((value: unknown) =>
            String(value || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      : []
    const { GRANTABLE_ADMIN_ROUTES: allowedAdminRoutes } = await import("@/lib/admin/policy-v2")

    // Validate role if provided
    const allowedRoles = [...ASSIGNABLE_ROLES]
    if (role && !allowedRoles.includes(role)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid role. Allowed values: ${allowedRoles.join(", ")}`,
        },
        { status: 400 }
      )
    }

    if (role === "developer" && !canManageDeveloperAccounts(scope?.role || "")) {
      return NextResponse.json(
        { success: false, error: "Only super admin or developer can assign developer role" },
        { status: 403 }
      )
    }

    if (role === "super_admin" && !canManageSuperAdminAccounts(scope?.role || "")) {
      return NextResponse.json(
        { success: false, error: "Only super admin can assign super admin role" },
        { status: 403 }
      )
    }

    const targetRole = role || "employee"
    if (!canAssignRole(scope?.role || "", targetRole)) {
      return NextResponse.json(
        {
          success: false,
          error: "You do not have permission to assign this role.",
        },
        { status: 403 }
      )
    }
    if (targetRole === "admin") {
      if (adminRoutes.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Admin role requires at least one admin route.",
          },
          { status: 400 }
        )
      }
      if (adminRoutes.some((value: string) => !allowedAdminRoutes.includes(value as never))) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid admin route supplied.",
          },
          { status: 400 }
        )
      }
    }

    // Validate required fields (department is optional for executives like MD)
    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        {
          success: false,
          error: "First name, last name, and email are required",
        },
        { status: 400 }
      )
    }

    // Gender is mandatory, not cosmetic: leave eligibility is gender-gated (maternity is
    // female-only, paternity male-only), so a profile created without it silently gets the
    // wrong leave entitlement. The UI forms already require it — this closes the API, which
    // scripted/bulk creation goes through.
    const normalizedGender = String(gender || "")
      .trim()
      .toLowerCase()
    if (normalizedGender !== "male" && normalizedGender !== "female") {
      return NextResponse.json(
        {
          success: false,
          error: "Gender is required and must be either 'male' or 'female'",
        },
        { status: 400 }
      )
    }

    // Generate employee number server-side
    const { data: employeeNumber, error: genError } = await serviceSupabase.rpc("generate_staff_number", {
      p_type: resolvedEmploymentType,
      p_category_code: contractCategoryCode || null,
    })

    if (genError || !employeeNumber) {
      log.error({ err: String(genError) }, "[Create User] Employee ID generation error:")
      return NextResponse.json(
        {
          success: false,
          error: `Failed to generate employee number: ${genError?.message ?? "unknown error"}`,
        },
        { status: 500 }
      )
    }

    // Resolve contract category ID if contract
    let contractCategoryId = null
    if (resolvedEmploymentType === "contract" && contractCategoryCode) {
      const { data: catData, error: catError } = await serviceSupabase
        .from("contract_categories")
        .select("id")
        .eq("code", contractCategoryCode.toUpperCase())
        .eq("is_active", true)
        .single()

      if (catError || !catData) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid or inactive contract category code: ${contractCategoryCode}`,
          },
          { status: 400 }
        )
      }
      contractCategoryId = catData.id
    }

    // Validate email format and domain
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid email format",
        },
        { status: 400 }
      )
    }

    if (!formValidation.isCompanyEmail(email)) {
      return NextResponse.json(
        {
          success: false,
          error: "Only @acoblighting.com and @org.acoblighting.com emails are allowed.",
        },
        { status: 400 }
      )
    }

    // Check if user already exists using the profile table (more direct)
    const { data: existingProfile } = await serviceSupabase
      .from("profiles")
      .select("id")
      .eq("company_email", email)
      .single()

    if (existingProfile) {
      return NextResponse.json(
        {
          success: false,
          error: "A user with this email already exists",
        },
        { status: 409 }
      )
    }

    // Create auth user without password - they will use OTP login
    const { data: authData, error: authError } = await serviceSupabase.auth.admin.createUser({
      email,
      email_confirm: false, // User will verify via OTP when they login
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        other_names: otherNames || "",
        department: department,
        phone_number: phoneNumber || "",
        gender: normalizedGender,
        date_of_birth: dateOfBirth || "",
        residential_address: residentialAddress || "",
        office_location: officeLocation || "",
      },
    })

    if (authError) {
      return NextResponse.json(
        {
          success: false,
          error: authError.message,
        },
        { status: 400 }
      )
    }

    // Resolve department_id if department name is provided
    let departmentId: string | null = null
    if (department) {
      const { data: deptRow } = await serviceSupabase
        .from("departments")
        .select("id")
        .eq("name", department)
        .maybeSingle()
      departmentId = deptRow?.id || null
    }

    // Update profile with all details
    const { error: profileError } = await serviceSupabase
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        other_names: otherNames || null,
        company_email: email,
        department: department,
        department_id: departmentId,
        designation: resolvedDesignation || null,
        phone_number: phoneNumber || null,
        role: targetRole,
        admin_routes: targetRole === "admin" ? adminRoutes : null,
        is_department_lead: false,
        lead_departments: [],
        employment_status: "active", // Explicitly set employment status
        employee_number: employeeNumber || null, // Employee number (ACOB/YEAR/NUMBER)
        employment_type: resolvedEmploymentType,
        contract_category_id: contractCategoryId,
        gender: normalizedGender,
        date_of_birth: dateOfBirth || null,
        additional_phone: additionalPhone || null,
        residential_address: residentialAddress || null,
        office_location: officeLocation || null,
      })
      .eq("id", authData.user.id)

    if (profileError) {
      log.error({ err: String(profileError) }, "[Create User] Profile update error:")
      // If profile update fails, try to delete the auth user
      await serviceSupabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        {
          success: false,
          error: `Database error: ${profileError.message}`,
        },
        { status: 500 }
      )
    }

    // No leave records to create: entitlement is derived from the leave type's allowance minus
    // the employee's own requests, so a new joiner has their full allowance immediately.

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "user",
        entityId: authData.user.id,
        newValues: {
          email,
          department,
          role: targetRole,
          employee_number: employeeNumber || null,
          employment_type: resolvedEmploymentType,
          contract_category_id: contractCategoryId,
        },
        context: { actorId: user.id, source: "api", route: "/api/admin/create-user" },
      },
      { failOpen: true }
    )

    const responsePayload = {
      success: true,
      message: "User created successfully. They can now login with their email and receive an OTP.",
      userId: authData.user.id,
      email: authData.user.email,
    }

    if (idempotencyKey) {
      await storeIdempotencyKey(serviceSupabase, idempotencyKey, responsePayload)
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "[v0] Create user failed:")
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    )
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-create-user:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
