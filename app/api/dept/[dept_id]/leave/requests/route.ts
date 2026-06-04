/**
 * Dept-scoped leave request history.
 * Validates x-dept-scope ownership, then delegates to the main leave request
 * handler so all filtering stays in one implementation.
 */
import { type NextRequest } from "next/server"
import { requireDeptApiScope } from "@/lib/dept/api-guard"
import { GET as hrLeaveRequestsGet } from "@/app/api/hr/leave/requests/route"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ dept_id: string }> }) {
  const { dept_id } = await params
  const guard = await requireDeptApiScope(dept_id)
  if (guard instanceof Response) return guard

  return hrLeaveRequestsGet(request)
}
