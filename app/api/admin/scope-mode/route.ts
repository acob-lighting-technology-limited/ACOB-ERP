import { NextResponse } from "next/server"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"

export const dynamic = "force-dynamic"

export async function GET() {
  const scope = await getRequestScope()
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return NextResponse.json({
    mode: scope.scopeMode,
    managedDepartments: getScopedDepartments(scope) ?? [],
    isAdminLike: scope.isAdminLike,
    isDepartmentLead: scope.isDepartmentLead,
  })
}
