export const ApiErrorCode = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  // Input
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  // Rate limiting
  RATE_LIMITED: "RATE_LIMITED",
  // Business logic
  ALREADY_EXISTS: "ALREADY_EXISTS",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID_STATE: "INVALID_STATE",
  // Server
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export function apiError(message: string, code: ApiErrorCode, status: number, details?: unknown) {
  return Response.json({ error: message, code, ...(details ? { details } : {}) }, { status })
}
