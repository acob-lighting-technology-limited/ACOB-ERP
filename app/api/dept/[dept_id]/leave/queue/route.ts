/**
 * Dept-scoped leave queue.
 * Validates x-dept-scope ownership then delegates to the main /api/hr/leave/queue
 * handler — which already uses getRequestScope() to filter by dept.
 */
import { type NextRequest } from "next/server"
import { requireDeptApiScope } from "@/lib/dept/api-guard"
import { GET as hrLeaveQueueGet } from "@/app/api/hr/leave/queue/route"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ dept_id: string }> }) {
  const { dept_id } = await params
  const guard = await requireDeptApiScope(dept_id)
  if (guard instanceof Response) return guard

  // x-dept-scope is already in the forwarded headers via middleware.
  // getRequestScope() in the hr queue handler will read it and filter to this dept.
  return hrLeaveQueueGet(request)
}
