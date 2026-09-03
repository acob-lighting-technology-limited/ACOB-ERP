import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { AdminAccountsPage } from "./view"

export default async function AccountsDashboard() {
  await requireAdminSectionAccess("accounts")

  return <AdminAccountsPage />
}
