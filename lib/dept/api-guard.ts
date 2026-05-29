import { headers } from "next/headers"
import { NextResponse } from "next/server"
import type { DeptScope } from "./scope"

/**
 * Reads the x-dept-scope header injected by middleware and validates that
 * the scope's deptId matches the requested deptId.
 *
 * Returns the DeptScope on success, or a 403 NextResponse on failure.
 *
 * Usage in an API route handler:
 *   const result = await requireDeptApiScope(params.dept_id)
 *   if (result instanceof NextResponse) return result
 *   const scope = result
 */
export async function requireDeptApiScope(deptId: string): Promise<DeptScope | NextResponse> {
  const headerStore = await headers()
  const encoded = headerStore.get("x-dept-scope")

  if (!encoded) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let scope: DeptScope
  try {
    scope = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as DeptScope
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!scope?.userId || scope.deptId !== deptId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return scope
}
