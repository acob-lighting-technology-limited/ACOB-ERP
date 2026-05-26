import { z } from "zod"
import { NextRequest, NextResponse } from "next/server"
import { ORG_EMAIL_DOMAINS } from "@/lib/org-config"

/**
 * API Validation Middleware
 * Validates request bodies and query parameters using Zod schemas
 */

/**
 * Validate request body against a Zod schema
 */
export async function validateRequestBody<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: NextResponse }> {
  try {
    const body = await request.json()
    const validatedData = schema.parse(body)
    return { success: true, data: validatedData }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: NextResponse.json(
          {
            error: "Validation failed",
            details: error.errors.map((err) => ({
              field: err.path.join("."),
              message: err.message,
            })),
          },
          { status: 400 }
        ),
      }
    }
    return {
      success: false,
      error: NextResponse.json({ error: "Invalid request body" }, { status: 400 }),
    }
  }
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  uuid: z.string().uuid({ message: "Invalid UUID format" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  email: z.string().email({ message: "Invalid email address" }),
  positiveNumber: z.number().positive("Must be a positive number"),
  nonNegativeNumber: z.number().min(0, "Cannot be negative"),
}

export const APPROVAL_STATUSES = ["approved", "rejected"] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

/**
 * HR Module Validation Schemas
 */
export const hrSchemas = {
  createLeaveRequest: z
    .object({
      leave_type_id: commonSchemas.uuid,
      start_date: commonSchemas.date,
      end_date: commonSchemas.date,
      reason: z.string().min(10, "Reason must be at least 10 characters").max(500),
    })
    .refine((data) => new Date(data.end_date) >= new Date(data.start_date), {
      message: "End date must be after or equal to start date",
      path: ["end_date"],
    }),

  approveLeave: z.object({
    leave_request_id: commonSchemas.uuid,
    status: z.enum(APPROVAL_STATUSES),
    comments: z.string().max(500).optional(),
  }),

  createGoal: z.object({
    user_id: commonSchemas.uuid,
    title: z.string().min(5).max(200),
    description: z.string().max(1000).optional(),
    target_value: commonSchemas.positiveNumber.optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    due_date: commonSchemas.date.optional(),
  }),
}

/**
 * Payment Validation Schemas
 */
export const PAYMENT_TYPES = ["one-time", "recurring"] as const
export type PaymentType = (typeof PAYMENT_TYPES)[number]

export const paymentSchemas = {
  createPayment: z.object({
    department_id: commonSchemas.uuid,
    title: z.string().min(3).max(200),
    amount: commonSchemas.positiveNumber.optional(),
    currency: z.string().length(3, "Currency must be 3 characters"),
    payment_type: z.enum(PAYMENT_TYPES),
    category: z.string().min(2).max(100),
  }),
}

/**
 * Date validation utilities
 * Prevents database issues caused by invalid date ranges
 */
export const dateValidation = {
  /**
   * Check if end date is before start date
   */
  isEndBeforeStart: (startDate: string, endDate: string): boolean => {
    if (!startDate || !endDate) return false
    return new Date(endDate) < new Date(startDate)
  },

  /**
   * Validate date range and return error message if invalid
   * @returns Error message if invalid, null if valid
   */
  validateDateRange: (startDate: string, endDate: string, fieldName = "date"): string | null => {
    if (!startDate || !endDate) return null
    if (dateValidation.isEndBeforeStart(startDate, endDate)) {
      return `End ${fieldName} cannot be before start ${fieldName}`
    }
    return null
  },
}

/**
 * Asset assignment validation utilities
 * Prevents assignment type mismatches that corrupt database
 */
export const assignmentValidation = {
  /**
   * Validate that assignment has required fields based on type
   * @returns Error message if invalid, null if valid
   */
  validateAssignment: (
    assignmentType: "individual" | "department" | "office",
    assignedTo?: string,
    department?: string,
    officeLocation?: string
  ): string | null => {
    if (assignmentType === "individual" && !assignedTo) {
      return "Please select a person to assign to"
    }
    if (assignmentType === "department" && !department) {
      return "Please select a department"
    }
    if (assignmentType === "office" && !officeLocation) {
      return "Please select an office location"
    }
    return null
  },
}

/**
 * Form validation utilities
 */
export const formValidation = {
  /**
   * Validate general email format.
   */
  isEmail: (email: string): boolean => {
    if (!email) return false
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  },

  /**
   * Check if all required fields are filled
   */
  hasRequiredFields: (fields: Record<string, unknown>, requiredKeys: string[]): boolean => {
    return requiredKeys.every((key) => {
      const value = fields[key]
      return value !== null && value !== undefined && value !== ""
    })
  },

  /**
   * Get missing required field names
   */
  getMissingFields: (fields: Record<string, unknown>, requiredKeys: string[]): string[] => {
    return requiredKeys.filter((key) => {
      const value = fields[key]
      return value === null || value === undefined || value === ""
    })
  },

  /**
   * Validate that email belongs to official company domains
   */
  isCompanyEmail: (email: string): boolean => {
    if (!email) return false
    const allowedDomains = ORG_EMAIL_DOMAINS
    return allowedDomains.some((domain) => email.toLowerCase().endsWith(`@${domain}`))
  },
}
