import { redirect } from "next/navigation"
import { getRequestScope } from "@/lib/admin/api-scope"

/**
 * Server-level guard for the CBT section.
 * CBT (question management, cycle scores) is a super_admin / developer concern —
 * department leads have no business creating or accessing organisation-wide tests.
 */
export default async function CbtLayout({ children }: { children: React.ReactNode }) {
  const scope = await getRequestScope()

  // Strictly enforce super_admin and developer access
  const canAccessCbt = scope?.role === "super_admin" || scope?.role === "developer"
  if (!canAccessCbt) {
    redirect("/admin/hr/pms")
  }

  return <>{children}</>
}
