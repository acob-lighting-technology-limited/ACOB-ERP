/**
 * Dept-scoped leave calendar.
 * Validates x-dept-scope ownership, then delegates to the admin leave calendar
 * handler so all filtering stays in one implementation.
 */
import { type NextRequest } from "next/server"
import { requireDeptApiScope } from "@/lib/dept/api-guard"
import { GET as adminLeaveCalendarGet } from "@/app/api/admin/hr/leave/calendar/route"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ dept_id: string }> }) {
  const { dept_id } = await params
  const guard = await requireDeptApiScope(dept_id)
  if (guard instanceof Response) return guard

  return adminLeaveCalendarGet(request)
}
