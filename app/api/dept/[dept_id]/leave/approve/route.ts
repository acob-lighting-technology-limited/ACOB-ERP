/**
 * Dept-scoped leave approve/reject action.
 * Validates x-dept-scope ownership then delegates to /api/hr/leave/approve.
 */
import { type NextRequest } from "next/server"
import { requireDeptApiScope } from "@/lib/dept/api-guard"
import { POST as hrLeaveApprovePost } from "@/app/api/hr/leave/approve/route"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ dept_id: string }> }) {
  const { dept_id } = await params
  const guard = await requireDeptApiScope(dept_id)
  if (guard instanceof Response) return guard

  return hrLeaveApprovePost(request)
}
