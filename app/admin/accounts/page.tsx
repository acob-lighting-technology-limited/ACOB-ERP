import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { AccountsDashboardContent } from "./accounts-dashboard-content"

export default async function AccountsDashboard() {
  await requireAdminSectionAccess("accounts")

  return <AccountsDashboardContent />
}
