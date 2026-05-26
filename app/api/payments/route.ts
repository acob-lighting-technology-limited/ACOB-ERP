import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  expandDepartmentScopeForQuery,
  getDepartmentScope,
  resolveAdminScope,
  normalizeDepartmentName,
} from "@/lib/admin/rbac"
import { PAYMENT_TYPES } from "@/lib/validation"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getPaginationRange, paginatedResponse, PaginationSchema } from "@/lib/pagination"
import { checkIdempotency, getIdempotencyKey, storeIdempotencyKey } from "@/lib/idempotency"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { checkRequestSize } from "@/lib/api/request-size"

const log = logger("payments")

export const dynamic = "force-dynamic"

type PaymentsClient = Awaited<ReturnType<typeof createClient>>

type UserPaymentsProfile = {
  department?: string | null
  department_id?: string | null
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const CreatePaymentSchema = z
  .object({
    department_id: z.string().trim().min(1, "Missing required fields (including Issuer Name & Phone)"),
    payment_type: z.enum(PAYMENT_TYPES).optional(),
    category: z.enum(PAYMENT_TYPES, {
      errorMap: () => ({ message: "Category must be 'one-time' or 'recurring'" }),
    }),
    title: z.string().trim().min(1, "Missing required fields (including Issuer Name & Phone)"),
    description: z.string().optional().nullable(),
    amount: z.union([z.number(), z.string()]).refine((value) => String(value).trim().length > 0, {
      message: "Missing required fields (including Issuer Name & Phone)",
    }),
    currency: z.string().optional().default("NGN"),
    recurrence_period: z.string().optional().nullable(),
    next_payment_due: z.string().optional().nullable(),
    payment_date: z.string().optional().nullable(),
    issuer_name: z.string().trim().min(1, "Missing required fields (including Issuer Name & Phone)"),
    issuer_phone_number: z.string().trim().min(1, "Missing required fields (including Issuer Name & Phone)"),
    issuer_address: z.string().optional().nullable(),
    payment_reference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const derivedPaymentType = value.payment_type || value.category

    if (derivedPaymentType === "recurring" && (!value.recurrence_period || !value.next_payment_due)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recurring payments require recurrence_period and next_payment_due",
        path: ["recurrence_period"],
      })
    }

    if (derivedPaymentType === "one-time" && !value.payment_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "One-time payments require payment_date",
        path: ["payment_date"],
      })
    }
  })

const normalizeDepartmentId = (value: unknown): string | null => {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw || !UUID_REGEX.test(raw)) return null
  return raw
}

// Helper function to create Supabase client
async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}

