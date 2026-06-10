import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { DevAcobotLogsContent } from "./dev-acobot-logs-content"

export default async function DevAcobotLogsPage() {
  await requireAdminSectionAccess("dev")
  return <DevAcobotLogsContent />
}
