import type { SupabaseClient } from "@supabase/supabase-js"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import type { Database } from "@/types/database"
import { normalizeDepartmentName, DEPT_ADMIN_HR } from "@/shared/departments"

export const FLEET_BLOCKING_STATUSES = ["pending", "approved"] as const
export const FLEET_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
])
export const FLEET_MAX_FILE_SIZE = 10 * 1024 * 1024

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 140)
}

export function assertReason(reason: string): string {
  const normalized = String(reason || "").trim()
  if (normalized.length < 10) {
    throw new Error("Reason must be at least 10 characters")
  }
  return normalized
}

export function assertBookingWindow(startAt: string, endAt: string): { start: Date; end: Date } {
  const start = new Date(startAt)
  const end = new Date(endAt)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid booking date/time")
  }

  if (end.getTime() <= start.getTime()) {
    throw new Error("End time must be after start time")
  }

  return { start, end }
}

export async function assertNoFleetOverlap(params: {
  supabase: SupabaseClient<Database>
  resourceId: string
  startAt: string
  endAt: string
  excludeBookingId?: string
}) {
  const { supabase, resourceId, startAt, endAt, excludeBookingId } = params

  let query = supabase
    .from("fleet_bookings")
    .select("id, start_at, end_at, status")
    .eq("resource_id", resourceId)
    .in("status", [...FLEET_BLOCKING_STATUSES])
    .lt("start_at", endAt)
    .gt("end_at", startAt)
    .limit(1)

  if (excludeBookingId) {
    query = query.neq("id", excludeBookingId)
  }

  const { data, error } = await query
  if (error) {
    throw new Error("Failed to validate booking overlap")
  }

  if (Array.isArray(data) && data.length > 0) {
    throw new Error("This resource is already booked for the selected date/time")
  }
}

export async function canManageFleet(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const scope = await resolveAdminScope(supabase, userId)
  if (!scope) return false
  const role = String(scope.role || "").toLowerCase()
  if (role === "developer" || role === "super_admin" || role === "admin") {
    return canAccessAdminSection(scope, "hr")
  }

  if (!scope.isDepartmentLead) return false
  const managed = (scope.managedDepartments || []).map((dept) => normalizeDepartmentName(String(dept || "")))
  const primary = normalizeDepartmentName(String(scope.department || ""))
  return managed.includes(DEPT_ADMIN_HR) || primary === DEPT_ADMIN_HR
}