// GET /api/payments - Get payments (filtered by department if not admin)
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const paginationParsed = PaginationSchema.safeParse(Object.fromEntries(searchParams))
    if (!paginationParsed.success) {
      return apiError(
        paginationParsed.error.issues[0]?.message ?? "Invalid pagination params",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        paginationParsed.error.issues
      )
    }
    const pagination = paginationParsed.data
    const { from, to } = getPaginationRange(pagination)

    const departmentId = searchParams.get("department_id")
    const paymentType = searchParams.get("payment_type")
    const category = searchParams.get("category")
    const status = searchParams.get("status")

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department, department_id")
      .eq("id", user.id)
      .single()
    const scope = await resolveAdminScope(supabase, user.id)
    const dataClient = getServiceRoleClientOrFallback(supabase)

    let query = dataClient
      .from("department_payments")
      .select(
        `
                *,
                department:departments(*),
                documents:payment_documents(id, document_type, file_path, file_name, applicable_date)
            `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })

    if (scope) {
      const scopedDepartments = getDepartmentScope(scope, "finance")
      if (scopedDepartments && scopedDepartments.length > 0) {
        const queryScopedDepartments = expandDepartmentScopeForQuery(scopedDepartments)
        const { data: deptRows } = await dataClient.from("departments").select("id").in("name", queryScopedDepartments)
        const deptIds = (deptRows || []).map((row) => row.id)
        query = deptIds.length > 0 ? query.in("department_id", deptIds) : query.eq("department_id", "__none__")
      } else if (scopedDepartments && scopedDepartments.length === 0) {
        query = query.eq("department_id", "__none__")
      } else if (departmentId) {
        query = query.eq("department_id", departmentId)
      }
    } else {
      const deptId = normalizeDepartmentId((profile as UserPaymentsProfile | null)?.department_id)
      if (deptId) {
        query = query.eq("department_id", deptId)
      } else {
        const rawDept = String((profile as UserPaymentsProfile | null)?.department || "").trim()
        const deptCandidates = Array.from(new Set([normalizeDepartmentName(rawDept), rawDept].filter(Boolean)))
        const { data: userDept } = await dataClient
          .from("departments")
          .select("id")
          .in("name", deptCandidates.filter(Boolean))
          .limit(1)
          .maybeSingle()
        query = userDept ? query.eq("department_id", userDept.id) : query.eq("department_id", "__none__")
      }
    }

    // Apply filters
    if (paymentType) {
      query = query.eq("payment_type", paymentType)
    }
    if (category) {
      query = query.eq("category", category)
    }
    if (status) {
      query = query.eq("status", status)
    } else {
      // Soft-deleted payments are marked as cancelled and hidden by default.
      query = query.neq("status", "cancelled")
    }

    const { data: payments, error, count } = await query.range(from, to)

    if (error) throw error

    return NextResponse.json(paginatedResponse(payments || [], count || 0, pagination))
  } catch (error) {
    log.error({ err: String(error) }, "Error fetching payments:")
    return apiError("Failed to fetch payments", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}

// POST /api/payments - Create a new payment
export async function POST(request: Request) {
  try {
    const rl = await rateLimit(`payments-create:${getClientId(request)}`, { limit: 20, windowSec: 60 })
    if (!rl.allowed) {
      return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
    }

    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const idempotencyKey = getIdempotencyKey(request)
    if (idempotencyKey) {
      const { isDuplicate, cachedResponse } = await checkIdempotency(dataClient, idempotencyKey)
      if (isDuplicate) {
        return NextResponse.json(cachedResponse, { status: 200 })
      }
    }

    const sizeError = checkRequestSize(request)
    if (sizeError) return sizeError

    const body = await request.json()
    const parsed = CreatePaymentSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Validation failed",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
    }

    const {
      department_id,
      payment_type,
      category,
      title,
      description,
      amount,
      currency,
      recurrence_period,
      next_payment_due,
      payment_date,
      issuer_name,
      issuer_phone_number,
      issuer_address,
      payment_reference,
      notes,
    } = parsed.data

    // Derive payment_type from category (they are now the same)
    const derivedPaymentType = payment_type || category

    // Note: Categories are now fixed ("one-time" or "recurring"), no need to auto-create

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, department, department_id")
      .eq("id", user.id)
      .single()
    const scope = await resolveAdminScope(supabase, user.id)

    if (scope) {
      const scopedDepartments = getDepartmentScope(scope, "finance")
      if (scopedDepartments) {
        const queryScopedDepartments = expandDepartmentScopeForQuery(scopedDepartments)
        const { data: targetDepartment } = await dataClient
          .from("departments")
          .select("name")
          .eq("id", department_id)
          .single()
        if (!targetDepartment || !queryScopedDepartments.includes(targetDepartment.name)) {
          return apiError("You can only create finance records in your scoped departments", ApiErrorCode.FORBIDDEN, 403)
        }
      }
    } else {
      let userDepartmentId = normalizeDepartmentId((profile as UserPaymentsProfile | null)?.department_id)
      if (!userDepartmentId) {
        const rawDept = String((profile as UserPaymentsProfile | null)?.department || "").trim()
        const deptCandidates = Array.from(new Set([normalizeDepartmentName(rawDept), rawDept].filter(Boolean)))
        const { data: userDept } = await dataClient
          .from("departments")
          .select("id")
          .in("name", deptCandidates.filter(Boolean))
          .limit(1)
          .maybeSingle()
        userDepartmentId = userDept?.id || null
      }
      if (!userDepartmentId || userDepartmentId !== department_id) {
        return apiError("You can only create payments in your own department", ApiErrorCode.FORBIDDEN, 403)
      }
    }

    // Create payment
    const { data: payment, error } = await dataClient
      .from("department_payments")
      .insert({
        department_id,
        payment_type: derivedPaymentType,
        category,
        title,
        description,
        amount,
        currency,
        status: derivedPaymentType === "one-time" ? "paid" : "due", // One-time payments are already paid
        recurrence_period: derivedPaymentType === "recurring" ? recurrence_period : null,
        next_payment_due: derivedPaymentType === "recurring" ? next_payment_due : null,
        payment_date: derivedPaymentType === "one-time" ? payment_date : null,
        issuer_name,
        issuer_phone_number,
        issuer_address,
        payment_reference,
        notes,
        created_by: user.id,
      })
      .select(
        `
                *,
                department:departments(*)
            `
      )
      .single()

    if (error) throw error

    await writeAuditLog(
      supabase as PaymentsClient,
      {
        action: "create",
        entityType: "payment",
        entityId: payment.id,
        newValues: { amount: payment.amount, department_id: payment.department_id, status: payment.status },
        context: { actorId: user.id, source: "api", route: "/api/payments" },
      },
      { failOpen: true }
    )

    const responsePayload = { data: payment }
    if (idempotencyKey) {
      await storeIdempotencyKey(dataClient, idempotencyKey, responsePayload)
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error: unknown) {
    log.error({ err: String(error) }, "Error creating payment:")
    const message = error instanceof Error ? error.message : "Failed to create payment"
    return apiError(message, ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
