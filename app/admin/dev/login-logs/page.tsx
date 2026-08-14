import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { DevLoginLogsContent } from "./dev-login-logs-content"

export default async function DevLoginLogsPage() {
  await requireAdminSectionAccess("dev")

  return <DevLoginLogsContent />
}
