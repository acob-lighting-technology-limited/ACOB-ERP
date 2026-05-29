import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolveDeptScope, type DeptScope } from "./scope"

/**
 * Server-side guard for /dept/[dept_id]/ pages.
 *
 * Fetches the authenticated user, resolves their DeptScope for the given
 * deptId, and redirects away if they are not the lead of that department.
 *
 * Usage in a server component:
 *   const scope = await requireDeptScope(params.dept_id)
 */
export async function requireDeptScope(deptId: string): Promise<DeptScope> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect("/auth/login")

  const scope = await resolveDeptScope(supabase, user.id, deptId)
  if (!scope) redirect("/profile?error=no_dept_access")

  return scope
}
